import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

// mode="first" – экран при первом входе: без имени дальше не пускаем.
export function Profile({ mode = 'edit' }: { mode?: 'first' | 'edit' }) {
  const { profile, session, reloadProfile, signOut } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !profile) return;
    const value = name.trim().replace(/\s+/g, ' ');
    if (value.length < 2) {
      setError('Напишите имя хотя бы из двух букв – так владелец поймёт, кто сдаёт задания.');
      return;
    }
    if (value.length > 80) {
      setError('Слишком длинно: хватит имени и фамилии, до 80 знаков.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('profiles').update({ full_name: value }).eq('id', profile.id);
    setSaving(false);
    if (err) {
      setError('Имя не сохранилось. Проверьте интернет и попробуйте ещё раз.');
      return;
    }
    setSaved(true);
    await reloadProfile();
    if (mode === 'first') window.location.hash = '#/';
  }

  return (
    <main id="main" className="page page-narrow">
      <p className="label">{mode === 'first' ? 'Первый вход' : 'Профиль'}</p>
      <h1>{mode === 'first' ? 'Как вас записать в зачётку?' : 'Профиль'}</h1>
      <p className="lead">
        {mode === 'first'
          ? 'Имя увидит только владелец курса – в ведомости и при проверке заданий.'
          : 'Имя видит только владелец курса.'}
      </p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="full-name">Имя и фамилия</label>
          <input
            id="full-name"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'name-error' : undefined}
          />
          {error && (
            <p id="name-error" className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="row">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Сохраняем…' : mode === 'first' ? 'Записать и начать' : 'Сохранить имя'}
          </button>
          {saved && mode === 'edit' && (
            <span className="muted" role="status">
              Сохранено
            </span>
          )}
        </div>
      </form>

      <dl className="facts">
        <dt>Почта для входа</dt>
        <dd>{session?.user.email}</dd>
        <dt>Роль</dt>
        <dd>{profile?.role === 'admin' ? 'владелец курса' : 'участник'}</dd>
      </dl>

      <button type="button" className="link-button" onClick={signOut}>
        Выйти
      </button>
    </main>
  );
}
