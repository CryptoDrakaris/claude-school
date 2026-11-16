import { useEffect } from 'react';
import { useRoute } from './lib/router';
import { supabaseConfigured } from './lib/supabase';
import { useAuth } from './lib/auth';
import { Header } from './components/Header';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { Program } from './pages/Program';
import { Lesson } from './pages/Lesson';
import { Admin } from './pages/Admin';
import { Join } from './pages/Join';

export function App() {
  const route = useRoute();
  const { loading, session, profile, profileError } = useAuth();

  // После входа по ссылке в адресе остаётся служебный хэш – приводим к #/.
  useEffect(() => {
    if (session && !window.location.hash.startsWith('#/')) {
      history.replaceState(null, '', `${window.location.pathname}#/`);
    }
  }, [session]);

  if (!supabaseConfigured) {
    return (
      <main id="main" className="page page-narrow">
        <h1>Сайт не подключён к базе</h1>
        <p className="lead">Заполните файл .env по образцу .env.example и перезапустите сборку.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main id="main" className="page page-narrow" aria-busy="true">
        <p className="muted">Открываем зачётку…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <>
        <Header route={route} profile={null} />
        {route.name === 'join' ? <Join code={route.code} /> : <Login />}
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <Header route={route} profile={null} />
        <main id="main" className="page page-narrow">
          <h1>Профиль не загрузился</h1>
          <p className="lead">{profileError ?? 'Обновите страницу.'}</p>
        </main>
      </>
    );
  }

  if (!profile.full_name) {
    return (
      <>
        <Header route={route} profile={profile} />
        <Profile mode="first" />
      </>
    );
  }

  return (
    <>
      <Header route={route} profile={profile} />
      {route.name === 'program' && <Program />}
      {route.name === 'lesson' && <Lesson key={route.id} id={route.id} />}
      {route.name === 'admin' && (profile.role === 'admin' ? <Admin /> : <NotFound />)}
      {route.name === 'profile' && <Profile />}
      {route.name === 'not-found' && <NotFound />}
      {route.name === 'join' && <AlreadyIn />}
    </>
  );
}

// Пришёл по ссылке-приглашению, уже войдя в курс.
function AlreadyIn() {
  return (
    <main id="main" className="page page-narrow">
      <h1>Вы уже в курсе</h1>
      <p className="lead">
        Приглашение не нужно: вы вошли. <a href="#/">Открыть зачётку</a>
      </p>
    </main>
  );
}

function NotFound() {
  return (
    <main id="main" className="page page-narrow">
      <h1>Такой страницы нет</h1>
      <p className="lead">
        <a href="#/">Вернуться к зачётке</a>
      </p>
    </main>
  );
}
