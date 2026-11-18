import { useEffect, useState } from 'react';
import { program } from './content';

// Хэш-маршрутизация (#/lesson/1): на GitHub Pages нет 404 при обновлении страницы.
export type Route =
  | { name: 'program' }
  | { name: 'lesson'; id: number }
  | { name: 'admin' }
  | { name: 'profile' }
  | { name: 'join'; code: string }
  | { name: 'not-found' };

export function parseHash(hash: string): Route {
  // Хэш не нашего вида (#access_token=… из ссылки входа) – это главная.
  if (!hash.startsWith('#/')) return { name: 'program' };
  const path = hash.slice(1).split('?')[0];
  if (path === '/') return { name: 'program' };
  const lesson = path.match(/^\/lesson\/([1-9]\d?)$/);
  if (lesson && program.some((l) => l.id === Number(lesson[1]))) return { name: 'lesson', id: Number(lesson[1]) };
  if (path === '/admin') return { name: 'admin' };
  if (path === '/profile') return { name: 'profile' };
  const join = path.match(/^\/join\/([A-Za-z0-9_-]{12,64})$/);
  if (join) return { name: 'join', code: join[1] };
  return { name: 'not-found' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
