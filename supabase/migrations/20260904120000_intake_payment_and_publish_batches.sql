-- ============================================================
-- To'lov tasdiqlash + batch chop etish
--
-- 1. candidate_intakes ga to'lov holati ustunlari
-- 2. intake_payment_requests — botga yuborilgan har bir savol
-- 3. intake_publish_batches / _items — boshqariladigan batch navbati
-- 4. claim_next_publish_batch_item — atomik claim (SKIP LOCKED)
-- 5. site_settings — post yetkazish chat ro'yxati
--
-- Migration NON-DESTRUCTIVE: bironta jadval/ustun o'chirilmaydi,
-- mavjud status semantikasi o'zgarmaydi. To'lov holati intake
-- statusidan ALOHIDA ustun — publish oqimi shu bilan gate qilinadi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. To'lov holati
--
-- 'unknown' — hali javob berilmagan (to'lov qilmagan DEB HISOBLANMAYDI)
-- 'paid'    — botdan "Ha" bosilgan
-- 'unpaid'  — botdan "Yo'q" bosilgan (qayta so'raladi)
-- ------------------------------------------------------------
alter table public.candidate_intakes
  add column if not exists payment_status text not null default 'unknown',
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by_chat_id bigint,
  add column if not exists payment_last_asked_at timestamptz,
  add column if not exists payment_ask_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'candidate_intakes_payment_status_check'
  ) then
    alter table public.candidate_intakes
      add constraint candidate_intakes_payment_status_check
      check (payment_status in ('unknown', 'paid', 'unpaid'));
  end if;
end $$;

-- Sweep so'rovi: to'lanmagan, yuborilgan anketalarni eng eski so'ralganidan
-- boshlab oladi.
create index if not exists idx_intakes_payment_pending
  on public.candidate_intakes(payment_last_asked_at nulls first)
  where payment_status <> 'paid' and deleted_at is null;

create index if not exists idx_intakes_submitted_at
  on public.candidate_intakes(submitted_at desc)
  where deleted_at is null;

-- ------------------------------------------------------------
-- 2. intake_payment_requests — har chatga yuborilgan savol
--
-- Bir nomzod uchun bir necha "round" bo'ladi: "Yo'q" javobidan keyin
-- keyingi sweep yangi round yuboradi. Javob berilgan xabar tahrirlanadi,
-- shuning uchun message_id saqlanadi.
-- ------------------------------------------------------------
create table if not exists public.intake_payment_requests (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  chat_id bigint not null,
  telegram_message_id bigint,
  round integer not null default 1,
  status text not null default 'sent'
    check (status in ('sent', 'answered_yes', 'answered_no', 'failed')),
  answered_at timestamptz,
  answered_by_user_id bigint,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_requests_intake
  on public.intake_payment_requests(intake_id, created_at desc);
create index if not exists idx_payment_requests_open
  on public.intake_payment_requests(status) where status = 'sent';

-- ------------------------------------------------------------
-- 3. Batch chop etish navbati
-- ------------------------------------------------------------
create table if not exists public.intake_publish_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'completed',
                      'completed_with_errors', 'failed', 'cancelled')),
  selection_mode text not null default 'all'
    check (selection_mode in ('all', 'selected')),
  total integer not null default 0,
  completed integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  current_item_id uuid,
  error_summary text,
  -- ETA uchun: tugagan itemlarning umumiy davomiyligi
  duration_ms_total bigint not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_publish_batches_active
  on public.intake_publish_batches(created_at desc)
  where status in ('queued', 'running', 'paused');

create table if not exists public.intake_publish_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.intake_publish_batches(id) on delete cascade,
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  position integer not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed',
                      'needs_review', 'skipped', 'cancelled')),
  current_stage text,
  candidate_id uuid,
  post_id uuid,
  telegram_sent integer not null default 0,
  telegram_failed integer not null default 0,
  attempts integer not null default 0,
  duration_ms integer,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bitta nomzod bitta batchda bir marta.
create unique index if not exists uq_batch_item_intake
  on public.intake_publish_batch_items(batch_id, intake_id);
create index if not exists idx_batch_items_queue
  on public.intake_publish_batch_items(batch_id, position)
  where status = 'queued';

drop trigger if exists trg_publish_batches_updated on public.intake_publish_batches;
create trigger trg_publish_batches_updated
  before update on public.intake_publish_batches
  for each row execute function public.set_updated_at();

drop trigger if exists trg_publish_batch_items_updated on public.intake_publish_batch_items;
create trigger trg_publish_batch_items_updated
  before update on public.intake_publish_batch_items
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 4. Atomik claim
--
-- Ikki cron invocation bir vaqtda bitta itemni olib qo'ymasligi uchun.
-- FOR UPDATE SKIP LOCKED — navbatdagi birinchi bo'sh itemni qulflab oladi,
-- boshqa worker esa uni umuman ko'rmaydi.
-- ------------------------------------------------------------
create or replace function public.claim_next_publish_batch_item(p_batch uuid)
returns public.intake_publish_batch_items
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.intake_publish_batch_items;
begin
  select * into claimed
  from public.intake_publish_batch_items
  where batch_id = p_batch and status = 'queued'
  order by position
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  update public.intake_publish_batch_items
  set status = 'running',
      attempts = attempts + 1,
      started_at = coalesce(started_at, now()),
      current_stage = 'queued'
  where id = claimed.id
  returning * into claimed;

  update public.intake_publish_batches
  set current_item_id = claimed.id,
      status = case when status = 'queued' then 'running' else status end,
      started_at = coalesce(started_at, now())
  where id = p_batch;

  return claimed;
end;
$$;

revoke all on function public.claim_next_publish_batch_item(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. RLS — bu jadvallar faqat server (service role) uchun
-- ------------------------------------------------------------
alter table public.intake_payment_requests enable row level security;
alter table public.intake_publish_batches enable row level security;
alter table public.intake_publish_batch_items enable row level security;

-- Policy yozilmaydi: service role RLS'ni chetlab o'tadi, boshqa hech kim
-- (anon/authenticated) bu jadvallarni umuman ko'rmaydi.

-- ------------------------------------------------------------
-- 6. Post yetkazish manzillari
--
-- Batch/pipeline postlari faqat shu chatlarga ketadi. Bo'sh qiymat =
-- barcha aktiv obunachilar (eski xatti-harakat).
-- ------------------------------------------------------------
insert into public.site_settings (key, value)
values ('telegram_bot.post_delivery_chat_ids', '["5072996465","6398047875","8254451152"]')
on conflict (key) do nothing;
