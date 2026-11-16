#!/usr/bin/env node
// Проверка типографики: длинное тире (U+2014) запрещено везде,
// прямые кавычки запрещены в русском тексте content/ и в строках интерфейса src/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const EM_DASH = '—';
const CYR = /[А-Яа-яЁё]/;
const problems = [];

function walk(dir, exts) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p, exts));
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}

function report(file, line, msg, text) {
  problems.push(`${relative(ROOT, file)}:${line}: ${msg}: ${text.trim().slice(0, 120)}`);
}

function checkEmDash(file, lines) {
  lines.forEach((l, i) => {
    if (l.includes(EM_DASH)) report(file, i + 1, 'длинное тире, нужно среднее (–)', l);
  });
}

// Markdown: прямые кавычки в строках с кириллицей, вне блоков кода и `инлайн-кода`.
function checkMarkdown(file, lines) {
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const text = l.replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']').replace(/<[^>]+>/g, '');
    if (CYR.test(text) && /"/.test(text)) report(file, i + 1, 'прямые кавычки, нужны «ёлочки»', l);
  });
}

// JSON: каждое строковое значение с кириллицей не должно содержать прямых кавычек.
function checkJson(file, raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    problems.push(`${relative(ROOT, file)}: JSON не читается: ${e.message}`);
    return;
  }
  const visit = (v, path) => {
    if (typeof v === 'string') {
      if (CYR.test(v) && v.includes('"')) problems.push(`${relative(ROOT, file)}: ${path}: прямые кавычки, нужны «ёлочки»: ${v.slice(0, 120)}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) visit(v[k], `${path}.${k}`);
  };
  visit(data, '$');
}

// Код: строки в '...' и `...` и текст JSX между тегами – с кириллицей и прямыми кавычками.
function checkSource(file, lines) {
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    const segments = [
      ...(l.match(/'(?:[^'\\]|\\.)*'/g) ?? []),
      ...(l.match(/`(?:[^`\\]|\\.)*`/g) ?? []),
      ...(l.match(/>[^<>{}]*</g) ?? []),
    ];
    for (const s of segments) {
      if (CYR.test(s) && (s.slice(1, -1).includes('"') || s.includes('&quot;'))) {
        report(file, i + 1, 'прямые кавычки в тексте интерфейса, нужны «ёлочки»', l);
        break;
      }
    }
  });
}

for (const file of walk(join(ROOT, 'content'), ['.md', '.json'])) {
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  checkEmDash(file, lines);
  if (file.endsWith('.md')) checkMarkdown(file, lines);
  else checkJson(file, raw);
}

for (const file of [...walk(join(ROOT, 'src'), ['.ts', '.tsx', '.css']), join(ROOT, 'index.html')]) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = raw.split('\n');
  checkEmDash(file, lines);
  if (!file.endsWith('.css')) checkSource(file, lines);
}

if (problems.length) {
  console.error(`check:typo – найдено ${problems.length}:\n` + problems.join('\n'));
  process.exit(1);
}
console.log('check:typo – чисто');
