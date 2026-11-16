# Учимся работать с Claude

Закрытый сайт с уроками по работе с Claude для небольшой группы. Сайт: https://cryptodrakaris.github.io/claude-school/ (после этапа 7).

Правила проекта и порядок работы – в [CLAUDE.md](CLAUDE.md).

## Запуск у себя

```
npm install
cp .env.example .env   # заполнить URL и anon-ключ Supabase
npm run dev            # http://localhost:5173/claude-school/
```

## Проверки

- `npm run check:typo` – длинное тире и прямые кавычки в русском тексте
- `npm run check:secrets` – ключи и секреты в индексе git (запускается перед каждым коммитом)
- `npm run check` – всё вместе и сборка

- `npm run test:sql` – миграции и права доступа на локальном Postgres (PGlite), без сети
- `npm run test:rls` – права доступа на живой базе Supabase (нужен ключ service role в `.env`)

## База данных

Миграции – `supabase/migrations/`, по порядку имён. Применять в Supabase → SQL Editor: вставить файл целиком → Run.

## Как загрузить ключи ответов

1. Заполнить `supabase/seed/quiz_keys.json` (формат – в начале `scripts/seed-keys.mjs`). Файл в git не попадает.
2. В `.env` вписать `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API Keys → secret key).
3. `npm run seed:keys`.
4. Сохранить копию `quiz_keys.json` вне репозитория: в git его нет, потеряется вместе с компьютером.

Разделы «Как добавить урок» и «Как пригласить участника» появятся на этапах 4 и 7.
