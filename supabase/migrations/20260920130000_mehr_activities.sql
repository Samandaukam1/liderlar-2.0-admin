-- ============================================================
-- MEHR 365+ / PHASE 1b — EZGULIK ISHLARI DOMENI
--
-- ISHONCH ZANJIRI (§46) — hech bir bo'g'in tashlab ketilmaydi:
--
--   HAQIQIY ODAM → HAQIQIY TADBIR → TASDIQLANGAN ISHTIROK
--   → DALIL → ADMIN TASDIG'I → O'ZGARMAS BALL DAFTARI
--   → SERTIFIKAT → REYTING → OMMAVIY HIKOYA
--
-- Shuning uchun bu yerda "ball" degan ustun YO'Q. Ball faqat
-- daftarda (point_ledger) va faqat tasdiqdan keyin paydo bo'ladi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. KATEGORIYALAR
-- ------------------------------------------------------------
create table if not exists public.mehr_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  icon text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.mehr_categories (slug, name, sort_order) values
  ('ijtimoiy-yordam',   'Ijtimoiy yordam',        10),
  ('talim',             'Ta''lim va bilim',       20),
  ('salomatlik',        'Salomatlik',             30),
  ('ekologiya',         'Ekologiya',              40),
  ('madaniyat',         'Madaniyat va ma''naviyat', 50),
  ('sport',             'Sport',                  60),
  ('hayriya',           'Hayriya',                70),
  ('boshqa',            'Boshqa',                 99)
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- 2. EZGULIK ISHI (TADBIR)
-- ------------------------------------------------------------
create table if not exists public.mehr_activities (
  id uuid primary key default gen_random_uuid(),

  -- Tashkilotchi — a'zo profili. Nomzod bo'lishi SHART EMAS.
  organizer_profile_id uuid not null references public.profiles(id) on delete restrict,

  category_id uuid references public.mehr_categories(id) on delete set null,
  region_id uuid references public.regions(id) on delete set null,

  title text not null check (char_length(title) between 3 and 200),
  slug text unique,

  purpose text,
  description text,
  result_summary text,
  notes text,

  cover_image_url text,

  -- Joy: ommaviy sahifada faqat hudud/shahar darajasida ko'rsatiladi.
  location_name text,
  /*
   * Tekshirish uchun koordinata. OMMAVIY YO'LLARDA HECH QACHON
   * BERILMAYDI — §7 va §36 talabi. Onlayn tadbirlar uchun null.
   */
  latitude double precision,
  longitude double precision,
  checkin_radius_meters integer check (checkin_radius_meters is null or checkin_radius_meters between 20 and 20000),
  -- Onlayn/joydan mustaqil tadbirlar uchun joy tekshiruvi o'chiriladi.
  requires_location boolean not null default true,

  starts_at timestamptz,
  ends_at timestamptz,

  expected_participants integer check (expected_participants is null or expected_participants >= 0),
  beneficiary_count integer check (beneficiary_count is null or beneficiary_count >= 0),

  /*
   * HOLAT.
   *
   * 'draft'  — bot/Mini App yaratgan, tadbir hali bo'lmagan yoki
   *            dalil to'ldirilmagan;
   * 'submitted' — tashkilotchi tekshiruvga yubordi;
   * 'changes_requested' — admin tuzatish so'radi (sabab SHART);
   * 'approved'  — ball, sertifikat va ommaviy sahifa shundan keyin;
   * 'rejected'  — sabab SHART.
   */
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'rejected')),

  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_reason text,

  approved_at timestamptz,

  -- Shubhali faoliyat bayrog'i (§34). Ayblov emas — ko'rib chiqish belgisi.
  risk_flags jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * Rad etish va tuzatish so'rovi SABABSIZ bo'lmaydi (§26).
   * Buni ilova emas, baza kafolatlaydi.
   */
  constraint mehr_activities_reason_required check (
    status not in ('rejected', 'changes_requested')
    or (review_reason is not null and char_length(btrim(review_reason)) > 0)
  ),

  constraint mehr_activities_time_order check (
    starts_at is null or ends_at is null or ends_at >= starts_at
  ),

  /*
   * Joy tekshiruvi talab qilinsa, koordinata va radius bo'lishi shart.
   * Aks holda "tekshirildi" degan yolg'on holat paydo bo'lardi.
   */
  constraint mehr_activities_location_complete check (
    requires_location = false
    or (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null and checkin_radius_meters is not null)
  )
);

create index if not exists mehr_activities_status_idx
  on public.mehr_activities (status, created_at desc);

create index if not exists mehr_activities_organizer_idx
  on public.mehr_activities (organizer_profile_id, created_at desc);

create index if not exists mehr_activities_region_idx
  on public.mehr_activities (region_id) where status = 'approved';

create index if not exists mehr_activities_public_idx
  on public.mehr_activities (approved_at desc) where status = 'approved';

drop trigger if exists mehr_activities_set_updated_at on public.mehr_activities;
create trigger mehr_activities_set_updated_at
  before update on public.mehr_activities
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. TADBIR SEANSI — QR SHU YERDA AYLANADI
--
--    §23: bitta statik QR yetarli emas — uni skrinshot qilib
--    tarqatish mumkin. Shuning uchun QR qisqa muddatli imzolangan
--    token bo'ladi; seans esa uning kalitini va amal qilish
--    oynasini ushlab turadi.
-- ------------------------------------------------------------
create table if not exists public.mehr_activity_sessions (
  id uuid primary key default gen_random_uuid(),

  activity_id uuid not null references public.mehr_activities(id) on delete cascade,

  /*
   * QR TOKENLARINI IMZOLASH KALITI.
   *
   * Har seansga alohida: bitta tadbirning kaliti sizib chiqsa,
   * boshqalari zararlanmaydi. Token bazada saqlanmaydi — u
   * HMAC bilan imzolanadi va shu kalit bilan tekshiriladi.
   */
  signing_secret text not null,

  -- QR necha soniyada yangilanadi (§23).
  rotation_seconds integer not null default 30
    check (rotation_seconds between 10 and 300),

  opens_at timestamptz not null default now(),
  closes_at timestamptz,

  status text not null default 'open'
    check (status in ('open', 'closed')),

  created_at timestamptz not null default now()
);

create index if not exists mehr_activity_sessions_activity_idx
  on public.mehr_activity_sessions (activity_id, created_at desc);

-- ------------------------------------------------------------
-- 4. ISHTIROKCHILAR
--
--    Rol shu yerda: ishtirokchi / hamkor-tashkilotchi / tashkilotchi.
--    Ball miqdori bu yerda EMAS — u qoidalar jadvalidan olinadi.
-- ------------------------------------------------------------
create table if not exists public.mehr_participants (
  id uuid primary key default gen_random_uuid(),

  activity_id uuid not null references public.mehr_activities(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,

  role text not null default 'participant'
    check (role in ('participant', 'co_organizer', 'organizer')),

  status text not null default 'checked_in'
    check (status in ('checked_in', 'checked_out', 'removed')),

  checked_in_at timestamptz,
  checked_out_at timestamptz,

  /*
   * TASDIQ PAYTIDA MUZLATILADI (§27).
   *
   * Tasdiqdan keyin ro'yxat o'zgarsa, allaqachon berilgan ballar
   * va sertifikatlar bilan kelishmay qolardi. Shuning uchun tasdiq
   * ishtirokni aynan shu holatda qotiradi.
   */
  frozen_at timestamptz,

  created_at timestamptz not null default now()
);

/*
 * BITTA ODAM — BITTA TADBIRDA BITTA MARTA.
 * Takroriy check-in tekshirib-keyin-yozish bilan emas, indeks
 * bilan to'siladi: ikki so'rov bir vaqtda kelsa ham ikkinchisi
 * bazada yiqiladi.
 */
create unique index if not exists mehr_participants_activity_profile_uidx
  on public.mehr_participants (activity_id, profile_id);

create index if not exists mehr_participants_profile_idx
  on public.mehr_participants (profile_id, created_at desc);

-- ------------------------------------------------------------
-- 5. CHECK-IN YOZUVLARI — DALIL
-- ------------------------------------------------------------
create table if not exists public.mehr_checkins (
  id uuid primary key default gen_random_uuid(),

  activity_session_id uuid not null references public.mehr_activity_sessions(id) on delete cascade,
  participant_id uuid not null references public.mehr_participants(id) on delete cascade,

  -- Token ichidagi nonce — takroriy ishlatishni to'sish uchun.
  nonce text not null,

  -- Joy tekshiruvi natijasi. Aniq koordinata EMAS, faqat xulosa:
  -- ommaviy sahifaga ham, adminga ham masofa yetarli.
  location_verified boolean,
  distance_meters integer,

  telegram_user_id bigint,

  created_at timestamptz not null default now()
);

/*
 * TAKRORIY CHECK-IN — ODAM BO'YICHA TO'SILADI, TOKEN BO'YICHA EMAS.
 *
 * Nonce'ni unikal qilish vasvasa qiladi, lekin bu XATO bo'lardi:
 * QR tadbirda bitta ekranda turadi va uni o'nlab odam BIR VAQTDA
 * skanerlaydi. Nonce unikal bo'lsa, birinchi odamdan keyingilari
 * bazada yiqilardi.
 *
 * Skrinshot qilingan QR'ni esa boshqa narsa to'sadi: token 30
 * soniyada tugaydi va joy tekshiruvi bor.
 */
create unique index if not exists mehr_checkins_session_participant_uidx
  on public.mehr_checkins (activity_session_id, participant_id);

create index if not exists mehr_checkins_participant_idx
  on public.mehr_checkins (participant_id);

-- Nonce dalil sifatida qoladi: qaysi token bilan kirgani ko'rinadi.
create index if not exists mehr_checkins_nonce_idx
  on public.mehr_checkins (activity_session_id, nonce);

-- ------------------------------------------------------------
-- 6. MEDIA (DALIL)
-- ------------------------------------------------------------
create table if not exists public.mehr_media (
  id uuid primary key default gen_random_uuid(),

  activity_id uuid not null references public.mehr_activities(id) on delete cascade,

  url text not null,
  kind text not null default 'photo' check (kind in ('photo', 'video', 'document')),
  caption text,
  sort_order integer not null default 0,

  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists mehr_media_activity_idx
  on public.mehr_media (activity_id, sort_order);

-- ------------------------------------------------------------
-- 7. TEKSHIRUV TARIXI — FAQAT QO'SHILADI
--
--    Tasdiq/rad tarixi ustiga yozilmaydi. Qayta yuborilgan
--    tadbirning butun yo'li ko'rinib turishi kerak.
-- ------------------------------------------------------------
create table if not exists public.mehr_reviews (
  id uuid primary key default gen_random_uuid(),

  activity_id uuid not null references public.mehr_activities(id) on delete cascade,

  action text not null check (action in ('submitted', 'approved', 'rejected', 'changes_requested')),
  reason text,

  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint mehr_reviews_reason_required check (
    action not in ('rejected', 'changes_requested')
    or (reason is not null and char_length(btrim(reason)) > 0)
  )
);

create index if not exists mehr_reviews_activity_idx
  on public.mehr_reviews (activity_id, created_at desc);

-- ------------------------------------------------------------
-- 8. TASDIQLANGAN TADBIR O'CHIRILMAYDI
--
--    Tasdiqdan keyin tadbir uchta narsani tug'diradi: ball
--    daftaridagi yozuvlar, sertifikatlar va ommaviy hikoya.
--    Tadbirni o'chirish ularni yetim qoldirardi — ball qolib,
--    sababi yo'qolardi.
--
--    Qoralama va rad etilgan tadbirni o'chirish esa ochiq:
--    ular hech nima tug'dirmagan.
-- ------------------------------------------------------------
create or replace function public.mehr_activity_block_approved_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'approved' then
    raise exception 'Tasdiqlangan ezgulik ishini o''chirib bo''lmaydi (id=%). Ball va sertifikatlar unga bog''langan.', old.id;
  end if;
  return old;
end;
$$;

drop trigger if exists mehr_activities_no_delete_approved on public.mehr_activities;
create trigger mehr_activities_no_delete_approved
  before delete on public.mehr_activities
  for each row execute function public.mehr_activity_block_approved_delete();
