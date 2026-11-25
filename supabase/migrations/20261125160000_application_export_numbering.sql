-- TXT raqamlashining joriy holati. Yangi kunning birinchi eksporti shu qatorni yangilaydi.
create table if not exists public.application_export_daily_counts (
  singleton boolean primary key default true check (singleton),
  export_date date,
  username_count integer not null default 0 check (username_count >= 0),
  phone_count integer not null default 0 check (phone_count >= 0),
  last_export_id uuid
);

insert into public.application_export_daily_counts (singleton) values (true)
on conflict (singleton) do nothing;

alter table public.application_export_daily_counts enable row level security;
revoke all on table public.application_export_daily_counts from public, anon, authenticated;
grant select, update on table public.application_export_daily_counts to service_role;

-- Arizalarning vaqti bo‘yicha oxirgi «Ko‘rilmoqda» yozuv va bugungi hisoblagichlar.
create or replace function public.get_application_export_context(p_until timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'boundary', (
      select jsonb_build_object('id', a.id, 'created_at', a.created_at)
      from public.applications a
      where a.status = 'in_review' and a.created_at <= p_until
      order by a.created_at desc, a.id desc
      limit 1
    ),
    'last_export_id', c.last_export_id,
    'username_count', case when c.export_date = (p_until at time zone 'Asia/Tashkent')::date then c.username_count else 0 end,
    'phone_count', case when c.export_date = (p_until at time zone 'Asia/Tashkent')::date then c.phone_count else 0 end
  )
  from public.application_export_daily_counts c
  where c.singleton;
$$;

-- Parallel eksportlarni bitta qator qulfi bilan navbatlaydi va ikki yozuvni bir tranzaksiyada saqlaydi.
create or replace function public.complete_application_export(
  p_export_id uuid,
  p_previous_export_id uuid,
  p_export_date date,
  p_boundary_id uuid,
  p_latest_id uuid,
  p_latest_updated_at timestamptz,
  p_username_count integer,
  p_phone_count integer,
  p_actor_id uuid
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_counts public.application_export_daily_counts%rowtype;
  v_boundary_id uuid;
begin
  select * into strict v_counts
  from public.application_export_daily_counts
  where singleton
  for update;

  if v_counts.last_export_id = p_export_id then
    return 'already_saved';
  end if;
  if v_counts.last_export_id is distinct from p_previous_export_id
     or p_export_date is distinct from (statement_timestamp() at time zone 'Asia/Tashkent')::date then
    return 'superseded';
  end if;

  select a.id into v_boundary_id
  from public.applications a
  where a.status = 'in_review' and a.created_at <= statement_timestamp()
  order by a.created_at desc, a.id desc
  limit 1;

  if v_boundary_id is distinct from p_boundary_id then
    return 'superseded';
  end if;

  update public.applications
  set status = 'in_review', assignee_id = p_actor_id
  where id = p_latest_id and status = 'new' and updated_at = p_latest_updated_at;

  if not found then
    return 'superseded';
  end if;

  update public.application_export_daily_counts
  set export_date = p_export_date,
      username_count = p_username_count,
      phone_count = p_phone_count,
      last_export_id = p_export_id
  where singleton;

  return 'saved';
end;
$$;

revoke all on function public.get_application_export_context(timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_application_export_context(timestamptz)
  to service_role;

revoke all on function public.complete_application_export(uuid, uuid, date, uuid, uuid, timestamptz, integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_application_export(uuid, uuid, date, uuid, uuid, timestamptz, integer, integer, uuid)
  to service_role;
