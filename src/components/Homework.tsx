import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

interface HomeworkRow {
  id: number;
  link: string;
  comment: string | null;
  status: 'submitted' | 'accepted' | 'needs_rework';
  score: number | null;
  admin_comment: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// Ссылки на личные страницы claude.ai (чат, проект) видит только автор: принимаем только опубликованные.
const PRIVATE_CLAUDE = /^\/(chat|project|projects|new|recents)(\/|$)/;

function checkLink(value: string): string | null {
  if (!value) return 'Вставьте ссылку на чат или документ.';
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    // не ссылка – ответим ниже
  }
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) {
    return 'Нужна ссылка, которая начинается с https:// – её даёт кнопка Share в чате Claude.';
  }
  const host = url.hostname.toLowerCase();
  if ((host === 'claude.ai' || host.endsWith('.claude.ai')) && PRIVATE_CLAUDE.test(url.pathname)) {
    return 'Это адрес вашего личного чата – его не видит никто, кроме вас. Нажмите Share в правом верхнем углу чата, создайте ссылку и вставьте её: она начинается с https://claude.ai/share/.';
  }
  return null;
}

export function Homework({ lessonId, canSubmit, onChanged }: { lessonId: number; canSubmit: boolean; onChanged: () => void }) {
  const { session } = useAuth();
  // Зависим от id пользователя, а не от объекта сессии: supabase-js присылает новый объект
  // при каждом возврате во вкладку и обновлении токена (аудит N1).
  const userId = session?.user.id;
  // Пока участник правит форму, данные из базы её не перезаписывают.
  const edited = useRef(false);
  const [row, setRow] = useState<HomeworkRow | null | undefined>(undefined);
  const [link, setLink] = useState('');
  const [comment, setComment] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !userId) return;
    const { data, error: err } = await supabase
      .from('homework')
      .select('id, link, comment, status, score, admin_comment, submitted_at, reviewed_at')
      .eq('lesson_id', lessonId)
      .eq('user_id', userId)
      .maybeSingle();
    if (err) {
      setError('Не удалось загрузить задание. Обновите страницу.');
      return;
    }
    setRow(data as HomeworkRow | null);
    if (data && !edited.current) {
      setLink(data.link);
      setComment(data.comment ?? '');
    }
  }, [lessonId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !session) return;
    const value = link.trim();
    const problem = checkLink(value);
    setLinkError(problem);
    if (problem) return;
    setSending(true);
    setError(null);
    const payload = { link: value, comment: comment.trim() || null };
    const { error: err } = row
      ? await supabase.from('homework').update(payload).eq('id', row.id)
      : await supabase.from('homework').insert({ ...payload, user_id: session.user.id, lesson_id: lessonId });
    setSending(false);
    if (err) {
      setError('Задание не отправилось. Проверьте интернет и попробуйте ещё раз.');
      return;
    }
    setJustSent(true);
    edited.current = false;
    await load();
    onChanged();
  }

  if (!canSubmit) {
    return <p className="muted">Вы владелец курса: задания участников – в ведомости.</p>;
  }
  if (row === undefined && !error) return <p className="muted">Загружаем задание…</p>;

  const review = row && (row.status === 'accepted' || row.status === 'needs_rework') && (
    <div className="review-box">
      {row.status === 'accepted' ? (
        <p className="mark">
          <span className="hand" aria-hidden="true">
            Зачтено
          </span>
          <span className="tag tag-ok">принято</span>
          {row.score != null && <span>оценка {row.score} из 6</span>}
        </p>
      ) : (
        <p className="mark">
          <span className="tag tag-warn">на доработку</span>
          {row.score != null && <span>оценка {row.score} из 6</span>}
        </p>
      )}
      {row.admin_comment && (
        <blockquote className="admin-comment">
          <p>{row.admin_comment}</p>
        </blockquote>
      )}
    </div>
  );

  const editable = !row || row.status === 'needs_rework';

  return (
    <div className="homework">
      {review}

      {row && row.status === 'submitted' && (
        <div className="review-box" role="status">
          <p className="mark">
            <span className="tag tag-wait">на проверке</span>
            <span className="muted">сдано {dateFmt.format(new Date(row.submitted_at))}</span>
          </p>
          {justSent && <p>Задание отправлено. Когда владелец проверит его, здесь появятся оценка и комментарий.</p>}
        </div>
      )}

      {row && !editable && (
        <dl className="facts">
          <dt>Ссылка</dt>
          <dd>
            <a href={row.link} target="_blank" rel="noopener noreferrer">
              {row.link}
            </a>
          </dd>
          {row.comment && (
            <>
              <dt>Комментарий</dt>
              <dd className="pre">{row.comment}</dd>
            </>
          )}
        </dl>
      )}

      {editable && (
        <form onSubmit={submit} noValidate>
          {row && <p className="lead">Исправьте работу по комментарию и сдайте новую ссылку.</p>}
          <div className="field">
            <label htmlFor="hw-link">Ссылка на чат или документ</label>
            <input
              id="hw-link"
              type="url"
              inputMode="url"
              placeholder="https://claude.ai/share/…"
              value={link}
              onChange={(e) => {
                edited.current = true;
                setLink(e.target.value);
                setLinkError(null);
              }}
              aria-invalid={linkError ? true : undefined}
              aria-describedby={linkError ? 'hw-link-hint hw-link-error' : 'hw-link-hint'}
            />
            <p id="hw-link-hint" className="muted">
              Перед сдачей откройте ссылку в окне инкогнито: если просит войти или запросить доступ, владелец курса её тоже не откроет.
            </p>
            {linkError && (
              <p id="hw-link-error" className="field-error" role="alert">
                {linkError}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="hw-comment">Комментарий</label>
            <textarea
              id="hw-comment"
              rows={5}
              maxLength={4000}
              value={comment}
              onChange={(e) => {
                edited.current = true;
                setComment(e.target.value);
              }}
              aria-describedby="hw-comment-hint"
            />
            <p id="hw-comment-hint" className="muted">
              Какую задачу решали, что проверили и что оказалось, что в следующий раз напишете иначе.
            </p>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn" disabled={sending}>
            {sending ? 'Отправляем…' : row ? 'Сдать заново' : 'Сдать задание'}
          </button>
        </form>
      )}
    </div>
  );
}
