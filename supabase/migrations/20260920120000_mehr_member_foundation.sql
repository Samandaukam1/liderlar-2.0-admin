-- ============================================================
-- MEHR 365+ / PHASE 1 — A'ZO AKKAUNTI VA XAVFSIZLIK POYDEVORI
--
-- BITTA BOG'LANISH, BITTA HAQIQAT MANBAI
--
--   auth.users  ──  profiles.id        (mavjud, o'zgarmaydi)
--               ──  candidates.user_id (mavjud, o'zgarmaydi)
--
-- Bu migratsiya nomzod ↔ akkaunt bog'lanishini QAYTA YARATMAYDI.
-- `member_accounts` da `candidate_id` maydoni ATAYLAB YO'Q: u ikkinchi
-- bog'lanish bo'lardi va `candidates.user_id` bilan bir kun kelib
-- kelishmay qolardi. Nomzodni topish faqat `candidates.user_id`
-- orqali. Bu jadval faqat AKKAUNT HOLATINI saqlaydi.
--
-- QOIDA: qo'shimcha va qaytariladigan. Mavjud jadvallarga tegilmaydi,
-- mavjud ustunlar o'chirilmaydi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A'ZO AKKAUNTI — HOLAT, PAROL EMAS
--
--    OCHIQ PAROL HECH QACHON SAQLANMAYDI. Parol butunlay
--    Supabase Auth ixtiyorida. Bu yerda faqat "parol o'rnatilishi
--    kerakmi" degan bayroq turadi.
-- ------------------------------------------------------------
create table if not exists public.member_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,

  status text not null default 'active'
    check (status in ('active', 'disabled')),

  -- Migratsiya qilingan nomzod birinchi kirishda parolini o'zi
  -- o'rnatadi. Admin bu bayroqni qo'ya oladi, lekin parolni KO'RA OLMAYDI.
  must_set_password boolean not null default false,

  disabled_at timestamptz,
  disabled_by uuid references auth.users(id) on delete set null,
  disabled_reason text,

  last_login_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_accounts_status_idx
  on public.member_accounts (status);

drop trigger if exists member_accounts_set_updated_at on public.member_accounts;
create trigger member_accounts_set_updated_at
  before update on public.member_accounts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. TELEGRAM BOG'LANISHI
--
--    SHAXS = RAQAMLI ID. Username o'zgaradi va uni boshqa odam
--    egallab olishi mumkin, shuning uchun u hech qachon shaxsni
--    aniqlash uchun ishlatilmaydi — faqat ko'rsatish uchun.
--
--    Bu bot SOTUV va KOORDINATOR botlaridan butunlay alohida:
--    boshqa token, boshqa webhook, boshqa jadval.
-- ------------------------------------------------------------
create table if not exists public.member_telegram_links (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null references public.profiles(id) on delete cascade,
  telegram_user_id bigint not null,
  telegram_username text,

  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,

  created_at timestamptz not null default now()
);

/*
 * Bitta profil — bitta faol Telegram; bitta Telegram — bitta faol profil.
 * Qisman unikal indeks: uzilgan bog'lanishlar tarix uchun qoladi,
 * lekin yangisiga to'sqinlik qilmaydi.
 */
create unique index if not exists member_telegram_links_profile_active_uidx
  on public.member_telegram_links (profile_id)
  where unlinked_at is null;

create unique index if not exists member_telegram_links_tg_active_uidx
  on public.member_telegram_links (telegram_user_id)
  where unlinked_at is null;

-- ------------------------------------------------------------
-- 3. BOG'LASH TOKENI — QISQA MUDDATLI, BIR MARTALIK
--
--    TOKENNING O'ZI SAQLANMAYDI, faqat sha256 hash. Baza nusxasi
--    o'g'irlansa ham tokenlar bilan akkauntga kirib bo'lmaydi.
-- ------------------------------------------------------------
create table if not exists public.member_link_tokens (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- sha256(token) — hex. Ochiq token faqat foydalanuvchining
  -- brauzerida va Telegram deep-link'ida bo'ladi.
  token_hash text not null unique,

  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_telegram_id bigint,

  created_at timestamptz not null default now()
);

create index if not exists member_link_tokens_profile_idx
  on public.member_link_tokens (profile_id, created_at desc);

-- ------------------------------------------------------------
-- 4. QURILMALAR
--
--    MUHIM: brauzer barmoq izi ANIQ shaxs emas. `device_hash` —
--    bu faqat QATLAMLI SIGNAL: bir nechta oddiy belgidan olingan
--    barqaror bo'lmagan taxmin. Shuning uchun:
--      - u hech qachon yagona autentifikatsiya asosi bo'lmaydi;
--      - blok "kafolat" emas, "to'siq" sifatida qaraladi;
--      - foydalanuvchi o'z ommaviy profilini o'qishdan
--        to'sib qo'yilmaydi.
-- ------------------------------------------------------------
create table if not exists public.member_devices (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null references public.profiles(id) on delete cascade,

  device_hash text not null,

  -- Ko'rsatish uchun, shaxsni aniqlash uchun emas.
  label text,
  user_agent text,

  -- FAQAT DAG'AL hudud. Aniq koordinata yoki to'liq IP SAQLANMAYDI:
  -- xavfsizlik xabarnomasi uchun shahar darajasi yetarli.
  approx_location text,

  status text not null default 'untrusted'
    check (status in ('untrusted', 'trusted', 'blocked')),

  trusted_at timestamptz,
  blocked_at timestamptz,
  -- §18: rad etilgan qurilma 7 kunga bloklanadi.
  blocked_until timestamptz,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists member_devices_profile_hash_uidx
  on public.member_devices (profile_id, device_hash);

create index if not exists member_devices_status_idx
  on public.member_devices (profile_id, status);

drop trigger if exists member_devices_set_updated_at on public.member_devices;
create trigger member_devices_set_updated_at
  before update on public.member_devices
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. SEANSLAR
--
--    Supabase Auth seansning o'zini boshqaradi. Bu jadval
--    KO'RSATISH VA NAZORAT uchun metama'lumot saqlaydi —
--    refresh token yoki JWT bu yerda HECH QACHON turmaydi.
-- ------------------------------------------------------------
create table if not exists public.member_sessions (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid references public.member_devices(id) on delete set null,

  -- Supabase seansiga ishora (session id), maxfiy token EMAS.
  session_ref text,

  /*
   * §18 — YANGI QURILMA USHLAB TURISH.
   *
   * Yangi/ishonchsiz qurilmada seans 1 soat davomida cheklangan
   * bo'ladi: o'qish mumkin, xavfli amallar mumkin emas.
   * Telegram orqali tasdiqlansa — bekor qilinadi.
   */
  hold_until timestamptz,

  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);

create index if not exists member_sessions_profile_idx
  on public.member_sessions (profile_id, created_at desc);

create index if not exists member_sessions_active_idx
  on public.member_sessions (profile_id)
  where revoked_at is null;

-- ------------------------------------------------------------
-- 6. XAVFSIZLIK HODISALARI — FAQAT QO'SHILADI
--
--    Bu jurnal tahrirlanmaydi va o'chirilmaydi. Xato yozuv
--    bo'lsa, ustiga yangi tuzatuvchi hodisa yoziladi.
-- ------------------------------------------------------------
create table if not exists public.member_security_events (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid references public.profiles(id) on delete set null,
  device_id uuid references public.member_devices(id) on delete set null,
  session_id uuid references public.member_sessions(id) on delete set null,

  event_type text not null check (event_type in (
    'login',
    'new_device',
    'device_confirmed',
    'device_rejected',
    'device_blocked',
    'device_unblocked',
    'session_revoked',
    'telegram_linked',
    'telegram_unlinked',
    'password_reset_requested',
    'temp_credential_issued',
    'account_disabled',
    'account_restored',
    'hold_started',
    'hold_released'
  )),

  -- Kim bajardi: a'zoning o'zi, admin yoki tizim.
  actor text not null default 'system'
    check (actor in ('member', 'admin', 'system')),
  actor_user_id uuid references auth.users(id) on delete set null,

  -- Maxfiy ma'lumot (token, parol, aniq koordinata) YOZILMAYDI.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists member_security_events_profile_idx
  on public.member_security_events (profile_id, created_at desc);

create index if not exists member_security_events_type_idx
  on public.member_security_events (event_type, created_at desc);

-- ============================================================
-- 7. RLS
--
--    Uch qatlam:
--      a'zo       — faqat O'Z qatorlari;
--      admin      — has_permission() orqali;
--      service    — RLS'ni chetlab o'tadi (server-only amallar).
-- ============================================================
alter table public.member_accounts          enable row level security;
alter table public.member_telegram_links    enable row level security;
alter table public.member_link_tokens       enable row level security;
alter table public.member_devices           enable row level security;
alter table public.member_sessions          enable row level security;
alter table public.member_security_events   enable row level security;

-- A'zo o'z akkaunt holatini ko'radi.
drop policy if exists member_accounts_self_select on public.member_accounts;
create policy member_accounts_self_select on public.member_accounts
  for select using (profile_id = auth.uid());

drop policy if exists member_accounts_admin_select on public.member_accounts;
create policy member_accounts_admin_select on public.member_accounts
  for select using (public.has_permission('members.view'));

-- A'zo o'z Telegram bog'lanishini ko'radi.
drop policy if exists member_telegram_links_self_select on public.member_telegram_links;
create policy member_telegram_links_self_select on public.member_telegram_links
  for select using (profile_id = auth.uid());

drop policy if exists member_telegram_links_admin_select on public.member_telegram_links;
create policy member_telegram_links_admin_select on public.member_telegram_links
  for select using (public.has_permission('members.view'));

/*
 * BOG'LASH TOKENLARI — HECH KIMGA O'QISH UCHUN OCHIQ EMAS.
 *
 * Ataylab birorta select siyosati yo'q. Token hash faqat server
 * (service role) tomonidan tekshiriladi. Admin ham ko'ra olmaydi:
 * ko'rishning hech qanday qonuniy sababi yo'q.
 */

-- Qurilmalar va seanslar — a'zo o'zinikini ko'radi.
drop policy if exists member_devices_self_select on public.member_devices;
create policy member_devices_self_select on public.member_devices
  for select using (profile_id = auth.uid());

drop policy if exists member_devices_admin_select on public.member_devices;
create policy member_devices_admin_select on public.member_devices
  for select using (public.has_permission('members.view'));

drop policy if exists member_sessions_self_select on public.member_sessions;
create policy member_sessions_self_select on public.member_sessions
  for select using (profile_id = auth.uid());

drop policy if exists member_sessions_admin_select on public.member_sessions;
create policy member_sessions_admin_select on public.member_sessions
  for select using (public.has_permission('members.view'));

drop policy if exists member_security_events_self_select on public.member_security_events;
create policy member_security_events_self_select on public.member_security_events
  for select using (profile_id = auth.uid());

drop policy if exists member_security_events_admin_select on public.member_security_events;
create policy member_security_events_admin_select on public.member_security_events
  for select using (public.has_permission('members.view'));

/*
 * YOZISH SIYOSATI ATAYLAB YO'Q.
 *
 * Qurilmaga ishonch berish, seansni bekor qilish, bloklash —
 * hammasi tekshiruvdan o'tishi kerak va server action / bot orqali
 * service role bilan bajariladi. Mijoz tomonidan to'g'ridan-to'g'ri
 * yozish imkoniyati bo'lsa, a'zo o'z qurilmasini o'zi "ishonchli"
 * deb belgilab, butun xavfsizlik ushlab turishini chetlab o'tardi.
 */

-- ============================================================
-- 8. RUXSATLAR
--
--    src/lib/permissions.ts bilan AYNAN bir xil bo'lishi SHART:
--    RLS va server action bitta manbaga tayanadi.
-- ============================================================
insert into public.role_permissions (role_slug, permission) values
  ('admin', 'members.view'),
  ('admin', 'members.manage'),
  ('moderator', 'members.view'),
  ('analyst', 'members.view')
on conflict do nothing;

-- ============================================================
-- 9. BAYROQLAR — HAMMASI O'CHIQ HOLATDA KELADI
--
--    §43: infratuzilma avval xavfsiz joylashadi, keyin nazorat
--    ostida yoqiladi. Deploy o'z-o'zidan hech nimani yoqmaydi.
-- ============================================================
insert into public.site_settings (key, value) values
  ('mehr.public_enabled', 'false'),
  ('mehr.activity_creation_enabled', 'false'),
  ('mehr.qr_checkin_enabled', 'false'),
  ('mehr.points_enabled', 'false'),
  ('mehr.certificates_enabled', 'false'),
  ('member.auth_enabled', 'false'),
  ('member.bot_enabled', 'false'),
  ('referral.points_enabled', 'false')
on conflict (key) do nothing;
