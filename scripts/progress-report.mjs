#!/usr/bin/env node
// Отчёт о прогрессе участников для разбора в чате с Claude: npm run report
// Печатает Markdown: сводка по людям и урокам, задания на проверке, вопросы тестов,
// на которых чаще всего ошибаются (по первой попытке, чтобы не мешал эффект пересдачи).
// С флагом --json печатает сырые данные. Нужен SUPABASE_SERVICE_ROLE_KEY в .env.
// В отчёте есть имена и почты участников – не публикуйте его.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Заполните VITE_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const program = JSON.parse(readFileSync('content/program.json', 'utf8'));
const quizzes = {};
for (const l of program) {
  const dir = readdirSync('content/lessons').find((d) => d.startsWith(String(l.id).padStart(2, '0') + '-'));
  try {
    quizzes[l.id] = JSON.parse(readFileSync(join('content/lessons', dir, 'quiz.json'), 'utf8')).questions;
  } catch {
    quizzes[l.id] = [];
  }
}

const need = (r) => {
  if (r.error) throw r.error;
  return r.data;
};
const profiles = need(await db.from('profiles').select('id, full_name, role, created_at'));
const attempts = need(await db.from('quiz_attempts').select('user_id, lesson_id, answers, score, max_score, passed, created_at').order('created_at'));
const homework = need(await db.from('homework').select('user_id, lesson_id, link, comment, status, score, admin_comment, submitted_at, reviewed_at'));
const keys = need(await db.from('quiz_keys').select('lesson_id, question_no, correct_option'));
const users = need(await db.auth.admin.listUsers({ perPage: 1000 })).users;
const emailOf = Object.fromEntries(users.map((u) => [u.id, u.email]));
const signedIn = Object.fromEntries(users.map((u) => [u.id, u.last_sign_in_at]));

const students = profiles.filter((p) => p.role === 'student');
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ students, attempts, homework }, null, 2));
  process.exit(0);
}

const d = (s) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '–');
const daysAgo = (s) => (s ? Math.floor((Date.now() - new Date(s).getTime()) / 86400000) : null);
const out = [];
out.push(`# Прогресс курса на ${new Date().toLocaleString('ru-RU')}`, '');
out.push(`Участников: ${students.length}. Попыток тестов: ${attempts.length}. Заданий сдано: ${homework.length}.`, '');

out.push('## Сводка', '', '| Участник | Почта | Последний вход | Тесты сданы | Задания приняты | Сейчас на уроке |', '|---|---|---|---|---|---|');
for (const s of students) {
  const mine = attempts.filter((a) => a.user_id === s.id);
  const passed = [...new Set(mine.filter((a) => a.passed).map((a) => a.lesson_id))].sort((a, b) => a - b);
  const acc = homework.filter((h) => h.user_id === s.id && h.status === 'accepted').map((h) => h.lesson_id).sort((a, b) => a - b);
  const current = Math.min(program.length, (passed.at(-1) ?? 0) + 1);
  out.push(`| ${s.full_name ?? '(без имени)'} | ${emailOf[s.id] ?? '–'} | ${d(signedIn[s.id])} | ${passed.join(', ') || '–'} | ${acc.join(', ') || '–'} | ${current} |`);
}
out.push('');

out.push('## По урокам', '', '| Участник | ' + program.map((l) => l.id).join(' | ') + ' |', '|---|' + program.map(() => '---').join('|') + '|');
for (const s of students) {
  const cells = program.map((l) => {
    const mine = attempts.filter((a) => a.user_id === s.id && a.lesson_id === l.id);
    const hw = homework.find((h) => h.user_id === s.id && h.lesson_id === l.id);
    if (!mine.length && !hw) return '·';
    const best = mine.length ? Math.max(...mine.map((a) => a.score)) : null;
    const hwText = hw ? { submitted: 'сдано', accepted: `принято ${hw.score ?? ''}/6`, needs_rework: 'доработка' }[hw.status] : 'нет задания';
    return `${best ?? '–'}/8 ×${mine.length}, ${hwText}`;
  });
  out.push(`| ${s.full_name ?? '(без имени)'} | ${cells.join(' | ')} |`);
}
out.push('');

const queue = homework.filter((h) => h.status === 'submitted');
out.push('## Задания на проверке', '');
if (!queue.length) out.push('Нет.');
for (const h of queue) {
  const s = profiles.find((p) => p.id === h.user_id);
  out.push(`- ${s?.full_name ?? '?'}, урок ${h.lesson_id}, сдано ${d(h.submitted_at)} (${daysAgo(h.submitted_at)} дн. назад): ${h.link}`);
}
out.push('');

out.push('## Кто давно не заходил', '');
const idle = students.filter((s) => (daysAgo(signedIn[s.id]) ?? 999) >= 7);
out.push(idle.length ? idle.map((s) => `- ${s.full_name ?? emailOf[s.id]}: последний вход ${d(signedIn[s.id])}`).join('\n') : 'Все заходили на этой неделе.');
out.push('');

out.push('## Трудные вопросы тестов (по первой попытке каждого участника)', '');
const correct = {};
for (const k of keys) correct[`${k.lesson_id}:${k.question_no}`] = k.correct_option;
let any = false;
for (const l of program) {
  const firsts = [];
  const seen = new Set();
  for (const a of attempts.filter((x) => x.lesson_id === l.id && profiles.find((p) => p.id === x.user_id)?.role === 'student')) {
    if (seen.has(a.user_id)) continue;
    seen.add(a.user_id);
    firsts.push(a);
  }
  if (!firsts.length) continue;
  const rows = (quizzes[l.id] ?? []).map((q, i) => {
    const right = correct[`${l.id}:${i + 1}`];
    const wrong = firsts.filter((a) => a.answers[i] !== right);
    const counts = {};
    for (const a of wrong) counts[a.answers[i]] = (counts[a.answers[i]] ?? 0) + 1;
    const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
    return { i: i + 1, text: q.text, wrong: wrong.length, of: firsts.length, top: top ? q.options[top[0] - 1] : null };
  }).filter((r) => r.wrong > 0).sort((x, y) => y.wrong - x.wrong);
  if (!rows.length) continue;
  any = true;
  out.push(`### Урок ${l.id}. ${l.title} (первых попыток: ${firsts.length})`, '');
  for (const r of rows.slice(0, 4)) {
    out.push(`- Вопрос ${r.i}: ошиблись ${r.wrong} из ${r.of}. «${r.text}»${r.top ? ` Чаще всего выбирали: «${r.top}»` : ''}`);
  }
  out.push('');
}
if (!any) out.push('Попыток пока нет или все ответили верно.', '');

console.log(out.join('\n'));
