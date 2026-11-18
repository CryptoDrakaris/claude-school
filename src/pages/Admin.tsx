import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { blocks, program } from '../lib/content';
import { STATUS_TEXT, lessonStatus, type ProgressRow } from '../lib/progress';
import { Invites } from '../components/Invites';

// Экран владельца. Вопрос экрана: кого проверить и кто отстаёт.

interface AdminRow extends ProgressRow {
  user_id: string;
  full_name: string | null;
  email: string;
}

interface QueueItem {
  id: number;
  user_id: string;
  lesson_id: number;
  link: string;
  comment: string | null;
  submitted_at: string;
}

interface Student {
  id: string;
  name: string;
  lessons: Map<number, AdminRow>;
  lastActivity: string | null;
}

const CRITERIA = [
  { key: 'task', title: 'Задача решена', hint: '0 – результата нет, 1 – есть, но не пригодится, 2 – можно пользоваться' },
  { key: 'prompt', title: 'Запрос поставлен грамотно', hint: '0 – одна фраза, 1 – контекста не хватает, 2 – понятно что, для кого, в каком виде; ответ доработан' },
  { key: 'check', title: 'Результат проверен', hint: '0 – не проверяли, 1 – проверили без выводов, 2 – два факта по первоисточнику' },
] as const;
type CriterionKey = (typeof CRITERIA)[number]['key'];

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const lessonTitle = (id: number) => program.find((l) => l.id === id)?.title ?? `Урок ${id}`;

function lagReason(row: AdminRow): string {
  return row.two_failed ? 'два теста подряд ниже порога' : 'задание не сдано больше 7 дней';
}

export function Admin() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [unlocks, setUnlocks] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [progress, hw, un] = await Promise.all([
      // Готовые уроки: «задание не сдано» считается только по ним (аудит C1).
      supabase.rpc('admin_progress', { p_ready: program.filter((l) => l.ready).map((l) => l.id) }),
      supabase
        .from('homework')
        .select('id, user_id, lesson_id, link, comment, submitted_at')
        .eq('status', 'submitted')
        .order('submitted_at'),
      supabase.from('lesson_unlocks').select('user_id, lesson_id'),
    ]);
    if (progress.error || hw.error || un.error) {
      setError('Данные не загрузились. Обновите страницу.');
      return;
    }
    const byUser = new Map<string, Student>();
    for (const r of progress.data as AdminRow[]) {
      let s = byUser.get(r.user_id);
      if (!s) {
        s = { id: r.user_id, name: r.full_name || r.email, lessons: new Map(), lastActivity: null };
        byUser.set(r.user_id, s);
      }
      s.lessons.set(r.lesson_id, r);
      if (r.last_activity && (!s.lastActivity || r.last_activity > s.lastActivity)) s.lastActivity = r.last_activity;
    }
    setStudents([...byUser.values()]);
    setQueue(hw.data as QueueItem[]);
    setUnlocks(new Set((un.data ?? []).map((u) => `${u.user_id}:${u.lesson_id}`)));
    setError(null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nameOf = (userId: string) => students?.find((s) => s.id === userId)?.name ?? 'Участник';
  const lagging = (students ?? []).flatMap((s) =>
    [...s.lessons.values()].filter((r) => r.lagging).map((r) => ({ student: s, row: r })),
  );

  async function setUnlock(userId: string, lessonId: number, open: boolean) {
    if (!supabase) return;
    const { error: err } = open
      ? await supabase.from('lesson_unlocks').insert({ user_id: userId, lesson_id: lessonId })
      : await supabase.from('lesson_unlocks').delete().match({ user_id: userId, lesson_id: lessonId });
    if (err) {
      setError('Не получилось изменить доступ к уроку. Попробуйте ещё раз.');
      return;
    }
    await load();
  }

  return (
    <main id="main" className="page page-wide">
      <p className="label">Владелец курса</p>
      <h1>Ведомость</h1>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {students && queue && (
        <p className="lead">
          {queue.length ? `На проверке заданий: ${queue.length}.` : 'Непроверенных заданий нет.'}{' '}
          {lagging.length
            ? `Отстают: ${lagging.map(({ student, row }) => `${student.name} (урок ${row.lesson_id})`).join(', ')}.`
            : students.length
              ? 'Отстающих нет.'
              : ''}
        </p>
      )}

      <section aria-labelledby="h-queue">
        <h2 id="h-queue">Проверить</h2>
        {!queue && <p className="muted">Загружаем…</p>}
        {queue && queue.length === 0 && (
          <p className="muted">Когда участник сдаст задание, оно появится здесь. Участник увидит оценку и комментарий у себя в уроке.</p>
        )}
        {queue?.map((item) => (
          <ReviewCard key={item.id} item={item} studentName={nameOf(item.user_id)} onDone={load} />
        ))}
      </section>

      <section aria-labelledby="h-book">
        <h2 id="h-book">Участники и уроки</h2>
        {students && students.length === 0 && (
          <p className="muted">
            Участников пока нет. Пригласите их: Supabase → Authentication → Users → Add user → Send invitation.
          </p>
        )}
        {students && students.length > 0 && (
          <>
            <p className="muted legend-line">
              В клетке – лучший балл теста, число попыток и статус задания. <span className="lag-word">Отстаёт</span> – два
              теста подряд ниже порога или задание не сдано больше 7 дней после открытия урока.
            </p>
            <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="h-book">
              <table className="ledger">
                <thead>
                  <tr>
                    <td className="sticky-col" />
                    {blocks.map((b) => (
                      <th key={b.id} scope="colgroup" colSpan={b.to - b.from + 1} className="label block-head">
                        {b.id}. {b.title}
                      </th>
                    ))}
                    <td />
                  </tr>
                  <tr>
                    <th scope="col" className="label sticky-col">
                      Участник
                    </th>
                    {program.map((l) => (
                      <th key={l.id} scope="col" className="label num" title={l.title}>
                        {l.id}
                      </th>
                    ))}
                    <th scope="col" className="label">
                      Активность
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <th scope="row" className="sticky-col">
                        {s.name}
                      </th>
                      {program.map((l) => {
                        const row = s.lessons.get(l.id);
                        const manual = unlocks.has(`${s.id}:${l.id}`);
                        // Открыть вручную можно только ближайший закрытый урок – иначе в строке семь одинаковых ссылок.
                        const firstClosed = program.find((x) => lessonStatus(s.lessons.get(x.id)) === 'closed')?.id;
                        return (
                          <td key={l.id} className={row?.lagging ? 'cell lag' : 'cell'}>
                            <LedgerCell
                              row={row}
                              lessonId={l.id}
                              manual={manual}
                              canUnlock={firstClosed === l.id}
                              studentName={s.name}
                              onUnlock={(open) => setUnlock(s.id, l.id, open)}
                            />
                          </td>
                        );
                      })}
                      <td className="muted nowrap">{s.lastActivity ? dateFmt.format(new Date(s.lastActivity)) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <Invites />
    </main>
  );
}

function LedgerCell({
  row,
  lessonId,
  manual,
  canUnlock,
  studentName,
  onUnlock,
}: {
  row: AdminRow | undefined;
  lessonId: number;
  manual: boolean;
  canUnlock: boolean;
  studentName: string;
  onUnlock: (open: boolean) => void;
}) {
  const status = lessonStatus(row);
  if (status === 'closed') {
    if (!canUnlock) return <span className="muted">закрыт</span>;
    return (
      <button
        type="button"
        className="cell-action"
        onClick={() => onUnlock(true)}
        aria-label={`Открыть урок ${lessonId} для ${studentName}`}
      >
        открыть
      </button>
    );
  }
  const tag =
    status === 'hw-accepted' ? 'tag tag-ok' : status === 'hw-rework' ? 'tag tag-warn' : status === 'hw-submitted' ? 'tag tag-wait' : '';
  return (
    <div className="cell-body">
      <span className="cell-score">
        {row?.best_score != null ? `${row.best_score}/${row.max_score}` : '–'}
        {row && row.attempts > 0 && <span className="muted"> ×{row.attempts}</span>}
      </span>
      <span className={tag || 'muted'}>
        {status === 'hw-accepted' && row?.hw_score != null ? `принято ${row.hw_score}/6` : STATUS_TEXT[status]}
      </span>
      {row?.lagging && <span className="lag-word">отстаёт: {lagReason(row)}</span>}
      {manual && !row?.passed && lessonId > 1 && (
        <button
          type="button"
          className="cell-action"
          onClick={() => onUnlock(false)}
          aria-label={`Закрыть урок ${lessonId} для ${studentName}: он открыт вручную`}
        >
          открыт вручную · закрыть
        </button>
      )}
    </div>
  );
}

function ReviewCard({ item, studentName, onDone }: { item: QueueItem; studentName: string; onDone: () => void }) {
  const [scores, setScores] = useState<Record<CriterionKey, number | null>>({ task: null, prompt: null, check: null });
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const total = Object.values(scores).reduce<number>((a, b) => a + (b ?? 0), 0);
  const complete = Object.values(scores).every((v) => v != null);

  async function save(e: FormEvent, status: 'accepted' | 'needs_rework') {
    e.preventDefault();
    if (!supabase) return;
    if (!complete) {
      setError('Поставьте оценку по всем трём критериям.');
      return;
    }
    if (status === 'needs_rework' && !comment.trim()) {
      setError('Напишите, что исправить: участник увидит этот комментарий.');
      return;
    }
    setSending(true);
    setError(null);
    const { error: err } = await supabase
      .from('homework')
      .update({ status, score: total, admin_comment: comment.trim() || null })
      .eq('id', item.id);
    setSending(false);
    if (err) {
      setError('Оценка не сохранилась. Попробуйте ещё раз.');
      return;
    }
    onDone();
  }

  const idBase = `hw-${item.id}`;
  return (
    <article className="review-card" aria-labelledby={`${idBase}-title`}>
      <h3 id={`${idBase}-title`}>
        {studentName} · урок {item.lesson_id}, «{lessonTitle(item.lesson_id)}»
      </h3>
      <p className="muted">сдано {dateTimeFmt.format(new Date(item.submitted_at))}</p>
      <p>
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="break">
          {item.link}
        </a>
      </p>
      {item.comment && <blockquote className="student-comment">{item.comment}</blockquote>}

      <form onSubmit={(e) => save(e, 'accepted')} noValidate>
        {CRITERIA.map((c) => (
          <fieldset key={c.key} className="criterion">
            <legend>
              {c.title} <span className="muted">– {c.hint}</span>
            </legend>
            <div className="seg">
              {[0, 1, 2].map((v) => (
                <label key={v} className="seg-option">
                  <input
                    type="radio"
                    name={`${idBase}-${c.key}`}
                    value={v}
                    checked={scores[c.key] === v}
                    onChange={() => setScores((p) => ({ ...p, [c.key]: v }))}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <p className="total">
          Итого: <b>{complete ? total : '–'}</b> из 6
        </p>
        <div className="field">
          <label htmlFor={`${idBase}-comment`}>Комментарий участнику</label>
          <textarea
            id={`${idBase}-comment`}
            rows={3}
            maxLength={4000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-describedby={`${idBase}-comment-hint`}
          />
          <p id={`${idBase}-comment-hint`} className="muted">
            До 4000 знаков.
          </p>
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn" disabled={sending}>
            Принять
          </button>
          <button type="button" className="btn-secondary" disabled={sending} onClick={(e) => save(e, 'needs_rework')}>
            Вернуть на доработку
          </button>
        </div>
      </form>
    </article>
  );
}
