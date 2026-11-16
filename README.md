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

## Вход и роли

Вход – по ссылке из письма, без паролей. Самостоятельная регистрация выключена (Supabase → Authentication → Sign In / Providers → «Allow new users to sign up» выключено), войти может только приглашённый.

Адреса, куда разрешено возвращать человека после клика по ссылке (Supabase → Authentication → URL Configuration):
- Site URL: `https://cryptodrakaris.github.io/claude-school/`
- Redirect URLs: `https://cryptodrakaris.github.io/claude-school/` и `http://localhost:5173/claude-school/`

### Как пригласить участника

**Основной способ – ссылка-приглашение.** Ведомость → «Приглашения» → «Создать ссылку» (для кого, сколько человек, сколько дней действует) → «Скопировать ссылку» → отправить в мессенджере. По ссылке человек вводит почту, подтверждает её письмом и попадает в курс. Без действующего кода регистрация отклоняется на сервере (миграция 0005), даже при включённой регистрации в Supabase.

Запасной способ: Supabase → Authentication → Users → Add user → Send invitation.

### Почта (один раз)

Письма подтверждения, входа и результатов отправляет Brevo (бесплатно до 300 писем в день).

1. Зарегистрироваться на brevo.com; в Senders добавить и подтвердить адрес отправителя.
2. В разделе SMTP & API создать **SMTP-ключ** и **API-ключ** (это разные ключи).
3. Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP: Host `smtp-relay.brevo.com`, Port `587`, Username – SMTP-логин из Brevo, Password – SMTP-ключ, Sender email – подтверждённый адрес, Sender name – «Учимся работать с Claude».
4. Supabase → SQL Editor – ключ для писем с результатами (вписать свои значения, никому не пересылать):
   ```sql
   select vault.create_secret('API-ключ Brevo', 'brevo_api_key');
   select vault.create_secret('подтверждённый@адрес', 'mail_from');
   ```
5. Authentication → Sign In / Providers: **Allow new users to sign up – включить** (без кода всё равно не пустит), **Confirm email – включить**, анонимный вход – выключен.
6. Authentication → Emails → Templates: **Confirm signup**, **Magic Link**, **Invite user** – тексты из `supabase/templates/*.html`, тема – в комментарии в начале файла.
7. Проверка: создать ссылку-приглашение на 1 человека и пройти по ней со своей второй почтой.

Письма участнику уходят сами: за первый сданный тест урока и когда владелец принял задание или вернул на доработку. Пока ключа Brevo в Vault нет, письма просто не отправляются.

### Разбор прогресса

`npm run report` печатает отчёт в Markdown: сводка по людям, уроки, задания на проверке, кто давно не заходил, трудные вопросы тестов по первой попытке. Удобно попросить Claude Code: «запусти отчёт и разбери, кто отстаёт и какие темы проседают». В отчёте имена и почты – не публиковать.

### Как назначить владельца

После первого входа владельца – в SQL Editor, подставив свою почту:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'ваша@почта');
```

## Как добавить урок

1. Папка `content/lessons/NN-slug/` (номер с нулём впереди), в ней:
   - `lesson.md` – теория, 5–10 минут чтения; первая строка `# Название` (на странице она не повторяется); в конце строка «Проверено: ДД.ММ.ГГГГ» со ссылками на support.claude.com и claude.com;
   - `practice.md` – практика на своей задаче, 40–60 минут;
   - `quiz.json` – `{"questions": [{"text": "…", "options": ["…", "…", "…", "…"]}]}`, 8 вопросов, **без правильных ответов**;
   - `homework.md` – что сдать и как оценивается.
2. В `content/program.json` у урока поставить `"ready": true`.
3. Ключи – в `supabase/seed/quiz_keys.json` (номер верного варианта с 1 и объяснение), затем `npm run seed:keys`.
4. `npm run check` – типографика, секреты, сборка. Пуш в `main` выкладывает сайт.
