#!/usr/bin/env node
// Проверка, что в git не уходят секреты.
// По умолчанию смотрит файлы, добавленные в индекс (перед коммитом); с --all – все файлы в git.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const all = process.argv.includes('--all');
const cmd = all ? 'git ls-files' : 'git diff --cached --name-only --diff-filter=ACMR';
const files = execSync(cmd, { encoding: 'utf8' }).split('\n').filter(Boolean);

const FORBIDDEN_FILES = [/(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/, /quiz_keys\.[a-z]+$/];

const PATTERNS = [
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT (ключ Supabase или токен)'],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'секретный ключ Supabase'],
  [/sb_publishable_[A-Za-z0-9_-]{10,}/, 'ключ Supabase (публичный, но ему место в .env и переменных GitHub)'],
  [/SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/, 'значение ключа service role'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'закрытый ключ'],
  [/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/, 'токен GitHub'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'ключ Anthropic API'],
  [/postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/, 'строка подключения к базе с паролем'],
];

const problems = [];
for (const f of files) {
  if (FORBIDDEN_FILES.some((re) => re.test(f))) {
    problems.push(`${f}: этот файл не должен попадать в git`);
    continue;
  }
  if (!existsSync(f) || f.startsWith('scripts/check-secrets')) continue;
  let text;
  try {
    text = all ? readFileSync(f, 'utf8') : execSync(`git show :"${f}"`, { encoding: 'utf8', maxBuffer: 20e6 });
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const [re, what] of PATTERNS) if (re.test(line)) problems.push(`${f}:${i + 1}: ${what}`);
  });
}

if (problems.length) {
  console.error('check:secrets – найдено:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`check:secrets – чисто (${files.length} файлов)`);
