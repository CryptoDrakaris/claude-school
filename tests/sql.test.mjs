import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Локальная проверка миграций и прав доступа на PGlite (Postgres в WASM) с заглушкой схемы auth.
// Запуск: npm run test:sql. Живую базу не трогает.

const db = new PGlite();
const stub = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
-- invited_at по умолчанию now(): старые проверки создают «приглашённых»; проверки регистрации ставят null явно.
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, invited_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
-- Заглушки Vault и pg_net: секреты в таблице, http_post записывает вызов вместо отправки.
create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
create schema net; create table net.calls (url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default null, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ insert into net.calls values (url, headers, body); select 1::bigint $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;
await db.exec(stub);
const dir = 'supabase/migrations';
for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort())
  await db.exec(readFileSync(join(dir, f), 'utf8').replace(/create extension if not exists pg_net;/g, ''));
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
await as(ADM, `select count(*)::int c from public.admin_progress(array[1])`, (r) => r[0].c === 16);
await as(ADM, `update public.homework set status='needs_rework', score=3, admin_comment='Добавьте проверку', link='https://hack' where user_id='${B}' returning link, reviewed_at`, (r) => r[0].link === 'https://claude.ai/share/x' && r[0].reviewed_at);
await as(ADM, `insert into public.lesson_unlocks values ('${A}', 2) returning lesson_id`, (r) => r.length === 1);
await as(ADM, `select count(*)::int c from public.quiz_keys`, (r) => r[0].c === 8);
await as(A, `select public.is_lesson_open(2) o`, (r) => r[0].o === true);
// B пересдаёт задание
await as(B, `update public.homework set link='https://claude.ai/share/y', status='accepted', score=6 where user_id='${B}' returning status, score, link`, (r) => r[0].status === 'submitted' && r[0].score === 3 && r[0].link.endsWith('/y'));
await as(B, `select * from public.my_progress()`, (r) => r.length === 8 && r[1].is_open === true && r[2].is_open === false);

// Регрессия аудита C1: «отстаёт» не считается по неготовым урокам (заглушкам без задания).
const C = '00000000-0000-0000-0000-00000000000c';
const N = '00000000-0000-0000-0000-00000000000d';
await db.exec(`insert into auth.users values ('${C}','c@t.test', now() - interval '9 days'), ('${N}','n@t.test', null);
  update public.profiles set created_at = now() - interval '9 days' where id in ('${C}','${N}');`);
await as(C, `select public.submit_quiz(1, '[1,2,3,4,1,2,3,4]')`, (r) => true);
await db.exec(`update public.quiz_attempts set created_at = now() - interval '8 days' where user_id = '${C}'`);
await as(ADM, `select lagging from public.admin_progress(array[1]) where user_id='${C}' and lesson_id=2`, (r) => r[0].lagging === false);
await as(ADM, `select lagging from public.admin_progress(array[1,2]) where user_id='${C}' and lesson_id=2`, (r) => r[0].lagging === true);
// Регрессия аудита N4: урок 1 отсчитывается от первого входа; кто не входил – не «отстаёт».
await as(ADM, `select lagging from public.admin_progress(array[1]) where user_id='${N}' and lesson_id=1`, (r) => r[0].lagging === false);
await as(ADM, `select lagging, hw_status from public.admin_progress(array[1]) where user_id='${C}' and lesson_id=1`, (r) => r[0].lagging === true);
await as(C, `select * from public._progress('${C}', array[1])`, 'error');

// Регрессия аудита C3: до сдачи теста разбор без правильных ответов и объяснений, после сдачи – полный.
const D = '00000000-0000-0000-0000-0000000000d0';
await db.exec(`insert into auth.users values ('${D}','d@t.test', now())`);
const hidden = (r) => r[0].r.revealed === false && r[0].r.review.every((x) => x.correct === null && x.explanation === null && typeof x.is_correct === 'boolean');
await as(D, `select public.submit_quiz(1, '[4,4,4,4,4,4,4,4]') r`, hidden);
await as(D, `select public.submit_quiz(1, '[2,3,4,1,2,3,4,1]') r`, hidden);
await as(D, `select public.submit_quiz(1, '[1,2,3,4,1,2,3,4]') r`, (r) => r[0].r.passed && r[0].r.revealed && r[0].r.review.every((x) => x.correct !== null && x.explanation));
await as(D, `select public.submit_quiz(1, '[4,4,4,4,4,4,4,4]') r`, (r) => !r[0].r.passed && r[0].r.revealed && r[0].r.review[0].correct === 1);

// Приглашения по ссылке (миграция 0005).
const U1 = '00000000-0000-0000-0000-0000000000e1', U2 = '00000000-0000-0000-0000-0000000000e2', U3 = '00000000-0000-0000-0000-0000000000e3';
const signup = (id, meta) => `insert into auth.users (id, email, email_confirmed_at, invited_at, raw_user_meta_data) values ('${id}', '${id.slice(-2)}@t.test', null, null, '${JSON.stringify(meta)}') returning id`;
await as(ADM, `insert into public.invites (code, max_uses, note) values ('Good-Invite-Code-01', 1, 'тест') returning code`, (r) => r.length === 1);
await db.exec(`insert into public.invites (code, expires_at) values ('Old-Invite-Code-02', now() - interval '1 day'); insert into public.invites (code, revoked) values ('Revoked-Code-0003', true);`);
await as(null, `select public.check_invite('Good-Invite-Code-01') ok`, (r) => r[0].ok === true);
await as(null, `select public.check_invite('Old-Invite-Code-02') ok`, (r) => r[0].ok === false);
await as(null, `select public.check_invite('nope') ok`, (r) => r[0].ok === false);
const reg_ = async (name, sql, expectOk) => {
  let err = null;
  try { await db.exec(sql); } catch (e) { err = e.message; }
  const ok = expectOk ? !err : /приглашению/.test(err ?? '');
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', name, err ? '-> ' + err : '-> принято');
};
await reg_('регистрация без кода отклонена', signup(U1, {}), false);
await reg_('регистрация с просроченным кодом отклонена', signup(U1, { invite: 'Old-Invite-Code-02' }), false);
await reg_('регистрация с отозванным кодом отклонена', signup(U1, { invite: 'Revoked-Code-0003' }), false);
await reg_('регистрация по коду проходит', signup(U2, { invite: 'Good-Invite-Code-01' }), true);
await reg_('код на одно использование второй раз не работает', signup(U3, { invite: 'Good-Invite-Code-01' }), false);
await as(ADM, `select count(*)::int c from public.profiles where id = '${U2}'`, (r) => r[0].c === 1);
await as(ADM, `select uses from public.invites where code = 'Good-Invite-Code-01'`, (r) => r[0].uses === 1);
await as(A, `select * from public.invites`, 'empty');
await as(A, `insert into public.invites (code) values ('Student-Made-Code-9')`, 'error');
await as(null, `select * from public.invites`, 'error');

// Письма с результатами (миграция 0005): без ключа – ничего, с ключом – одно письмо на первый сданный тест и на проверку задания.
await as(U2, `select public.submit_quiz(1, '[1,2,3,4,1,2,3,4]')`, (r) => true);
await as(ADM, `select 1`, (r) => true);
const calls = async () => (await db.query('select count(*)::int c from net.calls')).rows[0].c;
const noKey = await calls();
if (noKey !== 0) fails++;
console.log(noKey === 0 ? 'ok  ' : 'FAIL', 'без ключа Brevo письма не отправляются ->', noKey);
await db.exec(`insert into vault.decrypted_secrets values ('brevo_api_key', 'test-key'), ('mail_from', 'course@example.com');`);
const U4 = '00000000-0000-0000-0000-0000000000e4';
await db.exec(`insert into auth.users (id, email) values ('${U4}', 'u4@t.test'); update public.profiles set full_name = 'Участник Четыре' where id = '${U4}';`);
await as(U4, `select public.submit_quiz(1, '[4,4,4,4,4,4,4,4]')`, (r) => true);
await as(U4, `select public.submit_quiz(1, '[1,2,3,4,1,2,3,4]')`, (r) => true);
await as(U4, `select public.submit_quiz(1, '[1,2,3,4,1,2,3,4]')`, (r) => true);
let mail = (await db.query(`select body from net.calls`)).rows;
const m1 = mail.length === 1 && mail[0].body.to[0].email === 'u4@t.test' && /Тест урока 1 сдан: 8 из 8/.test(mail[0].body.subject) && /Открыт урок 2/.test(mail[0].body.htmlContent);
if (!m1) fails++;
console.log(m1 ? 'ok  ' : 'FAIL', 'письмо только за первую сдачу теста ->', mail.map((x) => x.body.subject).join(' | '));
await as(U4, `insert into public.homework (user_id, lesson_id, link) values ('${U4}', 1, 'https://claude.ai/share/u4') returning id`, (r) => r.length === 1);
await as(ADM, `update public.homework set status='needs_rework', score=3, admin_comment='Добавьте <b>проверку</b>' where user_id='${U4}' returning id`, (r) => r.length === 1);
await as(ADM, `update public.homework set admin_comment='ещё' where user_id='${U4}' returning id`, (r) => r.length === 1);
mail = (await db.query(`select body from net.calls`)).rows;
const m2 = mail.length === 2 && /нужна доработка/.test(mail[1].body.subject) && mail[1].body.htmlContent.includes('&lt;b&gt;проверку&lt;/b&gt;') && !mail[1].body.htmlContent.includes('<b>проверку');
if (!m2) fails++;
console.log(m2 ? 'ok  ' : 'FAIL', 'письмо о проверке задания, комментарий экранирован; правка без смены статуса – без письма ->', mail.length);

console.log(fails ? `\n${fails} FAIL` : '\nвсё прошло');
process.exit(fails ? 1 : 0);
