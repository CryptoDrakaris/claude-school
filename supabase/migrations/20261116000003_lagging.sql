-- Аудит C1 и N4: признак «отстаёт» в ведомости.
-- C1: «задание не сдано больше 7 дней» считалось и по урокам, которые ещё не готовы (заглушки без задания).
--     Теперь admin_progress принимает список готовых уроков (p_ready), клиент берёт его из content/program.json.
-- N4: урок 1 считался открытым с момента приглашения (профиль создаётся триггером на auth.users).
--     Для отсчёта 7 дней по уроку 1 берётся первый вход – email_confirmed_at (ставится, когда человек
--     впервые открыл ссылку из письма). Кто ни разу не входил – не «отстаёт» по заданию.
-- Применять в SQL Editor целиком, после 0001 и 0002.

drop function public.admin_progress();
drop function public.my_progress();
drop function public._progress(uuid);

create function public._progress(p_user uuid, p_ready int[] default null)
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
           -- от чего считать 7 дней без задания: урок 1 – от первого входа, остальные – от открытия
           case when l.lid = 1 then au.email_confirmed_at
                else least(u.unlocked_at, prev.first_pass) end as lag_from,
           att.best, att.mx,
           coalesce(att.n, 0) as n,
           coalesce(att.ok, false) as ok,
           coalesce(last2.both_failed, false) and not coalesce(att.ok, false) as two_failed,
           h.status as hw_status, h.score as hw_score, h.submitted_at as hw_at,
           greatest(att.last_at, h.submitted_at) as last_at
    from l
    cross join (select pr.created_at from public.profiles pr where pr.id = p_user) p
    left join auth.users au on au.id = p_user
    left join att on att.lid = l.lid
    left join att prev on prev.lid = l.lid - 1
    left join last2 on last2.lid = l.lid
    left join public.lesson_unlocks u on u.user_id = p_user and u.lesson_id = l.lid
    left join public.homework h on h.user_id = p_user and h.lesson_id = l.lid
  )
  select b.lid, b.opened is not null, b.opened, b.best, b.mx, b.n, b.ok, b.two_failed,
         b.hw_status, b.hw_score, b.hw_at, b.last_at,
         b.two_failed
           or (b.hw_status is null
               and b.lag_from is not null
               and b.lag_from < now() - interval '7 days'
               and (p_ready is null or b.lid = any (p_ready)))
  from base b
  order by b.lid;
$$;

create function public.my_progress()
returns setof public.progress_row
language sql stable security definer set search_path = ''
as $$ select * from public._progress((select auth.uid())) $$;

-- p_ready – номера готовых уроков (у остальных нет задания, «не сдано» по ним не считается).
create function public.admin_progress(p_ready int[] default null)
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
    cross join lateral public._progress(p.id, p_ready) g
    where p.role = 'student'
    order by p.full_name nulls last, u.email, g.lesson_id;
end;
$$;

revoke execute on function public._progress(uuid, int[]), public.my_progress(), public.admin_progress(int[])
  from public, anon, authenticated;
grant execute on function public.my_progress(), public.admin_progress(int[]) to authenticated;
