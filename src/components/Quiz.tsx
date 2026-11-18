import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { isBlockStart, type QuizQuestion } from '../lib/content';
import type { ProgressRow } from '../lib/progress';

// До сдачи теста сервер не присылает правильный вариант и объяснение (correct/explanation = null).
interface ReviewItem {
  question_no: number;
  chosen: number;
  correct: number | null;
  is_correct: boolean;
  explanation: string | null;
}

interface QuizResult {
  score: number;
  max_score: number;
  pass_mark: number;
  passed: boolean;
  revealed?: boolean;
  best_score: number;
  review: ReviewItem[];
}

// Ответы проверяет только сервер (submit_quiz): правильных вариантов в коде сайта нет.
export function Quiz({
  lessonId,
  questions,
  row,
  canSubmit,
  nextLesson,
  onSubmitted,
}: {
  lessonId: number;
  questions: QuizQuestion[];
  row: ProgressRow | undefined;
  canSubmit: boolean;
  nextLesson: { id: number; title: string; ready: boolean } | null;
  onSubmitted: () => void;
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Фокус и прокрутка – после отрисовки: ответ сервера приходит асинхронно.
  // Результат короче формы, поэтому к его началу прокручиваем явно, иначе человек окажется у задания.
  useEffect(() => {
    if (!result) return;
    resultRef.current?.scrollIntoView({ block: 'start' });
    resultRef.current?.focus({ preventScroll: true });
  }, [result]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const missing = answers.map((a, i) => (a == null ? i + 1 : null)).filter((n): n is number => n != null);
    if (missing.length) {
      setError(
        missing.length === 1
          ? `Нет ответа на вопрос ${missing[0]}.`
          : `Нет ответов на вопросы ${missing.join(', ')}.`,
      );
      return;
    }
    setSending(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('submit_quiz', { p_lesson_id: lessonId, p_answers: answers });
    setSending(false);
    if (err) {
      setError(/[А-Яа-яЁё]/.test(err.message) ? err.message : 'Тест не отправился. Проверьте интернет и попробуйте ещё раз.');
      return;
    }
    setResult(data as QuizResult);
    onSubmitted();
  }

  function retry() {
    setAnswers(questions.map(() => null));
    setResult(null);
    setError(null);
    document.getElementById('quiz')?.scrollIntoView();
  }

  const history =
    row && row.attempts > 0 ? (
      <p className="muted">
        Лучший результат: {row.best_score} из {row.max_score}
        {row.passed ? ' – тест засчитан' : ''}. Попыток: {row.attempts}.
      </p>
    ) : null;

  if (result) {
    return (
      <div className="quiz-result" ref={resultRef} tabIndex={-1}>
        <div className="score">
          <b>
            {result.score} из {result.max_score}
          </b>
          <span className={result.passed ? 'tag tag-ok' : 'tag tag-warn'}>
            {result.passed ? 'тест сдан' : 'пока не сдан'}
          </span>
          <span className="muted">проходной – {result.pass_mark}</span>
        </div>
        <p className="lead">
          {result.passed
            ? nextLesson
              ? isBlockStart(nextLesson.id)
                ? `Это последний тест блока. Следующий блок откроется, когда владелец курса примет итоговое задание этого урока – сдайте его ниже.`
                : nextLesson.ready
                ? `Урок ${nextLesson.id} открыт. Не забудьте сдать задание этого урока.`
                : `Урок ${nextLesson.id} откроется, как только будет готов. Не забудьте сдать задание этого урока.`
              : 'Это последний тест курса. Осталось сдать задание.'
            : result.revealed === false
              ? `Нужно ${result.pass_mark} верных. Перечитайте теорию по вопросам с отметкой «неверно» и попробуйте ещё раз – в зачёт пойдёт лучший результат. Правильные ответы и объяснения откроются, когда тест будет сдан.`
              : `Нужно ${result.pass_mark} верных. Прочитайте разбор и попробуйте ещё раз – в зачёт пойдёт лучший результат.`}
          {result.best_score > result.score && ` Ваш лучший результат – ${result.best_score}.`}
        </p>

        <ol className="review">
          {result.review.map((r) => {
            const q = questions[r.question_no - 1];
            return (
              <li key={r.question_no} className="review-item">
                <p>
                  <span className={r.is_correct ? 'verdict yes' : 'verdict no'}>
                    Вопрос {r.question_no} – {r.is_correct ? 'верно' : 'неверно'}.
                  </span>{' '}
                  {q.text}
                </p>
                {!r.is_correct && (
                  <p className="muted">
                    Ваш ответ: {q.options[r.chosen - 1]}.
                    {r.correct != null && <> Верно: {q.options[r.correct - 1]}.</>}
                  </p>
                )}
                {r.explanation && <p className="muted">{r.explanation}</p>}
              </li>
            );
          })}
        </ol>

        <div className="row">
          <button type="button" className={result.passed ? 'link-button' : 'btn'} onClick={retry}>
            Пройти тест ещё раз
          </button>
          {result.passed && nextLesson?.ready && !isBlockStart(nextLesson.id) && <a href={`#/lesson/${nextLesson.id}`}>Перейти к уроку {nextLesson.id}</a>}
        </div>
      </div>
    );
  }

  return (
    <form className="quiz" onSubmit={submit} noValidate>
      {history}
      {questions.map((q, qi) => (
        <fieldset key={qi} className="q">
          <legend>
            <span className="q-no">{qi + 1}.</span> {q.text}
          </legend>
          {q.options.map((opt, oi) => (
            <label key={oi} className="option">
              <input
                type="radio"
                name={`q${qi}`}
                value={oi + 1}
                checked={answers[qi] === oi + 1}
                onChange={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? oi + 1 : a)))}
                disabled={!canSubmit}
              />
              <span>{opt}</span>
            </label>
          ))}
        </fieldset>
      ))}
      {error && (
        <p className="field-error" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      {canSubmit ? (
        <button type="submit" className="btn" disabled={sending}>
          {sending ? 'Проверяем…' : 'Сдать тест'}
        </button>
      ) : (
        <p className="muted">Вы владелец курса: тест показан для чтения, сдают его участники.</p>
      )}
    </form>
  );
}
