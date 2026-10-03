-- =========================================================================
-- LIDERLAR VIP — OBUNA VA HUQUQLAR YADROSI
--
-- MAQSAD: VIP butun tizim bo'ylab tarqalgan `is_vip` bayrog'i EMAS,
-- balki bitta joydan hal qilinadigan huquqlar qatlami bo'lsin.
--
-- NEGA bayroq yetarli emas: VIP vaqt bilan tugaydi, to'xtatiladi,
-- qayta tiklanadi va har bir imkoniyat alohida yoqib-o'chiriladi.
-- Bitta boolean bularning hech birini ayta olmaydi — natijada har
-- bir ekranda o'z tekshiruvi paydo bo'lardi va ular bir-biriga
-- qarama-qarshi tushardi.
--
-- ZANJIR: auth.users -> profiles -> vip_subscriptions -> vip_plans
--         -> vip_plan_entitlements -> huquq kaliti
--
-- MUHIM: bu migratsiya hech kimga VIP BERMAYDI. U faqat tuzilmani
-- yaratadi va barcha feature flaglarni O'CHIRIQ holatda seed qiladi
-- (§67 — bosqichma-bosqich chiqarish). Mavjud nomzodlar oddiy
-- holatda qoladi (§75).
--
-- FORWARD-ONLY. Hech qanday jadval o'chirilmaydi va mavjud
-- ma'lumotga tegilmaydi.
-- =========================================================================

/* ====================================================================== *
 * 1. TARIFLAR
 * ====================================================================== */

create table if not exists public.vip_plans (
  -- Matnli kalit, uuid emas: kod ichida 'LIDERLAR_VIP' deb yozilishi
  -- kerak va uuid'ni koddan izlab yurish mantiqsiz bo'lardi.
  code text primary key check (code = upper(code) and char_length(code) between 3 and 48),

  label text not null,
  description text,

  /*
   * MUDDAT KUNLARDA. `null` — muddatsiz tarif.
   *
   * Sana emas, davomiylik saqlanadi: obuna qachon boshlansa, tugash
   * sanasi shundan hisoblanadi. Tarifga qat'iy sana yozilsa, kech
   * qo'shilgan odam kam kun olardi.
   */
  duration_days integer check (duration_days is null or duration_days > 0),

  /*
   * NARX — TIYINDA EMAS, SO'MDA, lekin `bigint`.
   *
   * O'zbek so'mida million qiymatlar odatiy; `integer` 2.1 mlrd da
   * tugaydi va narx tarixini saqlashda tor kelishi mumkin.
   * `numeric` emas: so'mning kasri yo'q.
   */
  price_uzs bigint check (price_uzs is null or price_uzs >= 0),

  /*
   * IMTIYOZ MUDDATI — KUNDA.
   *
   * 0 bo'lishi mumkin: imtiyozsiz tarif. `null` emas, chunki
   * "imtiyoz necha kun" savolining javobi har tarifda bo'lishi
   * kerak va `null` ni koddagi har joyda 0 ga aylantirib yurish
   * xatoga olib keladi.
   *
   * TARIF DARAJASIDA, obunada emas: imtiyoz tijoriy qoida va u
   * har bir odam uchun alohida kelishilmasligi kerak.
   */
  grace_days integer not null default 0 check (grace_days >= 0),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_vip_plans_updated on public.vip_plans;
create trigger trg_vip_plans_updated
  before update on public.vip_plans
  for each row execute function public.set_updated_at();

comment on table public.vip_plans is
  'VIP tariflari. Obuna holati bu yerda emas, vip_subscriptions da.';

/* ====================================================================== *
 * 2. TARIF BERADIGAN HUQUQLAR
 *
 *    Huquqlar ro'yxat sifatida saqlanadi, bayroq ustunlari emas:
 *    yangi imkoniyat qo'shilganda jadval tuzilmasi o'zgarmasin.
 * ====================================================================== */

create table if not exists public.vip_plan_entitlements (
  plan_code text not null references public.vip_plans(code) on delete cascade,

  /*
   * HUQUQ KALITI — 'profile.self_edit' kabi nuqtali ierarxiya.
   *
   * Erkin matn ATAYLAB: `check (entitlement in (...))` bo'lsa, har
   * yangi imkoniyat migratsiya talab qilardi. Haqiqiy ro'yxat kodda
   * (`ENTITLEMENTS`) va u yerda tiplar bilan qo'riqlanadi.
   */
  entitlement text not null check (entitlement ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),

  primary key (plan_code, entitlement)
);

comment on table public.vip_plan_entitlements is
  'Tarif qanday huquqlar berishi. Huquq kaliti kodda ro''yxatlangan.';

/* ====================================================================== *
 * 3. OBUNALAR
 * ====================================================================== */

create table if not exists public.vip_subscriptions (
  id uuid primary key default gen_random_uuid(),

  /*
   * CASCADE EMAS, RESTRICT.
   *
   * §35: obuna tugashi ham, profil o'chirilishi ham foydalanuvchi
   * mazmunini yo'q qilmasligi kerak. Obuna tarixi — to'lov tarixi
   * hamdir; profil bilan birga o'chib ketsa, kim nima uchun to'laganini
   * keyin aytib bo'lmaydi.
   */
  profile_id uuid not null references public.profiles(id) on delete restrict,

  plan_code text not null references public.vip_plans(code) on delete restrict,

  /*
   * HOLATLAR (§3).
   *
   *   pending      — yaratilgan, hali faollashtirilmagan (to'lov kutilyapti)
   *   active       — amal qilyapti
   *   grace_period — muddat tugadi, lekin imtiyoz saqlanyapti
   *   expired      — tugadi
   *   cancelled    — foydalanuvchi/admin bekor qildi
   *   suspended    — admin to'xtatib qo'ydi
   *
   * `grace_period` ni ALOHIDA holat qilish sababi: u huquq BERADI,
   * lekin "to'lov kutilyapti" degan boshqa xabar ko'rsatadi. Agar u
   * `active` ning bir turi bo'lganida, foydalanuvchi muddati
   * tugaganini bilmay qolardi.
   */
  state text not null default 'pending' check (state in (
    'pending', 'active', 'grace_period', 'expired', 'cancelled', 'suspended'
  )),

  started_at timestamptz,

  /*
   * JORIY DAVR TUGASHI. `null` — muddatsiz.
   *
   * Muddat tugaganini FON VAZIFASI belgilaydi (§73), o'qish paytida
   * emas: holatni o'qiyotgan har bir so'rov uni o'zgartirsa, oddiy
   * sahifa ko'rish yozuv amaliga aylanardi. Shu sababli huquq
   * tekshiruvi holatga ham, SANAGA ham qaraydi — fon vazifasi
   * kechikkan bo'lsa ham muddati o'tgan obuna huquq bermaydi.
   */
  current_period_end timestamptz,

  -- Imtiyoz muddati qachon tugashi. `current_period_end` dan keyin.
  grace_until timestamptz,

  cancelled_at timestamptz,
  suspended_at timestamptz,

  notes text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * IMTIYOZ MUDDATI DAVR TUGASHIDAN OLDIN BO'LMASIN.
   *
   * Aks holda u huquqni UZAYTIRMASDAN, qisqartirib qo'yardi.
   */
  constraint vip_grace_after_period check (
    grace_until is null
    or current_period_end is null
    or grace_until >= current_period_end
  )
);

/*
 * BITTA PROFIL — BITTA TUGALLANMAGAN OBUNA.
 *
 * `expired` va `cancelled` — tugallangan holatlar va ular tarixda
 * necha bo'lsa ham bo'ladi. Qolganlari esa bir vaqtda bitta: ikki
 * faol obuna bo'lsa, "qaysi biri huquq beryapti va qachon tugaydi"
 * degan savolga javob yo'qolardi.
 */
create unique index if not exists uq_vip_subscription_open
  on public.vip_subscriptions (profile_id)
  where state in ('pending', 'active', 'grace_period', 'suspended');

-- Muddati o'tganlarni yig'uvchi fon vazifasining so'rovi.
create index if not exists idx_vip_subscriptions_expiry
  on public.vip_subscriptions (current_period_end)
  where state in ('active', 'grace_period');

create index if not exists idx_vip_subscriptions_profile
  on public.vip_subscriptions (profile_id, created_at desc);

drop trigger if exists trg_vip_subscriptions_updated on public.vip_subscriptions;
create trigger trg_vip_subscriptions_updated
  before update on public.vip_subscriptions
  for each row execute function public.set_updated_at();

/* ====================================================================== *
 * 4. OBUNA TARIXI — QO'SHIB BORILADI, O'ZGARTIRILMAYDI
 *
 *    §37: har bir imtiyozli o'zgarish uchun SABAB, KIM va QACHON
 *    saqlanadi. §56: audit.
 * ====================================================================== */

create table if not exists public.vip_subscription_events (
  id uuid primary key default gen_random_uuid(),

  subscription_id uuid not null
    references public.vip_subscriptions(id) on delete restrict,

  profile_id uuid not null references public.profiles(id) on delete restrict,

  event text not null check (event in (
    'created', 'activated', 'extended', 'grace_started',
    'expired', 'cancelled', 'suspended', 'restored', 'plan_changed'
  )),

  from_state text,
  to_state text,

  /*
   * SABAB MAJBURIY EMAS, LEKIN ADMIN AMALLARI UCHUN XIZMAT QATLAMI
   * UNI TALAB QILADI.
   *
   * Bazada majburiy qilinmagani: fon vazifasi avtomatik yozadigan
   * 'expired' uchun sabab "muddat tugadi" dan boshqa narsa emas va
   * uni har safar yozib yurish ma'nosiz.
   */
  reason text,

  -- Kim qildi. `null` — fon vazifasi (odam emas).
  actor_id uuid references auth.users(id) on delete set null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_vip_events_subscription
  on public.vip_subscription_events (subscription_id, created_at desc);

create index if not exists idx_vip_events_profile
  on public.vip_subscription_events (profile_id, created_at desc);

create or replace function public.vip_subscription_events_is_append_only()
returns trigger
language plpgsql
as $$
begin
  /*
   * §37: "Do not silently modify subscription history."
   *
   * Tuzatish — yangi hodisa yozish, eskisini o'zgartirish emas.
   * Bu ilova mantig'i emas, bazaning kafolati: xizmat qatlamidagi
   * xato ham tarixni o'zgartira olmaydi.
   */
  raise exception
    'vip_subscription_events faqat qo''shiladi: tarix o''zgartirilmaydi va o''chirilmaydi';
end;
$$;

drop trigger if exists vip_subscription_events_no_update on public.vip_subscription_events;
create trigger vip_subscription_events_no_update
  before update or delete on public.vip_subscription_events
  for each row execute function public.vip_subscription_events_is_append_only();

/* ====================================================================== *
 * 5. FEATURE FLAGLAR (§41)
 *
 *    Flag — server tomonda majburlanadigan to'siq. Faqat ko'rsatish
 *    uchun bayroq qo'shilmaydi: bajarilmaydigan flag yolg'on
 *    xavfsizlik hissi beradi.
 * ====================================================================== */

create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),

  is_enabled boolean not null default false,
  description text,

  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

drop trigger if exists trg_feature_flags_updated on public.feature_flags;
create trigger trg_feature_flags_updated
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

/* ====================================================================== *
 * 6. RLS
 *
 *    §43: VIP foydalanuvchi O'Z obunasini o'zgartira olmasligi va
 *    o'ziga huquq bera olmasligi kerak.
 *
 *    Shuning uchun bu jadvallarning HECH BIRIDA yozish siyosati YO'Q.
 *    Barcha yozish `service_role` orqali (server) ketadi. Siyosat
 *    yo'qligi — ruxsat yo'qligi: RLS yoqilgan jadvalda siyosatsiz
 *    amal rad etiladi.
 * ====================================================================== */

alter table public.vip_plans enable row level security;
alter table public.vip_plan_entitlements enable row level security;
alter table public.vip_subscriptions enable row level security;
alter table public.vip_subscription_events enable row level security;
alter table public.feature_flags enable row level security;

/* ---- Tariflar: faol tariflar hammaga ko'rinadi (narx sahifasi) ---- */

drop policy if exists vip_plans_public_select on public.vip_plans;
create policy vip_plans_public_select on public.vip_plans
  for select using (is_active);

drop policy if exists vip_plans_admin_select on public.vip_plans;
create policy vip_plans_admin_select on public.vip_plans
  for select using (public.has_permission('vip.manage'));

/*
 * Tarif huquqlari ham ommaviy: "VIP nima beradi" degan ro'yxat
 * marketing ma'lumoti va uni yashirishning sababi yo'q.
 */
drop policy if exists vip_plan_entitlements_public_select on public.vip_plan_entitlements;
create policy vip_plan_entitlements_public_select on public.vip_plan_entitlements
  for select using (true);

/* ---- Obuna: faqat o'zi va ruxsati bor admin ---- */

drop policy if exists vip_subscriptions_self_select on public.vip_subscriptions;
create policy vip_subscriptions_self_select on public.vip_subscriptions
  for select using (profile_id = auth.uid());

drop policy if exists vip_subscriptions_admin_select on public.vip_subscriptions;
create policy vip_subscriptions_admin_select on public.vip_subscriptions
  for select using (public.has_permission('vip.view'));

/*
 * HODISA TARIXI FOYDALANUVCHIGA KO'RSATILMAYDI.
 *
 * Unda admin sabablari va ichki izohlar bo'ladi ("to'lov tasdiqlanmadi",
 * "shubhali"). Foydalanuvchiga obunaning JORIY holati yetarli.
 */
drop policy if exists vip_subscription_events_admin_select on public.vip_subscription_events;
create policy vip_subscription_events_admin_select on public.vip_subscription_events
  for select using (public.has_permission('vip.view'));

/* ---- Flaglar ----
 *
 * O'qish anonim rolga ham ochiq: ommaviy sahifalar (masalan Liderlar
 * Online bo'limi menyuda ko'rinadimi) flagga qaraydi va ular imzosiz
 * so'rovlar. Flag nomi sir emas; haqiqiy to'siq server tomonda.
 */
drop policy if exists feature_flags_public_select on public.feature_flags;
create policy feature_flags_public_select on public.feature_flags
  for select using (true);

/* ====================================================================== *
 * 7. SEED — TARIF, HUQUQLAR VA FLAGLAR
 * ====================================================================== */

insert into public.vip_plans (code, label, description, duration_days, grace_days, price_uzs)
values (
  'LIDERLAR_VIP',
  'Liderlar VIP',
  'Profilni mustaqil tahrirlash, premium dizaynlar, maqola nashri va '
  'shaxsiy tavsiya kodi tahlili.',
  365,
  /*
   * 14 KUN IMTIYOZ.
   *
   * To'lov bir kun kechikkani uchun odam profilidan mahrum
   * bo'lmasligi kerak — ayniqsa profil ommaviy va unga havolalar
   * tashqaridan kelib turadi.
   */
  14,
  null  -- Narx hali belgilanmagan: 0 yozish "tekin" degan yolg'on bo'lardi.
)
on conflict (code) do nothing;

/*
 * HUQUQLAR RO'YXATI.
 *
 * Kodda `ENTITLEMENTS` bilan bir xil bo'lishi SHART. Noma'lum kalit
 * kodda `can()` ga berilsa, u xato qaytaradi — ya'ni nomuvofiqlik
 * jimgina "ruxsat yo'q" ga aylanmaydi.
 */
insert into public.vip_plan_entitlements (plan_code, entitlement)
values
  ('LIDERLAR_VIP', 'profile.self_edit'),
  ('LIDERLAR_VIP', 'profile.media_upload'),
  ('LIDERLAR_VIP', 'profile.certificate_manage'),
  ('LIDERLAR_VIP', 'profile.premium_themes'),
  ('LIDERLAR_VIP', 'referral.analytics'),
  ('LIDERLAR_VIP', 'telegram.profile_edit'),
  ('LIDERLAR_VIP', 'articles.create'),
  ('LIDERLAR_VIP', 'articles.submit'),
  ('LIDERLAR_VIP', 'magazine.subscription')
on conflict (plan_code, entitlement) do nothing;

/*
 * BARCHA FLAGLAR O'CHIRIQ (§67).
 *
 * `is_enabled` ning default qiymati ham `false` — ya'ni yangi flag
 * qo'shilganda u o'zidan yonib ketmaydi. Yoqish — ongli admin amali.
 *
 * `referral.personal_code` bu ro'yxatda YO'Q: shaxsiy tavsiya kodi
 * VIP imtiyozi emas, HAR BIR akkauntda bo'ladi (§75). VIP faqat
 * uning tahlilini (`referral.analytics`) va ariza oynasida
 * ko'rinishini beradi.
 */
insert into public.feature_flags (key, is_enabled, description)
values
  ('vip.enabled',                  false, 'VIP tizimi umuman ishlaydimi. O''chirilsa, barcha VIP huquqlari rad etiladi.'),
  ('vip.profile_editor_enabled',   false, 'VIP profilni o''zi tahrirlashi.'),
  ('vip.themes_enabled',           false, 'Premium profil dizaynlari.'),
  ('vip.referrals_enabled',        false, 'Tavsiya kodlari va atributsiya.'),
  ('vip.telegram_edit_enabled',    false, 'Telegram bot orqali profilni tahrirlash.'),
  ('vip.articles_enabled',         false, 'Maqola yozish va yuborish.'),
  ('vip.adabiyotx_sync_enabled',   false, 'Tasdiqlangan maqolani AdabiyotX ga uzatish.'),
  ('liderlar_online.enabled',      false, 'Ommaviy "Liderlar Online" bo''limi va menyu havolasi.'),
  ('vip.magazine_enabled',         false, 'Jurnal obunasi imtiyozi.')
on conflict (key) do nothing;

/* ====================================================================== *
 * 8. HUQUQNI HAL QILUVCHI KO'RINISH
 *
 *    Serverda bitta so'rov bilan "bu profil nimaga haqli" degan
 *    javobni berish uchun. §49: har bo'lim uchun alohida so'rov
 *    qilinmasin.
 * ====================================================================== */

create or replace view public.vip_active_entitlements
with (security_invoker = true)
as
select
  s.profile_id,
  s.id          as subscription_id,
  s.plan_code,
  s.state,
  s.current_period_end,
  s.grace_until,
  e.entitlement
from public.vip_subscriptions s
join public.vip_plan_entitlements e on e.plan_code = s.plan_code
where
  /*
   * HOLAT VA SANA — IKKOVI.
   *
   * Faqat holatga qarash fon vazifasiga ishonish bo'lardi: u
   * kechiksa, muddati o'tgan obuna huquq berib turardi. Faqat
   * sanaga qarash esa `suspended` ni o'tkazib yuborardi.
   */
  s.state in ('active', 'grace_period')
  and (
    s.current_period_end is null
    or now() <= coalesce(s.grace_until, s.current_period_end)
  );

comment on view public.vip_active_entitlements is
  'Hozir amal qilayotgan huquqlar. security_invoker: chaqiruvchining '
  'RLS huquqlari qo''llanadi, ya''ni foydalanuvchi faqat o''zinikini ko''radi.';

/* ====================================================================== *
 * 9. HOLAT O'ZGARISHINI YOZISH — BITTA TRANZAKSIYADA
 *
 *    NEGA RPC: obuna holati va audit yozuvi IKKOVI tushishi kerak.
 *    Ikki alohida so'rov bo'lsa, birinchisi o'tib ikkinchisi yiqilsa,
 *    imtiyozli o'zgarish AUDITSIZ qolardi — §37 aynan shuni taqiqlaydi.
 *
 *    QOIDALAR BU YERDA EMAS. Qaysi holatdan qaysi holatga o'tish
 *    mumkinligi va sanalar hisobi TypeScript'da (`subscription-rules.ts`)
 *    va u testlangan. Bu funksiya faqat SAQLAYDI: mantiqni ikki joyda
 *    takrorlash ularning bir-biridan ajralib ketishiga olib kelardi.
 * ====================================================================== */

create or replace function public.vip_apply_transition(
  p_subscription_id uuid,
  -- Chaqiruvchi KUTGAN joriy holat. Mos kelmasa, amal bajarilmaydi.
  p_expected_state text,
  p_new_state text,
  p_event text,
  p_started_at timestamptz,
  p_current_period_end timestamptz,
  p_grace_until timestamptz,
  p_reason text,
  p_actor_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns public.vip_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.vip_subscriptions;
  v_after  public.vip_subscriptions;
begin
  /*
   * QATORNI BAND QILAMIZ.
   *
   * Ikki admin bir vaqtda amal qilsa, ikkinchisi birinchisini
   * kutadi va keyin holatni QAYTA ko'radi — ya'ni quyidagi
   * tekshiruv uni to'xtatadi.
   */
  select * into v_before
  from public.vip_subscriptions
  where id = p_subscription_id
  for update;

  if not found then
    raise exception 'Obuna topilmadi: %', p_subscription_id
      using errcode = 'no_data_found';
  end if;

  /*
   * OPTIMISTIK TEKSHIRUV.
   *
   * Holat o'zgarib ketgan bo'lsa, amal rad etiladi. Aks holda
   * ikkinchi admin birinchisining qarorini bilmasdan bosib
   * ketardi — masalan to'xtatilgan obunani uzaytirib qo'yardi.
   */
  if v_before.state <> p_expected_state then
    raise exception
      'Obuna holati o''zgargan: kutilgani %, hozirgisi %',
      p_expected_state, v_before.state
      using errcode = 'serialization_failure';
  end if;

  update public.vip_subscriptions
  set
    state              = p_new_state,
    started_at         = p_started_at,
    current_period_end = p_current_period_end,
    grace_until        = p_grace_until,
    cancelled_at       = case when p_new_state = 'cancelled'
                              then coalesce(cancelled_at, now()) end,
    suspended_at       = case when p_new_state = 'suspended'
                              then coalesce(suspended_at, now()) end
  where id = p_subscription_id
  returning * into v_after;

  insert into public.vip_subscription_events (
    subscription_id, profile_id, event,
    from_state, to_state, reason, actor_id, metadata
  )
  values (
    p_subscription_id, v_after.profile_id, p_event,
    v_before.state, p_new_state, nullif(trim(coalesce(p_reason, '')), ''),
    p_actor_id, coalesce(p_metadata, '{}'::jsonb)
  );

  return v_after;
end;
$$;

/*
 * FAQAT SERVER CHAQIRADI.
 *
 * `security definer` funksiya RLS'ni chetlab o'tadi, ya'ni uni
 * `authenticated` rolga ochib qo'yish har bir foydalanuvchiga o'z
 * obunasini faollashtirish imkonini berardi — §43 aynan shuni
 * taqiqlaydi.
 */
revoke all on function public.vip_apply_transition(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz, text, uuid, jsonb
) from public, anon, authenticated;

comment on function public.vip_apply_transition is
  'Obuna holatini va audit yozuvini bitta tranzaksiyada saqlaydi. '
  'O''tish qoidalari TypeScript tomonda; bu faqat saqlash va poyga '
  'tekshiruvi. Faqat service_role.';

/* ====================================================================== *
 * 10. RUXSATLAR MATRITSASI
 *
 *    `src/lib/permissions.ts` BILAN BIR XIL BO'LISHI SHART.
 *
 *    Yuqoridagi RLS siyosatlari `public.has_permission('vip.view')` ga
 *    tayanadi va u shu jadvaldan o'qiydi. Ikkovi ajralib ketsa, panel
 *    ko'rsatgan narsani baza rad etardi — ya'ni admin tugmani bosadi,
 *    lekin hech nima bo'lmaydi.
 *
 *    `super_admin` bu yerda yo'q: u '*' orqali qamrab olingan.
 * ====================================================================== */

insert into public.role_permissions (role_slug, permission) values
  ('admin', 'vip.view'),
  ('admin', 'vip.manage'),

  -- Moderator va analitik KO'RADI, lekin obunani o'zgartirmaydi:
  -- obunani o'zgartirish pul bilan bog'liq amal.
  ('moderator', 'vip.view'),
  ('analyst',   'vip.view')
on conflict do nothing;
