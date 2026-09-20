-- ============================================================
-- PHASE 12 — NOMZOD → AKKAUNT FAOLLASHTIRISH
--
-- MAVJUD IDENTITY MODELI O'ZGARMAYDI:
--
--   auth.users ──(trigger handle_new_user)── profiles
--              ──(candidates.user_id)────── candidates ── articles
--
-- Bu migratsiya YANGI identity yaratmaydi. U faqat bitta
-- yetishmayotgan narsani qo'shadi: nomzod o'z hisobini
-- XAVFSIZ tarzda faollashtira oladigan yo'l.
--
-- OCHIQ PAROL HECH QAYERDA SAQLANMAYDI va bu yerda parol
-- degan tushuncha umuman yo'q — autentifikatsiya butunlay
-- Supabase Auth ixtiyorida qoladi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. BITTA AUTH USER — BITTA NOMZOD
--
--    `candidates.user_id` da unikal cheklov YO'Q edi. Ya'ni
--    bitta hisob bir nechta nomzod profilini egallab olishi
--    mumkin edi va buni hech nima to'smasdi.
--
--    Avval mavjud ma'lumotni tekshiramiz: agar dublikat bo'lsa,
--    migratsiya TUSHUNARLI XATO bilan to'xtaydi va hech nimani
--    o'zgartirmaydi. Jimgina "tuzatib yuborish" bu yerda
--    xavfli bo'lardi — qaysi bog'lanish to'g'ri ekanini faqat
--    odam hal qila oladi.
-- ------------------------------------------------------------
do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes
  from (
    select user_id
    from public.candidates
    where user_id is not null and deleted_at is null
    group by user_id
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'Bitta auth hisobga bog''langan % ta takroriy nomzod bor. Unikal indeks qo''yishdan oldin ularni qo''lda hal qiling.', v_dupes;
  end if;
end;
$$;

create unique index if not exists candidates_user_id_uidx
  on public.candidates (user_id)
  where user_id is not null and deleted_at is null;

comment on index public.candidates_user_id_uidx is
  'Bitta auth hisob — bitta nomzod. O''chirilgan nomzodlar hisobga olinmaydi.';

-- ------------------------------------------------------------
-- 2. FAOLLASHTIRISH TAKLIFNOMALARI
--
--    TOKENNING O'ZI SAQLANMAYDI — faqat sha256 hash. Baza
--    nusxasi sizib chiqsa ham, undan ishlaydigan faollashtirish
--    havolasi yasab bo'lmaydi.
-- ------------------------------------------------------------
create table if not exists public.candidate_activations (
  id uuid primary key default gen_random_uuid(),

  candidate_id uuid not null references public.candidates(id) on delete cascade,

  -- sha256(token), hex. Ochiq token faqat adminning ekranida
  -- va nomzodning havolasida bo'ladi.
  token_hash text not null unique,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  consumed_at timestamptz,
  /*
   * Kim ishlatgani. Taklifnoma ishlatilgan-u, nomzod
   * bog'lanmay qolgan holatni ANIQLASH uchun kerak: Supabase
   * Auth va Postgres alohida tizimlar va ular orasida to'liq
   * atomiklik yo'q. Bu ustun yarim qolgan holatni ko'rinadigan
   * qiladi.
   */
  consumed_by_user_id uuid references auth.users(id) on delete set null,

  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text,

  /*
   * Taklifnoma qanday ishlatilgani: yangi hisob yaratildimi
   * yoki mavjud hisob bog'landimi. Audit uchun.
   */
  consumed_mode text check (consumed_mode in ('new_account', 'existing_account')),

  -- Necha marta noto'g'ri urinish bo'lgani — suiiste'molni ko'rish uchun.
  failed_attempts integer not null default 0,

  metadata jsonb not null default '{}'::jsonb,

  constraint candidate_activations_revoke_reason check (
    revoked_at is null
    or (revoke_reason is not null and char_length(btrim(revoke_reason)) > 0)
  )
);

/*
 * BITTA NOMZOD — BITTA AMALDAGI TAKLIFNOMA.
 *
 * Bir vaqtda bir nechtasi amal qilsa, eskisi ekran suratida
 * yoki xabarda qolib, keyin kimdir undan foydalanishi mumkin
 * edi. Yangisini yaratish eskisini bekor qiladi (ilova
 * tomonda), indeks esa poygani to'sadi.
 */
create unique index if not exists candidate_activations_one_active_uidx
  on public.candidate_activations (candidate_id)
  where consumed_at is null and revoked_at is null;

create index if not exists candidate_activations_candidate_idx
  on public.candidate_activations (candidate_id, created_at desc);

create index if not exists candidate_activations_expiry_idx
  on public.candidate_activations (expires_at)
  where consumed_at is null and revoked_at is null;

-- ------------------------------------------------------------
-- 3. XAVFSIZLIK HODISALARI — MAVJUD JADVALNI KENGAYTIRAMIZ
--
--    Yangi jadval yaratish vasvasa qiladi, lekin shunda a'zo
--    xavfsizligi tarixi ikki joyga bo'linardi va "bu odamda
--    nima bo'lgan?" degan savolga javob berish qiyinlashardi.
-- ------------------------------------------------------------
alter table public.member_security_events
  drop constraint if exists member_security_events_event_type_check;

alter table public.member_security_events
  add constraint member_security_events_event_type_check check (event_type in (
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
    'hold_released',
    -- Phase 12
    'activation_created',
    'activation_revoked',
    'activation_consumed',
    'activation_failed',
    'account_linked',
    'account_unlinked',
    'account_link_conflict'
  ));

/*
 * Hodisa nomzodga ham tegishli bo'lishi mumkin — masalan
 * taklifnoma yaratilganda hali hech qanday profil yo'q.
 */
alter table public.member_security_events
  add column if not exists candidate_id uuid references public.candidates(id) on delete set null;

create index if not exists member_security_events_candidate_idx
  on public.member_security_events (candidate_id, created_at desc);

-- ------------------------------------------------------------
-- 4. RLS
--
--    TAKLIFNOMALAR HECH KIMGA O'QISH UCHUN OCHILMAYDI.
--
--    Admin ham ularni PostgREST orqali o'qimaydi: ro'yxatni
--    server (service role) tayyorlaydi va faqat kerakli
--    ustunlarni uzatadi. Token hash hech qayerga chiqmaydi.
-- ------------------------------------------------------------
alter table public.candidate_activations enable row level security;

/*
 * Birorta siyosat ATAYLAB yo'q. Anon ham, authenticated ham
 * hech nima ko'rmaydi va hech nima yoza olmaydi. Faollashtirish
 * tokenini tekshirish faqat server tomonda bo'ladi.
 */

-- ------------------------------------------------------------
-- 5. BAYROQ VA SOZLAMALAR
-- ------------------------------------------------------------
insert into public.site_settings (key, value) values
  /*
   * O'CHIQ HOLATDA KELADI. Yoqilmaguncha yangi taklifnoma
   * YARATILMAYDI. Mavjud kirish esa bundan ta'sirlanmaydi —
   * bayroq faqat yangi faollashtirishni to'sadi.
   */
  ('member.account_activation_enabled', 'false'),
  ('member.activation_ttl_hours', '48')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 6. HOLAT HISOBOTI
--
--    Migratsiya bir marta ishlaydi va o'sha paytdagi holatni
--    aytadi. Bu ommaviy faollashtirishdan OLDIN nima borligini
--    ko'rish uchun: taxmin qilib emas, sanab.
-- ------------------------------------------------------------
do $$
declare
  v_candidates integer;
  v_linked integer;
  v_unlinked integer;
  v_published integer;
  v_auth_users integer;
  v_profiles integer;
  v_telegram integer;
begin
  select count(*) into v_candidates from public.candidates where deleted_at is null;
  select count(*) into v_linked from public.candidates where deleted_at is null and user_id is not null;
  select count(*) into v_unlinked from public.candidates where deleted_at is null and user_id is null;
  select count(*) into v_published from public.candidates where deleted_at is null and status = 'published';
  select count(*) into v_auth_users from auth.users;
  select count(*) into v_profiles from public.profiles;
  select count(*) into v_telegram from public.member_telegram_links where unlinked_at is null;

  raise notice '=== PHASE 12 HOLAT HISOBOTI ===';
  raise notice 'Nomzodlar (jami):        %', v_candidates;
  raise notice '  nashr qilingan:        %', v_published;
  raise notice '  hisobga bog''langan:    %', v_linked;
  raise notice '  hisobsiz:              %', v_unlinked;
  raise notice 'auth.users:              %', v_auth_users;
  raise notice 'profiles:                %', v_profiles;
  raise notice 'Telegram bog''langan:     %', v_telegram;
end;
$$;
