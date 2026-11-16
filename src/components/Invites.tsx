import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { redirectUrl, supabase } from '../lib/supabase';

// Ссылки-приглашения для ведомости владельца. Код – 16 случайных знаков (crypto), подобрать нельзя.
interface Invite {
  code: string;
  note: string | null;
  max_uses: number;
  uses: number;
  expires_at: string;
  revoked: boolean;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const linkFor = (code: string) => `${redirectUrl}#/join/${code}`;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function state(i: Invite): string {
  if (i.revoked) return 'отозвана';
  if (new Date(i.expires_at) < new Date()) return 'истекла';
  if (i.uses >= i.max_uses) return 'использована';
  return 'действует';
}

export function Invites() {
  const [list, setList] = useState<Invite[] | null>(null);
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [days, setDays] = useState(14);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: err } = await supabase
      .from('invites')
      .select('code, note, max_uses, uses, expires_at, revoked')
      .order('created_at', { ascending: false });
    if (err) {
      setError('Приглашения не загрузились. Обновите страницу.');
      return;
    }
    setList(data as Invite[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    const { error: err } = await supabase
      .from('invites')
      .insert({ code: newCode(), note: note.trim() || null, max_uses: maxUses, expires_at: expires });
    if (err) {
      setError('Ссылка не создалась. Попробуйте ещё раз.');
      return;
    }
    setNote('');
    await load();
  }

  async function revoke(code: string) {
    if (!supabase) return;
    const { error: err } = await supabase.from('invites').update({ revoked: true }).eq('code', code);
    if (err) setError('Не получилось отозвать ссылку.');
    await load();
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(linkFor(code));
      setCopied(code);
    } catch {
      setCopied(null);
      setError('Браузер не дал скопировать – выделите ссылку и скопируйте вручную.');
    }
  }

  const active = (list ?? []).filter((i) => state(i) === 'действует');
  const other = (list ?? []).filter((i) => state(i) !== 'действует');

  return (
    <section aria-labelledby="h-invites">
      <h2 id="h-invites">Приглашения</h2>
      <p className="muted legend-line">
        Отправьте ссылку другу в мессенджере. По ней он введёт почту, подтвердит её письмом и попадёт в курс. Без
        действующей ссылки зарегистрироваться нельзя.
      </p>

      <form className="invite-form" onSubmit={create} noValidate>
        <div className="field">
          <label htmlFor="inv-note">Для кого (видите только вы)</label>
          <input id="inv-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="inv-uses">Сколько человек</label>
            <input
              id="inv-uses"
              type="number"
              min={1}
              max={50}
              value={maxUses}
              onChange={(e) => setMaxUses(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="field">
            <label htmlFor="inv-days">Действует, дней</label>
            <input
              id="inv-days"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 14)))}
            />
          </div>
        </div>
        <button type="submit" className="btn">
          Создать ссылку
        </button>
      </form>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {active.map((i) => (
        <div key={i.code} className="invite">
          <p>
            <strong>{i.note || 'Без пометки'}</strong>{' '}
            <span className="muted">
              · использована {i.uses} из {i.max_uses} · до {dateFmt.format(new Date(i.expires_at))}
            </span>
          </p>
          <p className="break invite-link">{linkFor(i.code)}</p>
          <div className="row">
            <button type="button" className="btn-secondary" onClick={() => copy(i.code)}>
              {copied === i.code ? 'Скопировано' : 'Скопировать ссылку'}
            </button>
            <button type="button" className="link-button" onClick={() => revoke(i.code)}>
              Отозвать
            </button>
          </div>
        </div>
      ))}

      {other.length > 0 && (
        <details className="invite-old">
          <summary>Неактивные ссылки: {other.length}</summary>
          <ul>
            {other.map((i) => (
              <li key={i.code}>
                {i.note || 'Без пометки'} – {state(i)}, использована {i.uses} из {i.max_uses}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
