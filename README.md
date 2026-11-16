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

Разделы «Как добавить урок», «Как загрузить ключи ответов», «Как пригласить участника» появятся на этапах 2–7.
