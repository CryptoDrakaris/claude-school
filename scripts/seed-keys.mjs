#!/usr/bin/env node
// Загрузка ключей ответов в Supabase: npm run seed:keys
// Источник – supabase/seed/quiz_keys.json (в .gitignore). Нужен SUPABASE_SERVICE_ROLE_KEY в .env.
// Формат файла:
// {
//   "1": [ { "correct": 2, "explanation": "Почему верен второй вариант." }, ... 8 штук ],
//   "2": [ ... ]
// }
// Номер варианта – с 1, по порядку вариантов в content/lessons/NN-*/quiz.json.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const FILE = 'supabase/seed/quiz_keys.json';
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Заполните VITE_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env');
  process.exit(1);
}
if (!existsSync(FILE)) {
  console.error(`Нет файла ${FILE}`);
  process.exit(1);
}

const keys = JSON.parse(readFileSync(FILE, 'utf8'));

// Сверка с quiz.json: столько же вопросов, номер ответа в пределах вариантов.
function quizFor(lesson) {
  const dir = readdirSync('content/lessons').find((d) => d.startsWith(String(lesson).padStart(2, '0') + '-'));
  if (!dir) return null;
  const p = join('content/lessons', dir, 'quiz.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

const rows = [];
for (const [lessonStr, list] of Object.entries(keys)) {
  const lesson = Number(lessonStr);
  const quiz = quizFor(lesson);
  if (!quiz) throw new Error(`Урок ${lesson}: нет quiz.json`);
  if (quiz.questions.length !== list.length) {
    throw new Error(`Урок ${lesson}: в quiz.json ${quiz.questions.length} вопросов, ключей ${list.length}`);
  }
  list.forEach((k, i) => {
    const options = quiz.questions[i].options.length;
    if (!Number.isInteger(k.correct) || k.correct < 1 || k.correct > options) {
      throw new Error(`Урок ${lesson}, вопрос ${i + 1}: correct должен быть от 1 до ${options}`);
    }
    if (!k.explanation?.trim()) throw new Error(`Урок ${lesson}, вопрос ${i + 1}: нет объяснения`);
    rows.push({ lesson_id: lesson, question_no: i + 1, correct_option: k.correct, explanation: k.explanation.trim() });
  });
}

const db = createClient(url, key, { auth: { persistSession: false } });
for (const lesson of new Set(rows.map((r) => r.lesson_id))) {
  const n = rows.filter((r) => r.lesson_id === lesson).length;
  const del = await db.from('quiz_keys').delete().eq('lesson_id', lesson).gt('question_no', n);
  if (del.error) throw del.error;
}
const { error } = await db.from('quiz_keys').upsert(rows, { onConflict: 'lesson_id,question_no' });
if (error) throw error;
console.log(`Загружено ключей: ${rows.length}. Храните копию ${FILE} вне репозитория.`);
