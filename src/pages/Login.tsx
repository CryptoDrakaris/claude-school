import { useState, type FormEvent } from 'react';
import { linkError, redirectUrl, supabase } from '../lib/supabase';
import { SITE_TITLE } from '../lib/site';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

function explain(error: { code?: string; status?: number; message: string }): string {
  const code = error.code ?? '';
  if (code === 'otp_disabled' || code === 'signup_disabled' || /signups? not allowed/i.test(error.message)) {
    return 'Этой почты нет в списке участников. Проверьте адрес или напишите владельцу курса.';
  }
  if (code.startsWith('over_') || error.status === 429) {
    return 'Писем со ссылкой за последний час было слишком много. Попробуйте через час или используйте ссылку из прошлого письма.';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') {
    return 'Похоже, в адресе почты опечатка. Проверьте его.';
  }
  return 'Ссылку отправить не получилось. Проверьте интернет и попробуйте ещё раз.';
}

export function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>(linkError ? { kind: 'error', message: linkError } : { kind: 'idle' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setState({ kind: 'error', message: 'Введите адрес почты целиком, например anna@mail.ru.' });
      return;
    }
    setState({ kind: 'sending' });
    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: { shouldCreateUser: false, emailRedirectTo: redirectUrl },
    });
    setState(error ? { kind: 'error', message: explain(error) } : { kind: 'sent', email: value });
  }

  if (state.kind === 'sent') {
    return (
      <main id="main" className="page page-narrow">
        <p className="label">{SITE_TITLE}</p>
        <h1>Проверьте почту</h1>
        <p className="lead">
          Ссылка для входа ушла на <strong>{state.email}</strong>. Откройте письмо и нажмите на ссылку – сайт откроется
          уже с входом.
        </p>
        <p className="muted">
          Письма нет за пару минут – загляните в «Спам». Ссылка одноразовая и действует час.
        </p>
        <button type="button" className="link-button" onClick={() => setState({ kind: 'idle' })}>
          Ввести другой адрес
        </button>
      </main>
    );
  }

  const error = state.kind === 'error' ? state.message : null;
  return (
    <main id="main" className="page page-narrow">
      <p className="label">{SITE_TITLE}</p>
      <h1>Вход</h1>
      <p className="lead">Пароль не нужен: введите почту, на которую пришло приглашение, и мы пришлём ссылку для входа.</p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">Почта</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'email-error' : undefined}
            required
          />
          {error && (
            <p id="email-error" className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="btn" disabled={state.kind === 'sending'}>
          {state.kind === 'sending' ? 'Отправляем…' : 'Получить ссылку для входа'}
        </button>
      </form>
    </main>
  );
}
