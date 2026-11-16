import { useRoute } from './lib/router';
import { supabaseConfigured } from './lib/supabase';

export const SITE_TITLE = 'Учимся работать с Claude';

// Каркас этапа 1: маршруты есть, страницы появятся на этапах 3–6.
export function App() {
  const route = useRoute();

  return (
    <>
      <header className="site-header">
        <a href="#/" className="site-title">
          {SITE_TITLE}
        </a>
      </header>
      <main className="page">
        {!supabaseConfigured && (
          <p className="notice" role="status">
            Сайт ещё не подключён к базе данных. Заполните файл .env по образцу .env.example.
          </p>
        )}
        {route.name === 'program' && <h1>Программа</h1>}
        {route.name === 'lesson' && <h1>Урок {route.id}</h1>}
        {route.name === 'admin' && <h1>Панель владельца</h1>}
        {route.name === 'profile' && <h1>Профиль</h1>}
        {route.name === 'not-found' && (
          <>
            <h1>Страница не найдена</h1>
            <p>
              <a href="#/">Вернуться к программе</a>
            </p>
          </>
        )}
      </main>
    </>
  );
}
