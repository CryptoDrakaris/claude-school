import type { Route } from '../lib/router';
import type { Profile } from '../lib/auth';
import { SITE_TITLE } from '../lib/site';

export function Header({ route, profile }: { route: Route; profile: Profile | null }) {
  const current = (name: Route['name']) => (route.name === name ? 'page' : undefined);
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        К содержанию
      </a>
      <a href="#/" className="site-title">
        {SITE_TITLE}
      </a>
      {profile?.full_name && (
        <nav aria-label="Разделы">
          <a href="#/" aria-current={current('program')}>
            Программа
          </a>
          {profile.role === 'admin' && (
            <a href="#/admin" aria-current={current('admin')}>
              Ведомость
            </a>
          )}
          <a href="#/profile" aria-current={current('profile')}>
            Профиль
          </a>
        </nav>
      )}
    </header>
  );
}
