-- ============================================================
-- KOORDINATORLAR CRM — hududiy sotuv tizimi
--
-- UCH TUSHUNCHA HECH QACHON BIR MAYDONGA BIRLASHTIRILMAYDI:
--
--   1. LID QAYERDAN KELGAN  -> leads.lead_region_id (O'ZGARMAYDI)
--   2. KIM ISHLAYAPTI        -> leads.assigned_coordinator_id
--   3. KIM SOTDI             -> commissions.coordinator_id
--
-- Nega: Samarqanddan kelgan lidni 10 daqiqadan keyin Buxoro
-- koordinatori olishi mumkin. U holda SAMARQAND bozori +1 konversiya,
-- BUXORO koordinatori +1 shaxsiy sotuv oladi. Bitta maydon bo'lsa,
-- overflow butun hududiy statistikani buzib yuborardi.
--
-- QOIDA: non-destructive, forward-only. Mavjud jadvallarga tegilmaydi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. KOORDINATORLAR
-- ------------------------------------------------------------
create table if not exists public.coordinators (
  id uuid primary key default gen_random_uuid(),

  -- Admin panelga kirsa — profil bog'lanishi. Majburiy emas:
  -- koordinator faqat bot orqali ishlashi mumkin.
  profile_id uuid references public.profiles(id) on delete set null,

  full_name text not null check (char_length(full_name) between 3 and 160),
  photo_url text,
  bio text,

  -- ICHKI telefon — ommaviy saytda KO'RSATILMAYDI.
  phone text,
  -- Ommaviy karta uchun alohida maydon va alohida bayroq. Ichki
  -- raqamni "ommaviy" deb taxmin qilish — shaxsiy ma'lumotni
  -- tarqatish demak.
  public_phone text,
  show_phone_publicly boolean not null default false,
  public_email text,

  /*
   * TELEGRAM SHAXSI — RAQAMLI ID BO'YICHA.
   *
   * Username o'zgaradi va uni boshqa odam egallashi mumkin; raqamli
   * id esa o'zgarmaydi. Bot koordinatorni AYNAN shu bo'yicha taniydi.
   * OMMAVIY YO'LLARDA HECH QACHON KO'RSATILMAYDI.
   */
  telegram_user_id bigint,
  telegram_username text,

  region_id uuid references public.regions(id) on delete set null,

  status text not null default 'active'
    check (status in ('active', 'paused', 'offline', 'suspended')),
  is_active boolean not null default true,

  -- Overflow tanlovida teng holatlarni hal qiladi (kichikroq — oldin).
  backup_priority integer not null default 100,
  -- Kunlik lid chegarasi. NULL — cheklov yo'q.
  daily_lead_limit integer check (daily_lead_limit is null or daily_lead_limit > 0),

  notes text,
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
 * BITTA TELEGRAM ID — BITTA FAOL KOORDINATOR.
 *
 * Qisman indeks: o'chirilgan (faolsiz) koordinatorning id'si qayta
 * ishlatilishi mumkin, faol ikkitasi esa bo'lmaydi. Aks holda bot
 * bir odamni ikki koordinator deb bilib, lidni ikki marta taklif
 * qilardi.
 */
create unique index if not exists uq_coordinator_telegram_active
  on public.coordinators(telegram_user_id)
  where telegram_user_id is not null and is_active;

create index if not exists idx_coordinators_region
  on public.coordinators(region_id) where is_active;

drop trigger if exists trg_coordinators_updated on public.coordinators;
create trigger trg_coordinators_updated
  before update on public.coordinators
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. LIDLAR
-- ------------------------------------------------------------
create table if not exists public.coordinator_leads (
  id uuid primary key default gen_random_uuid(),

  -- Manba: ariza yoki anketa. Ikkalasi ham bo'lishi mumkin.
  application_id uuid references public.applications(id) on delete set null,
  intake_id uuid references public.candidate_intakes(id) on delete set null,
  sales_conversation_id uuid references public.sales_conversations(id) on delete set null,

  full_name text not null,
  -- Kontakt MA'LUMOTI lid yozuvida saqlanmaydi: u manba jadvalida
  -- turadi va u yerda RLS bilan himoyalangan. Bu yerda faqat
  -- bog'lanish.

  /*
   * LID QAYERDAN KELGAN — HECH QACHON O'ZGARMAYDI.
   *
   * Overflow boshqa hudud koordinatoriga bersa ham bu maydon
   * o'sha-o'sha qoladi. Hududiy bozor statistikasi shunga tayanadi.
   */
  lead_region_id uuid references public.regions(id) on delete set null,

  -- KIM ISHLAYAPTI. Bo'sh — hali hech kim band qilmagan.
  assigned_coordinator_id uuid references public.coordinators(id) on delete set null,
  -- Band qilgan koordinatorning hududi. `lead_region_id` dan FARQ
  -- QILISHI MUMKIN va aynan shu farq overflow'ni ko'rsatadi.
  assigned_coordinator_region_id uuid references public.regions(id) on delete set null,

  state text not null default 'new'
    check (state in (
      'new', 'offered', 'claimed', 'contacted', 'qualified',
      'article_confirmed', 'intake_pending', 'intake_submitted',
      'payment_requested', 'payment_claimed', 'payment_evidence',
      'payment_confirmed', 'won', 'lost', 'cancelled'
    )),

  -- Taklif oynasi.
  offered_at timestamptz,
  claim_deadline timestamptz,
  claimed_at timestamptz,
  -- Nechinchi marta taklif qilingan (overflow hisobi).
  offer_round integer not null default 0,

  first_contact_at timestamptz,
  payment_confirmed_at timestamptz,
  closed_at timestamptz,
  lost_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_region_state
  on public.coordinator_leads(lead_region_id, state);
create index if not exists idx_leads_assigned
  on public.coordinator_leads(assigned_coordinator_id, state);
-- Muddati o'tgan takliflarni topish uchun.
create index if not exists idx_leads_claim_deadline
  on public.coordinator_leads(claim_deadline)
  where state = 'offered';
create index if not exists idx_leads_created
  on public.coordinator_leads(created_at desc);

-- Bitta ariza — bitta lid. Takroriy yaratishni to'xtatadi.
create unique index if not exists uq_lead_application
  on public.coordinator_leads(application_id) where application_id is not null;
create unique index if not exists uq_lead_intake
  on public.coordinator_leads(intake_id) where intake_id is not null;

drop trigger if exists trg_leads_updated on public.coordinator_leads;
create trigger trg_leads_updated
  before update on public.coordinator_leads
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. MARSHRUTLASH TARIXI — O'ZGARMAS
--
--    Har taklif, muddat tugashi, band qilish va qo'lda o'tkazish
--    alohida qator. Ustidan yozilmaydi: "bu lid nega bu odamda?"
--    degan savolga javob faqat shu yerdan chiqadi.
-- ------------------------------------------------------------
create table if not exists public.lead_routing_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.coordinator_leads(id) on delete cascade,

  event text not null check (event in (
    'created', 'region_resolved', 'offered', 'claimed', 'expired',
    'overflow', 'reassigned', 'state_changed', 'payment_confirmed',
    'lost', 'no_coordinator'
  )),

  coordinator_id uuid references public.coordinators(id) on delete set null,
  from_state text,
  to_state text,
  -- Qo'lda o'tkazishda MAJBURIY (kod darajasida talab qilinadi).
  reason text,
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_routing_events_lead
  on public.lead_routing_events(lead_id, created_at);
create index if not exists idx_routing_events_coordinator
  on public.lead_routing_events(coordinator_id, created_at desc);

-- ------------------------------------------------------------
-- 4. KUNLIK TALAB
--
--    Standart qiymat + sana bo'yicha istisno. Ertaga talab
--    o'zgarsa, KECHAGI natija kechagi talab bilan baholanadi —
--    shuning uchun sana bo'yicha saqlanadi.
-- ------------------------------------------------------------
create table if not exists public.coordinator_daily_targets (
  id uuid primary key default gen_random_uuid(),
  -- NULL — standart (barcha kunlar uchun).
  target_date date,
  -- NULL — milliy talab; to'ldirilgan bo'lsa shu hudud uchun.
  region_id uuid references public.regions(id) on delete cascade,
  target_sales integer not null check (target_sales >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bir sana + bir hudud uchun bitta qiymat. `coalesce` bilan:
-- NULL sana/hudud ham yagona bo'lishi kerak.
create unique index if not exists uq_daily_target
  on public.coordinator_daily_targets(
    coalesce(target_date, '1970-01-01'::date),
    coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

drop trigger if exists trg_targets_updated on public.coordinator_daily_targets;
create trigger trg_targets_updated
  before update on public.coordinator_daily_targets
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. KOMISSIYA DAFTARI
--
--    Komissiya FAQAT tasdiqlangan to'lovdan keyin yoziladi.
--    Mijozning "to'ladim" degani, chek yuborilgani yoki to'lov
--    so'ralgani — hech biri yetarli emas.
-- ------------------------------------------------------------
create table if not exists public.coordinator_commissions (
  id uuid primary key default gen_random_uuid(),
  coordinator_id uuid not null references public.coordinators(id) on delete restrict,
  lead_id uuid not null references public.coordinator_leads(id) on delete restrict,

  amount_uzs integer not null check (amount_uzs >= 0),

  status text not null default 'pending'
    check (status in ('pending', 'earned', 'paid', 'reversed')),

  -- Qaysi kun hisobiga (Toshkent kuni).
  business_date date not null,

  earned_at timestamptz,
  paid_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
 * BITTA LID — BITTA KOMISSIYA.
 *
 * To'lov tasdig'i ikki marta ishlansa (cron takrori, qo'lda
 * bosish), ikkinchi yozuv shu indeksga urilib to'xtaydi. Shart
 * bilan tekshirish yetarli emas: ikki parallel jarayon ikkalasi
 * ham "yo'q ekan" deb o'qishi mumkin.
 */
create unique index if not exists uq_commission_per_lead
  on public.coordinator_commissions(lead_id)
  where status <> 'reversed';

create index if not exists idx_commissions_coordinator_date
  on public.coordinator_commissions(coordinator_id, business_date desc);

drop trigger if exists trg_commissions_updated on public.coordinator_commissions;
create trigger trg_commissions_updated
  before update on public.coordinator_commissions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 6. BOT UPDATE DEDUPE
--
--    Telegram bitta update'ni bir necha marta yetkazishi mumkin.
--    Usiz bitta bosish ikki marta ishlanardi.
-- ------------------------------------------------------------
create table if not exists public.coordinator_bot_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

-- ============================================================
-- 7. ATOMIK BAND QILISH
--
--    Ikki koordinator bir vaqtda bosishi mumkin. "O'qib, keyin
--    yozish" ikkalasiga ham "bo'sh" deb ko'rinardi. Shuning uchun
--    shart UPDATE ning O'ZIDA: faqat qatorni haqiqatan o'zgartirgan
--    urinish g'olib bo'ladi.
-- ============================================================
create or replace function public.claim_coordinator_lead(
  p_lead_id uuid,
  p_coordinator_id uuid
)
returns table (claimed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
  v_region uuid;
begin
  select region_id into v_region
    from public.coordinators
   where id = p_coordinator_id and is_active and status = 'active';

  if not found then
    return query select false, 'coordinator_not_eligible'::text;
    return;
  end if;

  update public.coordinator_leads
     set assigned_coordinator_id = p_coordinator_id,
         assigned_coordinator_region_id = v_region,
         claimed_at = now(),
         state = 'claimed'
   where id = p_lead_id
     and assigned_coordinator_id is null
     and state = 'offered'
     and claim_deadline > now();

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- Nega bo'lmagani aniqlanadi: mijozga ko'rsatiladigan javob
    -- shunga qarab farq qiladi.
    if exists (select 1 from public.coordinator_leads
                where id = p_lead_id and assigned_coordinator_id is not null) then
      return query select false, 'already_claimed'::text;
    elsif exists (select 1 from public.coordinator_leads
                   where id = p_lead_id and claim_deadline <= now()) then
      return query select false, 'expired'::text;
    else
      return query select false, 'not_available'::text;
    end if;
    return;
  end if;

  insert into public.lead_routing_events (lead_id, event, coordinator_id, to_state)
  values (p_lead_id, 'claimed', p_coordinator_id, 'claimed');

  return query select true, null::text;
end;
$$;

-- ============================================================
-- 8. RLS
-- ============================================================
alter table public.coordinators enable row level security;
alter table public.coordinator_leads enable row level security;
alter table public.lead_routing_events enable row level security;
alter table public.coordinator_daily_targets enable row level security;
alter table public.coordinator_commissions enable row level security;
alter table public.coordinator_bot_updates enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'coordinators', 'coordinator_leads', 'lead_routing_events',
    'coordinator_daily_targets', 'coordinator_commissions'
  ] loop
    execute format('drop policy if exists "coordinators read" on public.%I', t);
    execute format(
      'create policy "coordinators read" on public.%I for select using (public.has_permission(%L))',
      t, 'coordinators.view'
    );
  end loop;
end $$;

-- ============================================================
-- 9. RUXSATLAR
-- ============================================================
insert into public.role_permissions (role_slug, permission) values
  ('admin', 'coordinators.view'),
  ('admin', 'coordinators.manage'),
  ('admin', 'coordinators.assign'),
  ('admin', 'coordinators.reports'),
  -- Nazoratchi rol: mavjud rollar ichida operatsion eng yaqini.
  -- 'manager' degan rol bu loyihada YO'Q va uni yozish role_permissions
  -- dagi tashqi kalitni buzardi.
  ('moderator', 'coordinators.view'),
  ('moderator', 'coordinators.reports'),
  ('analyst', 'coordinators.view'),
  ('analyst', 'coordinators.reports')
on conflict do nothing;

-- ============================================================
-- 10. SOZLAMALAR
--
--     MARSHRUTLASH O'CHIQ HOLATDA KELADI. Kod deploy bo'lgani bilan
--     hech bir koordinatorga xabar ketmaydi: koordinatorlar hali
--     kiritilmagan va bot sozlanmagan bo'lishi mumkin. Yoqishni
--     admin ataylab qiladi.
-- ============================================================
insert into public.site_settings (key, value) values
  ('coordinator.routing_enabled', 'false'),
  ('coordinator.claim_window_minutes', '10'),
  ('coordinator.commission_uzs', '10000'),
  ('coordinator.default_daily_target', '10'),
  ('coordinator.efficiency_min_leads', '5')
on conflict (key) do nothing;
