-- ============================================================
-- Liderlar.uz 2.0 — 0014: Nomzodning AdabiyotX materiallari
-- Non-destructive va qayta ishga tushirishga mos.
-- ============================================================

-- Admin va user Supabase projectlaridagi bir nomzodni bog'lovchi stabil kalit.
alter table public.candidates
  add column if not exists integration_key uuid;

alter table public.candidates
  alter column integration_key set default gen_random_uuid();

update public.candidates
set integration_key = gen_random_uuid()
where integration_key is null;

alter table public.candidates
  alter column integration_key set not null;

create unique index if not exists uq_candidates_integration_key
  on public.candidates(integration_key);

create table if not exists public.candidate_adabiyotx_items (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  external_id text not null,
  relationship_type text not null
    check (relationship_type in ('own_work', 'read_book')),
  content_type text not null
    check (content_type in ('book', 'article', 'poem', 'scenario', 'other')),
  title text not null,
  author_name text,
  description text,
  cover_url text,
  external_url text not null,
  published_at timestamptz,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_candidate_adabiyotx_relationship
    unique (candidate_id, external_id, relationship_type),
  constraint chk_candidate_adabiyotx_read_book
    check (relationship_type <> 'read_book' or content_type = 'book')
);

create index if not exists idx_candidate_adabiyotx_listing
  on public.candidate_adabiyotx_items (
    candidate_id,
    relationship_type,
    is_visible,
    sort_order
  );

drop trigger if exists trg_candidate_adabiyotx_items_updated
  on public.candidate_adabiyotx_items;
create trigger trg_candidate_adabiyotx_items_updated
  before update on public.candidate_adabiyotx_items
  for each row execute function public.set_updated_at();

alter table public.candidate_adabiyotx_items enable row level security;

-- Ochiq sayt faqat ko'rinadigan va nashr qilingan nomzodga tegishli yozuvni o'qiydi.
drop policy if exists "visible candidate adabiyotx items are public"
  on public.candidate_adabiyotx_items;
create policy "visible candidate adabiyotx items are public"
  on public.candidate_adabiyotx_items for select
  to anon, authenticated
  using (
    is_visible = true
    and exists (
      select 1
      from public.candidates c
      where c.id = candidate_adabiyotx_items.candidate_id
        and c.status = 'published'
        and c.deleted_at is null
    )
  );

drop policy if exists "admins read all candidate adabiyotx items"
  on public.candidate_adabiyotx_items;
create policy "admins read all candidate adabiyotx items"
  on public.candidate_adabiyotx_items for select
  to authenticated
  using (public.is_admin());

drop policy if exists "candidate editors insert adabiyotx items"
  on public.candidate_adabiyotx_items;
create policy "candidate editors insert adabiyotx items"
  on public.candidate_adabiyotx_items for insert
  to authenticated
  with check (public.has_permission('candidates.edit'));

drop policy if exists "candidate editors update adabiyotx items"
  on public.candidate_adabiyotx_items;
create policy "candidate editors update adabiyotx items"
  on public.candidate_adabiyotx_items for update
  to authenticated
  using (public.has_permission('candidates.edit'))
  with check (public.has_permission('candidates.edit'));

drop policy if exists "candidate editors delete adabiyotx items"
  on public.candidate_adabiyotx_items;
create policy "candidate editors delete adabiyotx items"
  on public.candidate_adabiyotx_items for delete
  to authenticated
  using (public.has_permission('candidates.edit'));

-- Reorder bir transaction ichida bajarilishi uchun server-only RPC.
create or replace function public.reorder_candidate_adabiyotx_items(
  p_candidate_id uuid,
  p_items jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_requested integer;
  v_updated integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items JSON array bo''lishi kerak';
  end if;

  select count(*) into v_requested
  from jsonb_to_recordset(p_items) as x(id uuid, sort_order integer);

  if v_requested <> (
    select count(distinct x.id)
    from jsonb_to_recordset(p_items) as x(id uuid, sort_order integer)
  ) then
    raise exception 'Takrorlangan material ID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(id uuid, sort_order integer)
    where x.id is null or x.sort_order is null or x.sort_order < 0
  ) then
    raise exception 'Noto''g''ri tartib qiymati';
  end if;

  update public.candidate_adabiyotx_items item
  set sort_order = incoming.sort_order
  from jsonb_to_recordset(p_items) as incoming(id uuid, sort_order integer)
  where item.id = incoming.id
    and item.candidate_id = p_candidate_id;

  get diagnostics v_updated = row_count;
  if v_updated <> v_requested then
    raise exception 'Materiallardan biri nomzodga tegishli emas yoki topilmadi';
  end if;
end;
$$;

revoke all on function public.reorder_candidate_adabiyotx_items(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.reorder_candidate_adabiyotx_items(uuid, jsonb)
  to service_role;
