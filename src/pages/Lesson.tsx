import { useEffect, useMemo, useState } from 'react';
import { loadLesson, program, renderMarkdown, type LessonContent } from '../lib/content';
import { useAuth } from '../lib/auth';
import { lessonStatus, useProgress } from '../lib/progress';

const STEPS = [
  { id: 'theory', title: 'Теория' },
  { id: 'practice', title: 'Практика' },
  { id: 'quiz', title: 'Тест' },
  { id: 'homework', title: 'Задание' },
] as const;

function goTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

export function Lesson({ id }: { id: number }) {
  const meta = program.find((l) => l.id === id)!;
  const { profile } = useAuth();
  const { rows } = useProgress();
  const [content, setContent] = useState<LessonContent | null>(null);

  useEffect(() => {
    setContent(null);
    loadLesson(meta).then(setContent);
  }, [meta]);

  const html = useMemo(
    () =>
      content && {
        lesson: content.lesson ? renderMarkdown(content.lesson) : null,
        practice: content.practice ? renderMarkdown(content.practice) : null,
        homework: content.homework ? renderMarkdown(content.homework) : null,
      },
    [content],
  );

  const row = rows?.find((r) => r.lesson_id === id);
  const isAdmin = profile?.role === 'admin';
  if (rows && !isAdmin && lessonStatus(row) === 'closed') {
    return (
      <main id="main" className="page">
        <p className="label">Урок {id}</p>
        <h1>{meta.title}</h1>
        <p className="lead">
          Урок откроется, когда тест урока {id - 1} будет сдан на 6 из 8. <a href="#/">К зачётке</a>
        </p>
      </main>
    );
  }

  return (
    <main id="main" className="page">
      <p className="label">Урок {id} из {program.length}</p>
      <h1>{meta.title}</h1>
      <p className="lead">{meta.about}</p>

      {meta.ready && (
        <nav className="steps" aria-label="Шаги урока">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button type="button" onClick={() => goTo(s.id)}>
                  <span className="steps-no">{i + 1}</span> {s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {!html && (
        <p className="muted" aria-busy="true">
          Загружаем урок…
        </p>
      )}

      {html?.lesson && (
        <section id="theory" tabIndex={-1} aria-labelledby="h-theory" className="lesson-section">
          {meta.ready && <h2 id="h-theory">Теория</h2>}
          <div className="prose" dangerouslySetInnerHTML={{ __html: html.lesson }} />
        </section>
      )}

      {html?.practice && (
        <section id="practice" tabIndex={-1} aria-labelledby="h-practice" className="lesson-section">
          <h2 id="h-practice">Практика</h2>
          <div className="prose" dangerouslySetInnerHTML={{ __html: html.practice }} />
        </section>
      )}

      {content?.quiz && (
        <section id="quiz" tabIndex={-1} aria-labelledby="h-quiz" className="lesson-section">
          <h2 id="h-quiz">Тест</h2>
          <p className="lead">
            {content.quiz.length} вопросов, в каждом один верный ответ. Засчитывается от 6 верных; пересдавать можно
            сколько угодно, в зачёт идёт лучший результат.
          </p>
          <form className="quiz" onSubmit={(e) => e.preventDefault()}>
            {content.quiz.map((q, qi) => (
              <fieldset key={qi} className="q">
                <legend>
                  <span className="q-no">{qi + 1}.</span> {q.text}
                </legend>
                {q.options.map((opt, oi) => (
                  <label key={oi} className="option">
                    <input type="radio" name={`q${qi}`} value={oi + 1} />
                    <span>{opt}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <button type="submit" className="btn" disabled>
              Сдать тест
            </button>
            <p className="muted">Отправка теста заработает на следующем этапе.</p>
          </form>
        </section>
      )}

      {html?.homework && (
        <section id="homework" tabIndex={-1} aria-labelledby="h-homework" className="lesson-section">
          <h2 id="h-homework">Задание</h2>
          <div className="prose" dangerouslySetInnerHTML={{ __html: html.homework }} />
          <p className="muted">Форма сдачи задания появится на следующем этапе.</p>
        </section>
      )}

      <nav className="lesson-nav" aria-label="Соседние уроки">
        <a href="#/">← К зачётке</a>
        {id < program.length && (isAdmin || row?.passed) && (
          <a href={`#/lesson/${id + 1}`}>Урок {id + 1} →</a>
        )}
      </nav>
    </main>
  );
}
