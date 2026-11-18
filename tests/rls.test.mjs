#!/usr/bin/env node
// Проверка RLS на живой базе: npm run test:rls
// Создаёт двух временных участников, под учёткой A пытается добраться до данных B и до ключей,
// ждёт отказа, затем удаляет временные учётки. Нужен SUPABASE_SERVICE_ROLE_KEY в .env.
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('Заполните VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY в .env');
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
// Регистрация только по приглашению (миграция 0005) действует и для служебных скриптов:
// создаём одноразовый код ключом service role и сразу им пользуемся.
async function createInvitedUser(db, email) {
  const code = 'script-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  const ins = await db.from('invites').insert({ code, max_uses: 1, note: 'служебный скрипт' });
  if (ins.error) throw ins.error;
  const res = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { invite: code } });
  await db.from('invites').delete().eq('code', code);
  return res;
}

const admin = createClient(url, serviceKey, opts);
const stamp = Date.now();
const emails = { a: `rls-a-${stamp}@example.com`, b: `rls-b-${stamp}@example.com` };
const created = [];
let tempKey = false;
let fails = 0;

function check(name, ok, detail = '') {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' – ' + detail : ''}`);
}
const refused = (r) => Boolean(r.error) || (Array.isArray(r.data) && r.data.length === 0);
const why = (r) => r.error?.message ?? `строк: ${r.data?.length ?? 0}`;

async function makeUser(email) {
  const { data, error } = await createInvitedUser(admin, email);
  if (error) throw error;
  created.push(data.user.id);
  // Сессия без письма: ссылка генерируется на сервере и сразу подтверждается.
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  const client = createClient(url, anonKey, opts);
  const v = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  return { id: data.user.id, client };
}

try {
  const A = await makeUser(emails.a);
  const B = await makeUser(emails.b);

  // Данные B и хотя бы один ключ – через service role, в обход RLS.
  const keys = await admin.from('quiz_keys').select('lesson_id').limit(1);
  if (!keys.data?.length) {
    const k = await admin.from('quiz_keys').insert({ lesson_id: 8, question_no: 20, correct_option: 1, explanation: 'временный ключ теста RLS' });
    if (k.error) throw k.error;
    tempKey = true;
  }
  let r = await admin.from('quiz_attempts').insert({ user_id: B.id, lesson_id: 1, answers: [1], score: 8, max_score: 8, passed: true });
  if (r.error) throw r.error;
  r = await admin.from('homework').insert({ user_id: B.id, lesson_id: 1, link: 'https://example.com/b' });
  if (r.error) throw r.error;

  const a = A.client;
  const anon = createClient(url, anonKey, opts);

  r = await a.from('quiz_keys').select('*');
  check('A не видит ключи ответов', refused(r), why(r));
  r = await a.from('quiz_attempts').select('*').eq('user_id', B.id);
  check('A не видит попытки B', refused(r), why(r));
  r = await a.from('homework').select('*').eq('user_id', B.id);
  check('A не видит задания B', refused(r), why(r));
  r = await a.from('profiles').select('*').eq('id', B.id);
  check('A не видит профиль B', refused(r), why(r));
  r = await a.from('quiz_attempts').insert({ user_id: A.id, lesson_id: 1, answers: [], score: 8, max_score: 8, passed: true }).select();
  check('A не может записать попытку в обход submit_quiz', refused(r), why(r));
  r = await a.from('profiles').update({ role: 'admin' }).eq('id', A.id).select();
  check('A не может сделать себя владельцем', refused(r), why(r));
  r = await a.from('homework').insert({ user_id: B.id, lesson_id: 1, link: 'https://example.com/x' }).select();
  check('A не может сдать задание за B', refused(r), why(r));
  r = await a.from('homework').insert({ user_id: A.id, lesson_id: 5, link: 'https://example.com/x' }).select();
  check('A не может сдать задание закрытого урока', refused(r), why(r));
  r = await a.from('homework').update({ link: 'https://example.com/evil' }).eq('user_id', B.id).select();
  check('A не может изменить задание B', refused(r), why(r));
  r = await a.from('lesson_unlocks').insert({ user_id: A.id, lesson_id: 2 }).select();
  check('A не может открыть себе урок', refused(r), why(r));
  r = await a.rpc('admin_progress');
  check('A не может вызвать сводку владельца', r.error?.message === 'Только для владельца', why(r));
  r = await a.rpc('submit_quiz', { p_lesson_id: 3, p_answers: [1, 1, 1, 1, 1, 1, 1, 1] });
  check('A не может сдать тест закрытого урока', r.error?.message === 'Урок ещё закрыт', why(r));
  r = await a.from('profiles').select('id, role').eq('id', A.id);
  check('A видит свой профиль с ролью student', r.data?.[0]?.role === 'student', why(r));
  r = await a.rpc('my_progress');
  check('A получает свой прогресс по 26 урокам', r.data?.length === 26, why(r));

  r = await anon.from('profiles').select('*');
  check('без входа не видно профилей', refused(r), why(r));
  r = await anon.from('quiz_keys').select('*');
  check('без входа не видно ключей', refused(r), why(r));
  r = await anon.rpc('submit_quiz', { p_lesson_id: 1, p_answers: [1, 1, 1, 1, 1, 1, 1, 1] });
  check('без входа нельзя сдать тест', Boolean(r.error), why(r));
} catch (e) {
  fails++;
  console.error('Ошибка подготовки теста:', e.message ?? e);
} finally {
  if (tempKey) await admin.from('quiz_keys').delete().match({ lesson_id: 8, question_no: 20 });
  for (const id of created) await admin.auth.admin.deleteUser(id);
}

console.log(fails ? `\nНе прошло: ${fails}` : '\nRLS: все проверки прошли');
process.exit(fails ? 1 : 0);
