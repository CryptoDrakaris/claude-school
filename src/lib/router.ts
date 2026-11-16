import { useEffect, useState } from 'react';

// Хэш-маршрутизация (#/lesson/1): на GitHub Pages нет 404 при обновлении страницы.
export type Route =
  | { name: 'program' }
  | { name: 'lesson'; id: number }
  | { name: 'admin' }
  | { name: 'profile' }
  | { name: 'not-found' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/') return { name: 'program' };
  const lesson = path.match(/^\/lesson\/(\d+)$/);
  if (lesson) return { name: 'lesson', id: Number(lesson[1]) };
  if (path === '/admin') return { name: 'admin' };
  if (path === '/profile') return { name: 'profile' };
  return { name: 'not-found' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
