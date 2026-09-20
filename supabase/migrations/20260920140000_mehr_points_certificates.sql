-- ============================================================
-- MEHR 365+ / PHASE 1c — BALL DAFTARI, SERTIFIKAT, REFERRAL
--
-- ENG MUHIM QOIDA: BALL — TAHRIRLANADIGAN RAQAM EMAS, DAFTAR.
--
-- Hech kim "ball = 120" deb yozib qo'ymaydi. Har bir ball
-- o'zgarmas yozuv sifatida tushadi va jamlanma shu yozuvlardan
-- hisoblanadi. Xato bo'lsa — yozuv o'chirilmaydi, ustiga teskari
-- yozuv qo'shiladi (§41).
--
-- TAKRORLANMASLIK VA'DA BILAN EMAS, INDEKS BILAN TA'MINLANADI.
-- ============================================================

-- ------------------------------------------------------------
-- 1. BALL QOIDALARI — SOZLANADIGAN, KODGA QOTIRILMAGAN
--
--    §28: ball iqtisodiyoti UI komponenti ichida yashirinmaydi.
-- ------------------------------------------------------------
create table if not exists public.point_rules (
  code text primary key,

  /*
   * §29 — UMUMIY LIDERLAR KATEGORIYALARI.
   * MEHR asosan 'ijtimoiy_tasir' va 'yetakchilik' ga hissa qo'shadi;
   * referral esa 'jamiyatga_hissa' ga.
   */
  category text not null check (category in (
    'ijtimoiy_tasir',
    'yetakchilik',
    'intellektual',
    'yutuqlar',
    'jamiyatga_hissa'
  )),

  label text not null,
  points integer not null,
  is_active boolean not null default true,
  description text,

  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists point_rules_set_updated_at on public.point_rules;
create trigger point_rules_set_updated_at
  before update on public.point_rules
  for each row execute function public.set_updated_at();

-- V1 bazasi (§28) + kelajakdagi manbalar uchun karkas (§32).
insert into public.point_rules (code, category, label, points, is_active, description) values
  ('mehr.participant',        'ijtimoiy_tasir', 'MEHR — tasdiqlangan ishtirokchi',        20, true,  'Tasdiqlangan MEHR tadbirida ishtirok.'),
  ('mehr.co_organizer',       'yetakchilik',    'MEHR — hamkor tashkilotchi',             40, true,  'Tasdiqlangan MEHR tadbirini hamkorlikda tashkil etish.'),
  ('mehr.organizer',          'yetakchilik',    'MEHR — tashkilotchi',                    60, true,  'Tasdiqlangan MEHR tadbirini tashkil etish.'),

  ('referral.registered',     'jamiyatga_hissa','Referral — yangi ro''yxatdan o''tgan a''zo', 10, true, 'Havola orqali kelgan yangi haqiqiy a''zo.'),
  ('referral.activated',      'jamiyatga_hissa','Referral — profil faollashdi',           20, true,  'Taklif qilingan a''zo profili tasdiqlandi.'),
  ('referral.paid',           'jamiyatga_hissa','Referral — to''lov tasdiqlandi',         40, true,  'FAQAT payment_confirmed holatida.'),

  ('referral.milestone_5',    'jamiyatga_hissa','Referral — 5 ta to''langan',             30, true,  null),
  ('referral.milestone_10',   'jamiyatga_hissa','Referral — 10 ta to''langan',            70, true,  null),
  ('referral.milestone_25',   'jamiyatga_hissa','Referral — 25 ta to''langan',           150, true,  null),
  ('referral.milestone_50',   'jamiyatga_hissa','Referral — 50 ta to''langan',           300, true,  null),
  ('referral.milestone_100',  'jamiyatga_hissa','Referral — 100 ta to''langan',          600, true,  null),

  -- Kelajakdagi manbalar: karkas tayyor, lekin O'CHIQ.
  ('event.attendance',        'ijtimoiy_tasir', 'Liderlar tadbirida ishtirok',            15, false, null),
  ('event.volunteer',         'ijtimoiy_tasir', 'Liderlar tadbirida volontyor',           25, false, null),
  ('event.organizer',         'yetakchilik',    'Liderlar tadbiri tashkilotchisi',        60, false, null),
  ('article.editorial',       'intellektual',   'Tasdiqlangan publitsistik maqola',       15, false, null),
  ('article.scientific',      'intellektual',   'Tasdiqlangan ilmiy maqola',              30, false, null),
  ('mentorship.verified',     'yetakchilik',    'Tasdiqlangan mentorlik',                 20, false, null),
  ('achievement.district',    'yutuqlar',       'Tuman/universitet darajasidagi yutuq',   15, false, null),
  ('achievement.regional',    'yutuqlar',       'Viloyat darajasidagi yutuq',             30, false, null),
  ('achievement.national',    'yutuqlar',       'Respublika darajasidagi yutuq',          80, false, null),
  ('achievement.international','yutuqlar',      'Xalqaro darajadagi yutuq',              120, false, null)
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 2. BALL DAFTARI — O'ZGARMAS
-- ------------------------------------------------------------
create table if not exists public.point_ledger (
  id uuid primary key default gen_random_uuid(),

  /*
   * CASCADE EMAS, RESTRICT.
   *
   * Cascade bo'lsa, profil o'chirilganda daftar qatorlari ham
   * o'chirilardi — va bu quyidagi o'zgarmaslik triggeriga urilib,
   * butun amal tushunarsiz xato bilan yiqilardi.
   *
   * Restrict esa holatni ochiq aytadi: ball tarixi bor a'zoni
   * O'CHIRIB BO'LMAYDI. Mahsulotda bunday ehtiyoj ham yo'q —
   * §11 o'chirishni emas, "akkauntni bloklash / tiklash"ni
   * talab qiladi.
   */
  profile_id uuid not null references public.profiles(id) on delete restrict,

  rule_code text references public.point_rules(code) on delete set null,
  category text not null check (category in (
    'ijtimoiy_tasir', 'yetakchilik', 'intellektual', 'yutuqlar', 'jamiyatga_hissa'
  )),

  source_type text not null check (source_type in (
    'mehr_activity', 'referral', 'event', 'article', 'achievement', 'adjustment'
  )),
  source_id uuid,

  -- Teskari yozuv uchun manfiy bo'lishi mumkin. 0 — ma'nosiz yozuv.
  points integer not null check (points <> 0),

  /*
   * TAKRORLANMASLIK KALITI.
   *
   * Masalan: 'mehr_activity:<id>:participant:<profile_id>'.
   * Tasdiq ikki marta bosilsa, ikkinchisi shu indeksda yiqiladi —
   * ya'ni ball ikki marta tushishi MUMKIN EMAS. Bu ilova mantig'i
   * emas, bazaning kafolati.
   */
  idempotency_key text not null unique,

  /*
   * Tuzatish qaysi yozuvni bekor qilyapti (§41).
   *
   * `set null` bo'lsa, ota yozuv o'chirilganda bu qatorga UPDATE
   * tushardi — o'zgarmaslik triggeri uni ham to'sardi. Restrict
   * bir xil qoidani saqlaydi: daftardan hech nima chiqmaydi.
   */
  reverses_ledger_id uuid references public.point_ledger(id) on delete restrict,

  note text,
  metadata jsonb not null default '{}'::jsonb,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists point_ledger_profile_idx
  on public.point_ledger (profile_id, created_at desc);

create index if not exists point_ledger_source_idx
  on public.point_ledger (source_type, source_id);

create index if not exists point_ledger_category_idx
  on public.point_ledger (profile_id, category);

/*
 * DAFTAR TAHRIRLANMAYDI VA O'CHIRILMAYDI.
 *
 * Bu trigger service role'ga ham tegishli: "tezroq bo'lsin" deb
 * tarixni o'zgartirish yo'li ochiq qolsa, daftarning butun ma'nosi
 * yo'qoladi. Tuzatish faqat yangi teskari yozuv bilan.
 */
create or replace function public.point_ledger_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'point_ledger o''zgarmas: tuzatish uchun teskari yozuv qo''shing (reverses_ledger_id)';
end;
$$;

drop trigger if exists point_ledger_no_update on public.point_ledger;
create trigger point_ledger_no_update
  before update or delete on public.point_ledger
  for each row execute function public.point_ledger_is_append_only();

-- ------------------------------------------------------------
-- 3. JAMLANMA — REYTING UCHUN
--
--    §39: minglab volontyorni mijoz tomonida yuklab reyting
--    hisoblanmaydi. Jamlanma serverda turadi.
-- ------------------------------------------------------------
create table if not exists public.point_aggregates (
  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- 'all' | 'year' | 'month'
  period text not null check (period in ('all', 'year', 'month')),
  -- 'all' uchun 'all'; yil uchun '2026'; oy uchun '2026-09'.
  period_key text not null,

  category text not null check (category in (
    'ijtimoiy_tasir', 'yetakchilik', 'intellektual', 'yutuqlar', 'jamiyatga_hissa', 'total'
  )),

  total_points integer not null default 0,
  updated_at timestamptz not null default now(),

  primary key (profile_id, period, period_key, category)
);

create index if not exists point_aggregates_ranking_idx
  on public.point_aggregates (period, period_key, category, total_points desc);

-- ------------------------------------------------------------
-- 4. SERTIFIKATLAR
--
--    Mavjud PDF generatori (src/lib/certificates) chizuvchi bo'lib
--    qoladi. Bu jadval — uning RO'YXATI: kim, nima uchun, qachon
--    oldi va u hamon haqiqiymi.
-- ------------------------------------------------------------
create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),

  -- Ommaviy tekshirish manzilidagi kod. Uuid emas: qisqa va
  -- QR'ga sig'adigan bo'lishi kerak.
  code text not null unique,

  recipient_profile_id uuid not null references public.profiles(id) on delete restrict,

  kind text not null default 'mehr_activity'
    check (kind in ('mehr_activity', 'candidate')),

  /*
   * CASCADE EMAS: tadbir o'chirilsa, berilgan sertifikat ham
   * yo'qolib, ommaviy tekshirishda "topilmadi" chiqardi — ya'ni
   * haqiqiy sertifikat soxtadan farq qilmay qolardi.
   *
   * Qoralama tadbirda sertifikat bo'lmaydi, shuning uchun bu
   * cheklov faqat TASDIQLANGAN tadbirni himoya qiladi.
   */
  activity_id uuid references public.mehr_activities(id) on delete restrict,

  -- Ishtirokchi va tashkilotchi sertifikati ANIQ FARQ QILADI (§33).
  role text check (role in ('participant', 'co_organizer', 'organizer')),

  issued_at timestamptz not null default now(),

  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint certificates_revoked_reason check (
    status <> 'revoked'
    or (revoked_reason is not null and char_length(btrim(revoked_reason)) > 0)
  ),

  constraint certificates_activity_required check (
    kind <> 'mehr_activity' or (activity_id is not null and role is not null)
  )
);

/*
 * BITTA TADBIR + BITTA ODAM + BITTA ROL = BITTA SERTIFIKAT.
 * Tasdiq qayta ishga tushsa, ikkinchi sertifikat bazada yiqiladi.
 */
create unique index if not exists certificates_activity_recipient_role_uidx
  on public.certificates (activity_id, recipient_profile_id, role)
  where activity_id is not null;

create index if not exists certificates_recipient_idx
  on public.certificates (recipient_profile_id, issued_at desc);

-- ------------------------------------------------------------
-- 5. REFERRAL KODLARI
-- ------------------------------------------------------------
create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  code text not null unique check (char_length(code) between 4 and 32),

  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 6. ATRIBUTSIYA — KIM KIMNI OLIB KELDI
--
--    §31: O'ZINI O'ZI TAKLIF QILISH — 0 BALL.
--    Buni tekshiruv emas, baza cheklovi to'sadi.
-- ------------------------------------------------------------
create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),

  referrer_profile_id uuid not null references public.profiles(id) on delete cascade,

  -- Hayot yo'lining har bosqichida to'ldirilib boradi.
  application_id uuid references public.applications(id) on delete set null,
  referred_profile_id uuid references public.profiles(id) on delete set null,
  candidate_id uuid references public.candidates(id) on delete set null,

  stage text not null default 'visited' check (stage in (
    'visited', 'application', 'registered', 'activated', 'payment_confirmed'
  )),

  -- Shubhali halqa/dublikat belgisi (§34). Ayblov emas — ko'rik belgisi.
  risk_flags jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint referral_no_self check (
    referred_profile_id is null or referred_profile_id <> referrer_profile_id
  )
);

drop trigger if exists referral_attributions_set_updated_at on public.referral_attributions;
create trigger referral_attributions_set_updated_at
  before update on public.referral_attributions
  for each row execute function public.set_updated_at();

-- Bitta ariza — bitta taklifchi.
create unique index if not exists referral_attributions_application_uidx
  on public.referral_attributions (application_id)
  where application_id is not null;

-- Bitta taklif qilingan a'zo — bitta taklifchi.
create unique index if not exists referral_attributions_referred_uidx
  on public.referral_attributions (referred_profile_id)
  where referred_profile_id is not null;

create index if not exists referral_attributions_referrer_idx
  on public.referral_attributions (referrer_profile_id, stage);

-- ------------------------------------------------------------
-- 7. REFERRAL MUKOFOTLARI
--
--    §30: bosqichlar BIR-BIRINI ALMASHTIRMAYDI, ustiga qo'shiladi,
--    lekin HAR BOSQICH MUSTAQIL RAVISHDA BIR MARTA beriladi.
--    Ya'ni bitta odam uchun 'registered' va keyin 'paid' — ikkalasi
--    ham tushadi, ammo har biri aynan bir marta.
-- ------------------------------------------------------------
create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),

  attribution_id uuid references public.referral_attributions(id) on delete cascade,
  referrer_profile_id uuid not null references public.profiles(id) on delete cascade,

  stage text not null check (stage in (
    'registered', 'activated', 'payment_confirmed',
    'milestone_5', 'milestone_10', 'milestone_25', 'milestone_50', 'milestone_100'
  )),

  rule_code text references public.point_rules(code) on delete set null,
  points integer not null,

  ledger_id uuid references public.point_ledger(id) on delete set null,

  created_at timestamptz not null default now()
);

-- Bitta atributsiya uchun bitta bosqich — bir marta.
create unique index if not exists referral_rewards_attribution_stage_uidx
  on public.referral_rewards (attribution_id, stage)
  where attribution_id is not null;

-- Marralar atributsiyaga bog'lanmaydi — ular taklifchiga tegishli.
create unique index if not exists referral_rewards_milestone_uidx
  on public.referral_rewards (referrer_profile_id, stage)
  where attribution_id is null;

create index if not exists referral_rewards_referrer_idx
  on public.referral_rewards (referrer_profile_id, created_at desc);

-- ============================================================
-- 8. SOZLAMALAR
-- ============================================================
insert into public.site_settings (key, value) values
  /*
   * §31 — PUL BILAN REYTING SOTIB OLINMAYDI.
   *
   * Referral xom balli to'liq ko'rinadi, lekin umumiy reytingga
   * ta'siri cheklangan. 30% — boshlang'ich qiymat.
   */
  ('referral.ranking_cap_percent', '30'),
  ('mehr.checkin_token_ttl_seconds', '30'),
  ('member.new_device_hold_minutes', '60'),
  ('member.blocked_device_days', '7')
on conflict (key) do nothing;
