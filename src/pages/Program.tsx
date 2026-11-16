import { program } from '../lib/content';
import { useAuth } from '../lib/auth';
import { lessonStatus, STATUS_TEXT, useProgress, type LessonStatus, type ProgressRow } from '../lib/progress';

function Mark({ status }: { status: LessonStatus }) {
  if (status === 'hw-accepted') {
    return (
      <span className="mark">
        <span className="hand" aria-hidden="true">
          Зачтено
        </span>
        <span className="tag tag-ok">принято</span>
      </span>
    );
  }
  const cls: Partial<Record<LessonStatus, string>> = {
    'hw-rework': 'tag tag-warn',
    'hw-submitted': 'tag tag-wait',
    'test-passed': 'tag tag-wait',
  };
  if (cls[status]) return <span className={cls[status]}>{STATUS_TEXT[status]}</span>;
  return <span className={status === 'closed' ? 'muted' : undefined}>{STATUS_TEXT[status]}</span>;
}

function nextStep(rows: ProgressRow[]): string {
  const byId = new Map(rows.map((r) => [r.lesson_id, r]));
  for (const meta of program) {
    const row = byId.get(meta.id);
    const status = lessonStatus(row);
    if (status === 'closed') return `Урок ${meta.id} откроется, когда тест урока ${meta.id - 1} будет сдан на 6 из 8.`;
    if (status === 'open' && !meta.ready) return `Урок ${meta.id}, «${meta.title}», ещё готовится – владелец курса сообщит, когда он появится.`;
    if (status === 'open') return `Следующий шаг – урок ${meta.id}, «${meta.title}»: прочитать, сделать практику, сдать тест.`;
    if (status === 'test-passed') return `Тест урока ${meta.id} сдан. Осталось сдать задание.`;
    if (status === 'hw-rework') return `Задание урока ${meta.id} вернули на доработку – посмотрите комментарий.`;
  }
  return 'Все уроки пройдены.';
}

export function Program() {
  const { profile } = useAuth();
  const { rows, error } = useProgress();
  const isAdmin = profile?.role === 'admin';
  const byId = new Map((rows ?? []).map((r) => [r.lesson_id, r]));
  const accepted = (rows ?? []).filter((r) => r.hw_status === 'accepted').length;
  const inWork = (rows ?? []).filter((r) => r.is_open && r.hw_status !== 'accepted').length;

  return (
    <main id="main" className="page">
      <p className="label">Зачётная книжка</p>
      <h1>{profile?.full_name}</h1>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {rows && <p className="lead">{isAdmin ? 'Вы владелец курса: все уроки открыты для просмотра.' : nextStep(rows)}</p>}

      <table className="book" aria-busy={!rows}>
        <caption className="visually-hidden">Уроки курса и ваш результат по каждому</caption>
        <thead>
          <tr>
            <th scope="col" className="label no">
              №
            </th>
            <th scope="col" className="label">
              Урок
            </th>
            <th scope="col" className="label num">
              Тест
            </th>
            <th scope="col" className="label">
              Задание
            </th>
          </tr>
        </thead>
        <tbody>
          {program.map((meta) => {
            const row = byId.get(meta.id);
            const status = lessonStatus(row);
            const reachable = isAdmin || status !== 'closed';
            const current = !isAdmin && (status === 'open' || status === 'test-passed' || status === 'hw-rework');
            return (
              <tr key={meta.id} className={[current ? 'current' : '', reachable ? '' : 'closed'].join(' ').trim() || undefined}>
                <td className="no">{meta.id}</td>
                <td>
                  {reachable ? <a href={`#/lesson/${meta.id}`}>{meta.title}</a> : meta.title}
                  {!meta.ready && <span className="muted"> · готовится</span>}
                </td>
                <td className="num">
                  {row?.best_score != null ? (
                    <>
                      {row.best_score} из {row.max_score}
                    </>
                  ) : (
                    '–'
                  )}
                </td>
                <td>{rows ? isAdmin ? <span className="muted">–</span> : <Mark status={status} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rows && (
        <>
          <div
            className="bar"
            role="img"
            aria-label={`Пройдено уроков: ${accepted} из ${program.length}${inWork ? `, в работе: ${inWork}` : ''}`}
          >
            {program.map((meta) => {
              const row = byId.get(meta.id);
              const cls = row?.hw_status === 'accepted' ? 'done' : row?.is_open ? 'half' : '';
              return <span key={meta.id} className={cls || undefined} />;
            })}
          </div>
          <div className="progress">
            <span>
              Пройдено {accepted} из {program.length}
            </span>
            <span>В зачёт идёт лучший результат теста</span>
          </div>
        </>
      )}
    </main>
  );
}
