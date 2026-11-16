-- Приглашение по ссылке и письма участникам с результатами (решение владельца 16.11.2026).
--
-- 1. Приглашения. Владелец создаёт в ведомости ссылку с кодом. По ссылке человек вводит почту,
--    получает письмо с подтверждением и попадает в курс. Регистрация без действующего кода
--    отклоняется на сервере (триггер на auth.users) – даже если в панели Supabase включена
--    регистрация и кто-то знает адрес сайта и публичный ключ. Заодно закрыт риск аудита C10.
-- 2. Письма с результатами: первый сданный тест урока и проверка задания владельцем.
--    Отправляются из базы через HTTPS API Brevo (pg_net), ключ – в Supabase Vault.
--    Пока ключа нет, письма просто не отправляются – остальное работает.
--
-- Применять в SQL Editor целиком, после 0001–0004.

create extension if not exists pg_net;

-- =========================================================================
-- Приглашения
-- =========================================================================

create table public.invites (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{12,64}$'),
  note text check (note is null or char_length(note) <= 200),
  max_uses int not null default 1 check (max_uses between 1 and 50),
  uses int not null default 0,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);

alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;
grant select, insert, update on public.invites to authenticated;
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Действует ли код. Вызывает страница приглашения до регистрации (без входа),
-- поэтому отвечает только «да/нет» и ничего больше о приглашении не раскрывает.
create or replace function public.check_invite(p_code text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.invites i
    where i.code = p_code and not i.revoked and i.uses < i.max_uses and i.expires_at > now()
  );
$$;

-- Новый пользователь получает профиль, только если его пустили:
--   * владелец пригласил из панели Supabase (invited_at),
--   * учётку создал владелец или скрипт с ключом service role с подтверждённой почтой (email_confirmed_at сразу),
--   * человек пришёл по действующей ссылке-приглашению (код в метаданных регистрации).
-- Иначе регистрация отклоняется целиком: запись в auth.users не создаётся.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text := new.raw_user_meta_data ->> 'invite';
  v_ok boolean := false;
begin
  if new.invited_at is not null or new.email_confirmed_at is not null then
    v_ok := true;
  elsif v_code is not null then
    update public.invites
       set uses = uses + 1
     where code = v_code and not revoked and uses < max_uses and expires_at > now();
    v_ok := found;
  end if;

  if not v_ok then
    raise exception 'Регистрация только по приглашению' using errcode = '42501';
  end if;

  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

-- =========================================================================
-- Письма
-- =========================================================================

-- Названия уроков для писем (сайт берёт их из content/program.json; здесь – копия для текста письма).
create or replace function public._lesson_title(p_lesson int)
returns text
language sql immutable set search_path = ''
as $$
  select (array['Знакомство', 'Как ставить задачу', 'Файлы', 'Поиск и исследования', 'Готовые результаты',
                'Проекты и память', 'Подключения и агентная работа', 'Скилы и итоговый проект'])[p_lesson]
$$;

create or replace function public._html(p text)
returns text
language sql immutable set search_path = ''
as $$ select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

-- Отправка письма через Brevo. Секреты в Vault: brevo_api_key, mail_from (адрес отправителя,
-- подтверждённый в Brevo), необязательно mail_from_name и site_url. Нет ключа – письмо пропускается.
-- pg_net ставит запрос в очередь: транзакция участника не ждёт и не падает из-за почты.
create or replace function public._send_mail(p_user uuid, p_subject text, p_html text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text;
  v_from text;
  v_name text;
  v_to text;
  v_full text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'brevo_api_key';
  select decrypted_secret into v_from from vault.decrypted_secrets where name = 'mail_from';
  select decrypted_secret into v_name from vault.decrypted_secrets where name = 'mail_from_name';
  if v_key is null or v_from is null then
    return;
  end if;
  select u.email, p.full_name into v_to, v_full
  from auth.users u join public.profiles p on p.id = u.id
  where u.id = p_user;
  if v_to is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', v_key, 'content-type', 'application/json', 'accept', 'application/json'),
    body := jsonb_build_object(
      'sender', jsonb_build_object('email', v_from, 'name', coalesce(v_name, 'Учимся работать с Claude')),
      'to', jsonb_build_array(jsonb_build_object('email', v_to, 'name', coalesce(v_full, v_to))),
      'subject', p_subject,
      'htmlContent', p_html
    )
  );
exception when others then
  -- Почта не должна ломать сдачу теста или проверку задания.
  raise warning 'mail not sent: %', sqlerrm;
end;
$$;

create or replace function public._mail_wrap(p_body text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_site text;
begin
  select decrypted_secret into v_site from vault.decrypted_secrets where name = 'site_url';
  v_site := coalesce(v_site, 'https://cryptodrakaris.github.io/claude-school/');
  return '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1f2128;max-width:520px">'
      || p_body
      || '<p><a href="' || v_site || '" style="color:#2b3f9e">Открыть зачётку</a></p>'
      || '<p style="color:#5b5d65;font-size:14px">Курс «Учимся работать с Claude»</p></div>';
end;
$$;

-- Первый сданный тест урока.
create or replace function public._notify_quiz()
returns trigger
language plpgsql security definer set search_path = ''
as $$
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
  perform public._send_mail(
    new.user_id,
    'Тест урока ' || new.lesson_id || ' сдан: ' || new.score || ' из ' || new.max_score,
    public._mail_wrap(
      '<p>Тест урока ' || new.lesson_id || ', «' || public._lesson_title(new.lesson_id) || '», сдан: '
      || new.score || ' из ' || new.max_score || '.</p>'
      || case when new.lesson_id < 8
           then '<p>Открыт урок ' || (new.lesson_id + 1) || ', «' || public._lesson_title(new.lesson_id + 1)
                || '». Не забудьте сдать задание урока ' || new.lesson_id || '.</p>'
           else '<p>Это был последний тест курса. Осталось итоговое задание.</p>' end
    )
  );
  return new;
end;
$$;

create trigger notify_quiz
  after insert on public.quiz_attempts
  for each row execute function public._notify_quiz();

-- Проверка задания владельцем: «принято» или «на доработку».
create or replace function public._notify_homework()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = old.status or new.status not in ('accepted', 'needs_rework') then
    return new;
  end if;
  perform public._send_mail(
    new.user_id,
    case when new.status = 'accepted'
      then 'Задание урока ' || new.lesson_id || ' принято'
      else 'Задание урока ' || new.lesson_id || ' – нужна доработка' end,
    public._mail_wrap(
      '<p>Задание урока ' || new.lesson_id || ', «' || public._lesson_title(new.lesson_id) || '», '
      || case when new.status = 'accepted' then 'принято' else 'вернули на доработку' end
      || coalesce(', оценка ' || new.score || ' из 6', '') || '.</p>'
      || coalesce('<p>Комментарий:</p><blockquote style="margin:0;padding:8px 12px;border-left:3px solid #2b3f9e;white-space:pre-wrap">'
                  || public._html(new.admin_comment) || '</blockquote>', '')
      || case when new.status = 'needs_rework'
           then '<p>Исправьте работу по комментарию и сдайте новую ссылку в уроке.</p>' else '' end
    )
  );
  return new;
end;
$$;

create trigger notify_homework
  after update on public.homework
  for each row execute function public._notify_homework();

-- =========================================================================
-- Права на функции
-- =========================================================================

revoke execute on function
  public.check_invite(text),
  public.handle_new_user(),
  public._lesson_title(int),
  public._html(text),
  public._send_mail(uuid, text, text),
  public._mail_wrap(text),
  public._notify_quiz(),
  public._notify_homework()
from public, anon, authenticated;

grant execute on function public.check_invite(text) to anon, authenticated;
