-- Курс из четырёх блоков (решение владельца 18.11.2026): уроки 1–8 «Чат», 9–13 «Расширения»,
-- 14–21 «Cowork», 22–26 «Claude Code».
-- Первый урок нового блока (9, 14, 22) открывается, когда сдан тест последнего урока прошлого блока
-- И владелец принял его итоговое задание (или владелец открыл урок вручную). Внутри блока – как раньше:
-- урок N+1 после теста N.
-- Применять в SQL Editor целиком, после 0001–0005.

-- Номер последнего урока и первые уроки блоков – в одном месте.
create or replace function public._last_lesson()
returns int
language sql immutable set search_path = ''
as $$ select 26 $$;

create or replace function public._block_starts()
returns int[]
language sql immutable set search_path = ''
as $$ select array[9, 14, 22] $$;

-- Ограничения номера урока: было 1–8.
alter table public.quiz_keys drop constraint if exists quiz_keys_lesson_id_check;
alter table public.quiz_attempts drop constraint if exists quiz_attempts_lesson_id_check;
alter table public.homework drop constraint if exists homework_lesson_id_check;
alter table public.lesson_unlocks drop constraint if exists lesson_unlocks_lesson_id_check;
alter table public.quiz_keys add constraint quiz_keys_lesson_id_check check (lesson_id between 1 and 26);
alter table public.quiz_attempts add constraint quiz_attempts_lesson_id_check check (lesson_id between 1 and 26);
alter table public.homework add constraint homework_lesson_id_check check (lesson_id between 1 and 26);
alter table public.lesson_unlocks add constraint lesson_unlocks_lesson_id_check check (lesson_id between 2 and 26);

-- Открыт ли урок участнику.
create or replace function public._lesson_open(p_user uuid, p_lesson int)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_lesson between 1 and public._last_lesson() and (
    p_lesson = 1
    or exists (select 1 from public.lesson_unlocks u where u.user_id = p_user and u.lesson_id = p_lesson)
    or (
      exists (select 1 from public.quiz_attempts a
              where a.user_id = p_user and a.lesson_id = p_lesson - 1 and a.passed)
      and (
        not (p_lesson = any (public._block_starts()))
        or exists (select 1 from public.homework h
                   where h.user_id = p_user and h.lesson_id = p_lesson - 1 and h.status = 'accepted')
      )
    )
  );
$$;

-- Прогресс: 26 уроков; дата открытия первого урока блока – когда выполнены оба условия.
create or replace function public._progress(p_user uuid, p_ready int[] default null)
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
    select generate_series(1, public._last_lesson()) as lid
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
  -- когда урок открылся сам: внутри блока – первый сданный тест прошлого урока;
  -- первый урок блока – позже из двух событий: тест сдан и итоговое задание принято
  auto as (
    select l.lid,
           case when l.lid = any (public._block_starts())
                then case when prev_hw.status = 'accepted'
                          then greatest(prev.first_pass, prev_hw.reviewed_at) end
                else prev.first_pass end as at
    from l
    left join att prev on prev.lid = l.lid - 1
    left join public.homework prev_hw on prev_hw.user_id = p_user and prev_hw.lesson_id = l.lid - 1
  ),
  base as (
    select l.lid,
           case when l.lid = 1 then p.created_at
                else least(u.unlocked_at, auto.at) end as opened,
           case when l.lid = 1 then au.email_confirmed_at
                else least(u.unlocked_at, auto.at) end as lag_from,
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
    left join auto on auto.lid = l.lid
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

-- Названия уроков для писем.
create or replace function public._lesson_title(p_lesson int)
returns text
language sql immutable set search_path = ''
as $$
  select (array['Знакомство', 'Как ставить задачу', 'Файлы', 'Поиск и исследования', 'Готовые результаты',
                'Проекты и память', 'Подключения и агентная работа', 'Скилы и итоговый проект',
                'Подключения подробно', 'Готовые скилы', 'Свой скил всерьёз', 'Плагины',
                'Безопасность расширений и свой набор',
                'Что такое Cowork', 'Как поручить задачу', 'Папки на компьютере',
                'Из пачки документов – результат', 'Браузер в задаче', 'Задачи по расписанию и с телефона',
                'Режимы разрешений и лимиты', 'Итоговый проект блока «Cowork»',
                'Что такое Claude Code', 'Как работать с Claude Code', 'Своя страница в интернете',
                'Инструмент под себя', 'Итоговый проект курса'])[p_lesson]
$$;

-- Письмо о первом сданном тесте: учитывает границу блока.
create or replace function public._notify_quiz()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_next int := new.lesson_id + 1;
  v_tail text;
begin
  if not new.passed then
    return new;
  end if;
  if exists (
    select 1 from public.quiz_attempts a
    where a.user_id = new.user_id and a.lesson_id = new.lesson_id and a.passed and a.id <> new.id
  ) then
    return new; -- уже сдавал: повторные пересдачи писем не шлют
  end if;
  if new.lesson_id >= public._last_lesson() then
    v_tail := '<p>Это был последний тест курса. Осталось итоговое задание.</p>';
  elsif v_next = any (public._block_starts()) then
    v_tail := '<p>Это последний тест блока. Следующий блок откроется, когда владелец курса примет '
           || 'итоговое задание урока ' || new.lesson_id || '.</p>';
  else
    v_tail := '<p>Открыт урок ' || v_next || ', «' || public._lesson_title(v_next)
           || '». Не забудьте сдать задание урока ' || new.lesson_id || '.</p>';
  end if;
  perform public._send_mail(
    new.user_id,
    'Тест урока ' || new.lesson_id || ' сдан: ' || new.score || ' из ' || new.max_score,
    public._mail_wrap(
      '<p>Тест урока ' || new.lesson_id || ', «' || public._lesson_title(new.lesson_id) || '», сдан: '
      || new.score || ' из ' || new.max_score || '.</p>' || v_tail
    )
  );
  return new;
end;
$$;

-- Письмо о проверке задания: если принято итоговое задание блока и тест сдан – сообщает об открытии блока.
create or replace function public._notify_homework()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_next int := new.lesson_id + 1;
  v_opens boolean;
begin
  if new.status = old.status or new.status not in ('accepted', 'needs_rework') then
    return new;
  end if;
  v_opens := new.status = 'accepted'
    and v_next = any (public._block_starts())
    and exists (select 1 from public.quiz_attempts a
                where a.user_id = new.user_id and a.lesson_id = new.lesson_id and a.passed);
  perform public._send_mail(
    new.user_id,
    case when v_opens then 'Задание урока ' || new.lesson_id || ' принято – открыт новый блок'
         when new.status = 'accepted' then 'Задание урока ' || new.lesson_id || ' принято'
         else 'Задание урока ' || new.lesson_id || ' – нужна доработка' end,
    public._mail_wrap(
      '<p>Задание урока ' || new.lesson_id || ', «' || public._lesson_title(new.lesson_id) || '», '
      || case when new.status = 'accepted' then 'принято' else 'вернули на доработку' end
      || coalesce(', оценка ' || new.score || ' из 6', '') || '.</p>'
      || coalesce('<p>Комментарий:</p><blockquote style="margin:0;padding:8px 12px;border-left:3px solid #2b3f9e;white-space:pre-wrap">'
                  || public._html(new.admin_comment) || '</blockquote>', '')
      || case when new.status = 'needs_rework'
           then '<p>Исправьте работу по комментарию и сдайте новую ссылку в уроке.</p>' else '' end
      || case when v_opens
           then '<p>Открыт урок ' || v_next || ', «' || public._lesson_title(v_next) || '» – начало нового блока.</p>'
           else '' end
    )
  );
  return new;
end;
$$;

revoke execute on function public._last_lesson(), public._block_starts(),
  public._lesson_open(uuid, int), public._progress(uuid, int[]), public._lesson_title(int),
  public._notify_quiz(), public._notify_homework()
from public, anon, authenticated;
