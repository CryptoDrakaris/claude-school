-- Этап 2: схема, права, RLS и серверные функции сайта «Учимся работать с Claude».
-- Применять целиком: Supabase → SQL Editor → вставить файл → Run.

-- =========================================================================
-- Таблицы
-- =========================================================================

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text check (full_name is null or char_length(full_name) between 1 and 80),
  role text not null default 'student' check (role in ('student', 'admin')),
  created_at timestamptz not null default now()
);

-- Ключи ответов: участникам не видны вообще. Варианты нумеруются с 1.
create table public.quiz_keys (
  lesson_id int not null check (lesson_id between 1 and 8),
  question_no int not null check (question_no between 1 and 20),
  correct_option int not null check (correct_option >= 1),
  explanation text not null,
  primary key (lesson_id, question_no)
);

create table public.quiz_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id int not null check (lesson_id between 1 and 8),
  answers jsonb not null,
  score int not null,
  max_score int not null,
  passed boolean not null,
  created_at timestamptz not null default now()
);
create index quiz_attempts_user_lesson on public.quiz_attempts (user_id, lesson_id, created_at desc);

-- Одно задание на участника и урок; пересдача – правка той же записи в статусе needs_rework.
create table public.homework (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id int not null check (lesson_id between 1 and 8),
  link text not null check (link ~* '^https?://' and char_length(link) <= 2000),
  comment text check (comment is null or char_length(comment) <= 4000),
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'needs_rework')),
  score int check (score between 0 and 6),
  admin_comment text check (admin_comment is null or char_length(admin_comment) <= 4000),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, lesson_id)
);

-- Ручное открытие уроков владельцем.
create table public.lesson_unlocks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id int not null check (lesson_id between 2 and 8),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- =========================================================================
-- Служебные функции
-- =========================================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Проходной балл: 75 % (6 из 8).
create or replace function public._pass_mark(p_max int)
returns int
language sql immutable set search_path = ''
as $$ select ceil(p_max * 0.75)::int $$;

-- Открыт ли урок участнику: урок 1 всегда; дальше – тест предыдущего сдан или владелец открыл вручную.
create or replace function public._lesson_open(p_user uuid, p_lesson int)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_lesson between 1 and 8 and (
    p_lesson = 1
    or exists (select 1 from public.lesson_unlocks u where u.user_id = p_user and u.lesson_id = p_lesson)
    or exists (select 1 from public.quiz_attempts a where a.user_id = p_user and a.lesson_id = p_lesson - 1 and a.passed)
  );
$$;

-- То же для текущего пользователя (используется в политиках и клиентом).
create or replace function public.is_lesson_open(p_lesson int)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public._lesson_open((select auth.uid()), p_lesson) $$;

-- Профиль создаётся при первом входе (приглашение создаёт запись в auth.users).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- Защита полей задания: участник меняет только ссылку и комментарий,
-- владелец – только поля проверки. Ключ service role и SQL Editor – без ограничений.
-- =========================================================================

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

create trigger homework_guard
  before insert or update on public.homework
  for each row execute function public.homework_guard();

-- =========================================================================
-- Проверка теста – только на сервере
-- p_answers: массив номеров выбранных вариантов (с 1) по порядку вопросов, например [2,1,4,3,1,2,3,4].
-- =========================================================================

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

-- =========================================================================
-- Прогресс: участник × урок
-- opened_at – когда урок открылся; lagging – отстаёт (два теста подряд ниже порога
-- или задание не сдано больше 7 дней после открытия урока).
-- =========================================================================

create or replace function public._progress(p_user uuid)
returns table (
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
language sql stable security definer set search_path = ''
as $$
  with l as (
    select generate_series(1, 8) as lid
  ),
  att as (
    select a.lesson_id as lid,
           max(a.score) as best,
           max(a.max_score) as mx,
           count(*)::int as n,
           bool_or(a.passed) as ok,
           min(a.created_at) filter (where a.passed) as first_pass,
           max(a.created_at) as last_at
    from public.quiz_attempts a
    where a.user_id = p_user
    group by a.lesson_id
  ),
  last2 as (
    select s.lid, count(*) = 2 and bool_and(not s.ok) as both_failed
    from (
      select a.lesson_id as lid, a.passed as ok,
             row_number() over (partition by a.lesson_id order by a.created_at desc) as rn
      from public.quiz_attempts a
      where a.user_id = p_user
    ) s
    where s.rn <= 2
    group by s.lid
  ),
  base as (
    select l.lid,
           case when l.lid = 1 then p.created_at
                else least(u.unlocked_at, prev.first_pass) end as opened,
           att.best, att.mx,
           coalesce(att.n, 0) as n,
           coalesce(att.ok, false) as ok,
           coalesce(last2.both_failed, false) and not coalesce(att.ok, false) as two_failed,
           h.status as hw_status, h.score as hw_score, h.submitted_at as hw_at,
           greatest(att.last_at, h.submitted_at) as last_at
    from l
    cross join (select pr.created_at from public.profiles pr where pr.id = p_user) p
    left join att on att.lid = l.lid
    left join att prev on prev.lid = l.lid - 1
    left join last2 on last2.lid = l.lid
    left join public.lesson_unlocks u on u.user_id = p_user and u.lesson_id = l.lid
    left join public.homework h on h.user_id = p_user and h.lesson_id = l.lid
  )
  select b.lid, b.opened is not null, b.opened, b.best, b.mx, b.n, b.ok, b.two_failed,
         b.hw_status, b.hw_score, b.hw_at, b.last_at,
         b.two_failed or (b.opened is not null and b.hw_status is null and b.opened < now() - interval '7 days')
  from base b
  order by b.lid;
$$;

-- Свой прогресс (для главной страницы участника). Тип нужен, чтобы PostgREST знал колонки.
create type public.progress_row as (
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
);

create or replace function public.my_progress()
returns setof public.progress_row
language sql stable security definer set search_path = ''
as $$ select * from public._progress((select auth.uid())) $$;

-- Сводка для панели владельца: все участники × 8 уроков.
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

-- =========================================================================
-- Права на таблицы: anon не видит ничего; authenticated – только нужное, дальше режет RLS.
-- =========================================================================

revoke all on public.profiles, public.quiz_keys, public.quiz_attempts, public.homework, public.lesson_unlocks
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.quiz_keys to authenticated;
grant select on public.quiz_attempts to authenticated;
grant select, insert, update on public.homework to authenticated;
grant select, insert, delete on public.lesson_unlocks to authenticated;

-- Права на функции: по умолчанию их может вызвать кто угодно, поэтому закрываем и открываем выборочно.
revoke execute on function
  public.is_admin(),
  public._pass_mark(int),
  public._lesson_open(uuid, int),
  public.is_lesson_open(int),
  public.handle_new_user(),
  public.homework_guard(),
  public.submit_quiz(int, jsonb),
  public._progress(uuid),
  public.my_progress(),
  public.admin_progress()
from public, anon, authenticated;

grant execute on function
  public.is_admin(),
  public.is_lesson_open(int),
  public.submit_quiz(int, jsonb),
  public.my_progress(),
  public.admin_progress()
to authenticated;

-- =========================================================================
-- RLS
-- =========================================================================

alter table public.profiles enable row level security;
alter table public.quiz_keys enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.homework enable row level security;
alter table public.lesson_unlocks enable row level security;

-- profiles: свой профиль или владелец; правка – только своего имени (колоночное право выше).
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- quiz_keys: только владелец.
create policy quiz_keys_admin on public.quiz_keys for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- quiz_attempts: читать свои или владелец; вставка только через submit_quiz (политики на insert нет).
create policy attempts_select on public.quiz_attempts for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- homework
create policy homework_select on public.homework for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy homework_insert_own on public.homework for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_lesson_open(lesson_id));
create policy homework_update on public.homework for update to authenticated
  using (public.is_admin() or (user_id = (select auth.uid()) and status = 'needs_rework'))
  with check (public.is_admin() or user_id = (select auth.uid()));

-- lesson_unlocks: читать свои или владелец; писать – владелец.
create policy unlocks_select on public.lesson_unlocks for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy unlocks_insert_admin on public.lesson_unlocks for insert to authenticated
  with check (public.is_admin());
create policy unlocks_delete_admin on public.lesson_unlocks for delete to authenticated
  using (public.is_admin());
