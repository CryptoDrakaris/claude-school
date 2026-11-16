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

Supabase → Authentication → Users → Add user → Send invitation → почта участника. Профиль с ролью «участник» создаётся сам; имя человек вводит при первом входе.

Встроенная почта Supabase отправляет письма только адресам участников организации Supabase и не больше нескольких в час. Для приглашения друзей нужен свой SMTP – проще всего отдельный ящик Gmail:

1. Завести ящик Gmail для рассылки курса, включить в нём двухэтапную проверку, создать **пароль приложения** (Google Account → Security → App passwords).
2. Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP:
   - Sender email – адрес ящика, Sender name – «Учимся работать с Claude»;
   - Host `smtp.gmail.com`, Port `465`, Username – адрес ящика, Password – пароль приложения.
3. Authentication → Emails → Templates: в **Invite user** и **Magic Link** вставить тексты из `supabase/templates/invite.html` и `magic_link.html`, тему письма – из комментария в начале файла. Иначе письма придут на английском.
4. Пригласить себя ещё раз или запросить ссылку на сайте – убедиться, что письмо пришло по-русски и не в «Спам».

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
