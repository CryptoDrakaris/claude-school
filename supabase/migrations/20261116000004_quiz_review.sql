-- Аудит C3, решение владельца 16.11.2026: правильные ответы – только после сдачи теста.
-- Пока тест урока не сдан (ни в этой, ни в прошлых попытках), разбор содержит только «верно/неверно»
-- по каждому вопросу: без правильного варианта и без объяснения (объяснение почти всегда называет ответ).
-- После сдачи – полный разбор, как раньше. Логика проверки, запись попытки и права не меняются.
-- Применять в SQL Editor целиком, после 0001–0003. Функция пересоздаётся, права на неё сохраняются.

create or replace function public.submit_quiz(p_lesson_id int, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_max int;
  v_score int;
  v_passed boolean;
  v_reveal boolean;
  v_review jsonb;
  v_best int;
begin
  if v_user is null then
    raise exception 'Нужно войти' using errcode = '28000';
  end if;
  if not public._lesson_open(v_user, p_lesson_id) then
    raise exception 'Урок ещё закрыт' using errcode = '42501';
  end if;

  select count(*) into v_max from public.quiz_keys where lesson_id = p_lesson_id;
  if v_max = 0 then
    raise exception 'Тест этого урока ещё не готов';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> v_max
     or exists (
       select 1 from jsonb_array_elements(p_answers) e
       where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[1-9][0-9]?$'
     ) then
    raise exception 'Ответьте на все вопросы теста (%)', v_max using errcode = '22023';
  end if;

  select count(*) filter (where (p_answers ->> (k.question_no - 1))::int = k.correct_option)
  into v_score
  from public.quiz_keys k
  where k.lesson_id = p_lesson_id;

  v_passed := v_score >= public._pass_mark(v_max);
  -- Ключи раскрываются, только если тест сдан: сейчас или в любой прошлой попытке.
  v_reveal := v_passed or exists (
    select 1 from public.quiz_attempts a where a.user_id = v_user and a.lesson_id = p_lesson_id and a.passed
  );

  select jsonb_agg(
           jsonb_build_object(
             'question_no', k.question_no,
             'chosen', (p_answers ->> (k.question_no - 1))::int,
             'is_correct', (p_answers ->> (k.question_no - 1))::int = k.correct_option,
             'correct', case when v_reveal then k.correct_option end,
             'explanation', case when v_reveal then k.explanation end
           ) order by k.question_no
         )
  into v_review
  from public.quiz_keys k
  where k.lesson_id = p_lesson_id;

  insert into public.quiz_attempts (user_id, lesson_id, answers, score, max_score, passed)
  values (v_user, p_lesson_id, p_answers, v_score, v_max, v_passed);

  select max(score) into v_best
  from public.quiz_attempts where user_id = v_user and lesson_id = p_lesson_id;

  return jsonb_build_object(
    'score', v_score,
    'max_score', v_max,
    'pass_mark', public._pass_mark(v_max),
    'passed', v_passed,
    'revealed', v_reveal,
    'best_score', v_best,
    'review', v_review
  );
end;
$$;

revoke execute on function public.submit_quiz(int, jsonb) from public, anon;
grant execute on function public.submit_quiz(int, jsonb) to authenticated;
