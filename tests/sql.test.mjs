import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Локальная проверка миграций и прав доступа на PGlite (Postgres в WASM) с заглушкой схемы auth.
// Запуск: npm run test:sql. Живую базу не трогает.

const db = new PGlite();
const stub = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;
await db.exec(stub);
const dir = 'supabase/migrations';
for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));
console.log('migration OK');

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const ADM = '00000000-0000-0000-0000-0000000000ad';
await db.exec(`
insert into auth.users values ('${A}','a@t.test'),('${B}','b@t.test'),('${ADM}','adm@t.test');
update public.profiles set role='admin' where id='${ADM}';
insert into public.quiz_keys select 1, g, ((g-1)%4)+1, 'объяснение '||g from generate_series(1,8) g;
`);

let fails = 0;
async function as(user, sql, expect) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  let res, err;
  try { res = await db.query(sql); } catch (e) { err = e.message; }
  await db.exec('reset role;');
  const rows = res?.rows ?? [];
  const ok = expect === 'error' ? !!err : expect === 'empty' ? !err && rows.length === 0 : !err && expect(rows);
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', sql.slice(0, 90).replace(/\s+/g, ' '), err ? `-> ${err}` : `-> ${JSON.stringify(rows).slice(0, 160)}`);
}

// B сдаёт тест и задание
await as(B, `select public.submit_quiz(1, '[1,2,3,4,1,2,3,4]') r`, (r) => r[0].r.passed === true && r[0].r.score === 8);
await as(B, `insert into public.homework(user_id, lesson_id, link, status, score) values ('${B}', 1, 'https://claude.ai/share/x', 'accepted', 6) returning status, score`, (r) => r[0].status === 'submitted' && r[0].score === null);
// A: чужое и ключи
await as(A, `select * from public.quiz_keys`, 'empty');
await as(A, `select * from public.quiz_attempts where user_id='${B}'`, 'empty');
await as(A, `select * from public.homework`, 'empty');
await as(A, `select * from public.profiles where id='${B}'`, 'empty');
await as(A, `insert into public.quiz_attempts(user_id,lesson_id,answers,score,max_score,passed) values ('${A}',1,'[]',8,8,true)`, 'error');
await as(A, `update public.profiles set role='admin' where id='${A}'`, 'error');
await as(A, `update public.profiles set full_name='Аня' where id='${A}' returning full_name`, (r) => r[0]?.full_name === 'Аня');
await as(A, `insert into public.homework(user_id,lesson_id,link) values ('${B}',1,'https://x.y')`, 'error');
await as(A, `insert into public.homework(user_id,lesson_id,link) values ('${A}',3,'https://x.y')`, 'error');
await as(A, `update public.homework set link='https://evil' where user_id='${B}' returning id`, 'empty');
await as(A, `select public.submit_quiz(3, '[1,1,1,1,1,1,1,1]')`, 'error');
await as(A, `select public.submit_quiz(1, '[1,1]')`, 'error');
await as(A, `select * from public.admin_progress()`, 'error');
await as(A, `insert into public.lesson_unlocks values ('${A}', 2)`, 'error');
await as(A, `select public._lesson_open('${B}', 2)`, 'error');
await as(A, `select public.is_lesson_open(2) o`, (r) => r[0].o === false);
// A: два провала подряд -> lagging
await as(A, `select public.submit_quiz(1, '[4,4,4,4,4,4,4,4]') r`, (r) => r[0].r.score === 2 && r[0].r.passed === false && r[0].r.review.length === 8);
await as(A, `select public.submit_quiz(1, '[4,4,4,4,4,4,4,4]') r`, (r) => r[0].r.passed === false);
await as(A, `select * from public.my_progress() where lesson_id=1`, (r) => r[0].lagging === true && r[0].attempts === 2 && r[0].best_score === 2);
await as(null, `select * from public.profiles`, 'error');
await as(null, `select public.submit_quiz(1, '[1,2,3,4,1,2,3,4]')`, 'error');
// B: урок 2 открылся, правка принятого задания запрещена
await as(B, `select public.is_lesson_open(2) o`, (r) => r[0].o === true);
await as(B, `update public.homework set link='https://new.link' where user_id='${B}' returning id`, 'empty');
// владелец
await as(ADM, `select count(*)::int c from public.admin_progress()`, (r) => r[0].c === 16);
await as(ADM, `update public.homework set status='needs_rework', score=3, admin_comment='Добавьте проверку', link='https://hack' where user_id='${B}' returning link, reviewed_at`, (r) => r[0].link === 'https://claude.ai/share/x' && r[0].reviewed_at);
await as(ADM, `insert into public.lesson_unlocks values ('${A}', 2) returning lesson_id`, (r) => r.length === 1);
await as(ADM, `select count(*)::int c from public.quiz_keys`, (r) => r[0].c === 8);
await as(A, `select public.is_lesson_open(2) o`, (r) => r[0].o === true);
// B пересдаёт задание
await as(B, `update public.homework set link='https://claude.ai/share/y', status='accepted', score=6 where user_id='${B}' returning status, score, link`, (r) => r[0].status === 'submitted' && r[0].score === 3 && r[0].link.endsWith('/y'));
await as(B, `select * from public.my_progress()`, (r) => r.length === 8 && r[1].is_open === true && r[2].is_open === false);

console.log(fails ? `\n${fails} FAIL` : '\nвсё прошло');
process.exit(fails ? 1 : 0);
