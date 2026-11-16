#!/usr/bin/env node
// Одноразовая ссылка входа для тестового участника – без письма: npm run test:student
// С флагом --reset сначала стирает его попытки, задания и ручные открытия (пройти курс заново).
// Нужен SUPABASE_SERVICE_ROLE_KEY в .env. Ссылка действует около часа и один раз;
// открывать в приватном окне, чтобы не выйти из своей учётки владельца.
import { createClient } from '@supabase/supabase-js';

const EMAIL = 'test-student@example.com';
const NAME = 'Тестовый участник';
const SITE = process.env.SITE_URL ?? 'https://cryptodrakaris.github.io/claude-school/';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Заполните VITE_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
if (listError) throw listError;
let user = list.users.find((u) => u.email === EMAIL);
if (!user) {
  const created = await db.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (created.error) throw created.error;
  user = created.data.user;
  await db.from('profiles').update({ full_name: NAME }).eq('id', user.id);
  console.log(`Создан тестовый участник ${EMAIL}`);
}

if (process.argv.includes('--reset')) {
  for (const table of ['quiz_attempts', 'homework', 'lesson_unlocks']) {
    const r = await db.from(table).delete().eq('user_id', user.id);
    if (r.error) throw r.error;
  }
  console.log('Прогресс тестового участника стёрт');
}

const link = await db.auth.admin.generateLink({ type: 'magiclink', email: EMAIL, options: { redirectTo: SITE } });
if (link.error) throw link.error;
console.log(`\nСсылка входа (одноразовая, около часа):\n${link.data.properties.action_link}\n`);
console.log('Удалить участника после проверки: Supabase → Authentication → Users → test-student@example.com → Delete.');
