-- Исправление: русские тексты ошибок в функциях были искажены при первом применении (кодировка буфера обмена).
-- Пересоздаёт три функции без изменения логики. Применять в SQL Editor целиком.

create or replace function public.homework_guard()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'submitted';
    new.score := null;
    new.admin_comment := null;
    new.reviewed_at := null;
    new.submitted_at := now();
    return new;
  end if;

  -- UPDATE
  new.id := old.id;
  new.user_id := old.user_id;
  new.lesson_id := old.lesson_id;

  if public.is_admin() then
    new.link := old.link;
    new.comment := old.comment;
    new.submitted_at := old.submitted_at;
    if new.status is distinct from old.status
       or new.score is distinct from old.score
       or new.admin_comment is distinct from old.admin_comment then
      new.reviewed_at := now();
    else
      new.reviewed_at := old.reviewed_at;
    end if;
  else
    if old.status <> 'needs_rework' then
      raise exception 'Задание можно изменить только после статуса «на доработку»' using errcode = '42501';
    end if;
    new.status := 'submitted';
    new.score := old.score;
    new.admin_comment := old.admin_comment;
    new.reviewed_at := old.reviewed_at;
    new.submitted_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.submit_quiz(p_lesson_id int, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_max int;
  v_score int;
  v_passed boolean;
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

  select
    count(*) filter (where (p_answers ->> (k.question_no - 1))::int = k.correct_option),
    jsonb_agg(
      jsonb_build_object(
        'question_no', k.question_no,
        'chosen', (p_answers ->> (k.question_no - 1))::int,
        'correct', k.correct_option,
        'is_correct', (p_answers ->> (k.question_no - 1))::int = k.correct_option,
        'explanation', k.explanation
      ) order by k.question_no
    )
  into v_score, v_review
  from public.quiz_keys k
  where k.lesson_id = p_lesson_id;

  v_passed := v_score >= public._pass_mark(v_max);

  insert into public.quiz_attempts (user_id, lesson_id, answers, score, max_score, passed)
  values (v_user, p_lesson_id, p_answers, v_score, v_max, v_passed);

  select max(score) into v_best
  from public.quiz_attempts where user_id = v_user and lesson_id = p_lesson_id;

  return jsonb_build_object(
    'score', v_score,
    'max_score', v_max,
    'pass_mark', public._pass_mark(v_max),
    'passed', v_passed,
    'best_score', v_best,
    'review', v_review
  );
end;
$$;

create or replace function public.admin_progress()
returns table (
  user_id uuid,
  full_name text,
  email text,
  lesson_id int,
  is_open boolean,
  opened_at timestamptz,
  best_score int,
  max_score int,
  attempts int,
  passed boolean,
  two_failed boolean,
  hw_status text,
  hw_score int,
  hw_submitted_at timestamptz,
  last_activity timestamptz,
  lagging boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Только для владельца' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, u.email::text,
           g.lesson_id, g.is_open, g.opened_at, g.best_score, g.max_score, g.attempts,
           g.passed, g.two_failed, g.hw_status, g.hw_score, g.hw_submitted_at,
           g.last_activity, g.lagging
    from public.profiles p
    join auth.users u on u.id = p.id
    cross join lateral public._progress(p.id) g
    where p.role = 'student'
    order by p.full_name nulls last, u.email, g.lesson_id;
end;
$$;

-- create or replace сохраняет права на функции; на всякий случай повторяем.
revoke execute on function public.homework_guard(), public.submit_quiz(int, jsonb), public.admin_progress() from public, anon, authenticated;
grant execute on function public.submit_quiz(int, jsonb), public.admin_progress() to authenticated;
