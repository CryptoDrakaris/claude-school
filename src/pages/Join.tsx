import { useEffect, useState, type FormEvent } from 'react';
import { redirectUrl, supabase } from '../lib/supabase';
import { SITE_TITLE } from '../lib/site';

// Регистрация по ссылке-приглашению: #/join/<код>. Код проверяет сервер (check_invite и триггер
// регистрации); здесь – только понятные сообщения.
type State =
  | { kind: 'checking' }
  | { kind: 'invalid' }
  | { kind: 'form' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

export function Join({ code }: { code: string }) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc('check_invite', { p_code: code }).then(({ data, error }) => {
      setState(error || data !== true ? { kind: 'invalid' } : { kind: 'form' });
    });
  }, [code]);

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
      options: { shouldCreateUser: true, data: { invite: code }, emailRedirectTo: redirectUrl },
    });
    if (!error) {
      setState({ kind: 'sent', email: value });
      return;
    }
    const code_ = error.code ?? '';
    if (code_.startsWith('over_') || error.status === 429) {
      setState({ kind: 'error', message: 'Писем за последний час было слишком много. Попробуйте через час.' });
    } else if (/database error|unexpected_failure/i.test(`${code_} ${error.message}`)) {
      // Триггер регистрации отклонил код: истёк, отозван или уже использован.
      setState({ kind: 'invalid' });
    } else {
      setState({ kind: 'error', message: 'Письмо отправить не получилось. Проверьте интернет и попробуйте ещё раз.' });
    }
  }

  if (state.kind === 'checking') {
    return (
      <main id="main" className="page page-narrow" aria-busy="true">
        <p className="muted">Проверяем приглашение…</p>
      </main>
    );
  }

  if (state.kind === 'invalid') {
    return (
      <main id="main" className="page page-narrow">
        <p className="label">{SITE_TITLE}</p>
        <h1>Приглашение не действует</h1>
        <p className="lead">
          Ссылка устарела, отозвана или уже использована. Попросите у владельца курса новую. Если вы уже
          зарегистрированы – <a href="#/">войдите по почте</a>.
        </p>
      </main>
    );
  }

  if (state.kind === 'sent') {
    return (
      <main id="main" className="page page-narrow">
        <p className="label">{SITE_TITLE}</p>
        <h1>Проверьте почту</h1>
        <p className="lead">
          Письмо ушло на <strong>{state.email}</strong>. Откройте его и нажмите на ссылку – так вы подтвердите почту и
          сразу попадёте в курс.
        </p>
        <p className="muted">Письма нет за пару минут – загляните в «Спам». Ссылка в письме одноразовая.</p>
      </main>
    );
  }

  const error = state.kind === 'error' ? state.message : null;
  return (
    <main id="main" className="page page-narrow">
      <p className="label">{SITE_TITLE}</p>
      <h1>Приглашение на курс</h1>
      <p className="lead">
        Восемь коротких уроков о работе с Claude, тест и задание после каждого. Введите почту – пришлём письмо для
        подтверждения. Пароль не нужен: дальше вы будете входить по ссылке из письма, а на эту почту придут
        результаты тестов и заданий.
      </p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="join-email">Почта</label>
          <input
            id="join-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'join-error' : undefined}
          />
          {error && (
            <p id="join-error" className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="btn" disabled={state.kind === 'sending'}>
          {state.kind === 'sending' ? 'Отправляем…' : 'Получить письмо'}
        </button>
      </form>
    </main>
  );
}
