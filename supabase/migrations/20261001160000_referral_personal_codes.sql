-- =========================================================================
-- SHAXSIY TAVSIYA KODLARI — FOLD TO'QNASHUVIDAN HIMOYA VA BALL QOIDALARI
--
-- `referral_codes`, `referral_attributions` va `referral_rewards`
-- jadvallari ALLAQACHON bor (20260920140000_mehr_points_certificates.sql).
-- Bu migratsiya ularni QAYTA YARATMAYDI — faqat uch narsani qo'shadi:
--
--   1. Fold to'qnashuvidan himoya qiluvchi unikal indeks.
--   2. Ball qoidalari (`point_rules`) — tavsiya uchun.
--   3. Atributsiya izlash indekslari.
--
-- FORWARD-ONLY.
-- =========================================================================

/* ====================================================================== *
 * 1. FOLD TO'QNASHUVI — ENG MUHIM QISM
 *
 *    MUAMMO: ariza formasidagi promo kod moslashtiruvchisi SAXIY. U
 *    0/O, 1/I/L, 5/S, 8/B, 2/Z, 6/G ni bitta belgi deb qaraydi.
 *
 *    Mavjud `code text not null unique` indeksi SATRLARNI solishtiradi,
 *    moslashtiruvchi esa SHAKLLARNI. Ya'ni "ASADBEK8X" va "ASADBEKBX"
 *    ikkisi ham bazaga tushishi mumkin, lekin forma ularni bitta kod
 *    deb qaraydi — natijada tavsiya BOSHQA ODAMGA yozilardi.
 *
 *    Yechim: fold shakli bo'yicha ham unikal indeks.
 * ====================================================================== */

create or replace function public.referral_fold_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  /*
   * TypeScript tomondagi `foldCode` bilan BIR XIL sinflar
   * (src/lib/referral/code.ts). Ikkovi ajralib ketsa, indeks
   * ilovaning tekshiruvidan boshqa javob berardi — test shuni
   * qo'riqlaydi.
   *
   * `immutable`: indeksda ishlatilishi uchun shart.
   */
  select translate(
    upper(regexp_replace(coalesce(p_code, ''), '[\s\-_.]+', '', 'g')),
    'OILSBZG',
    '0115826'
  );
$$;

comment on function public.referral_fold_code is
  'Kodni solishtirish shakliga keltiradi (chalkashadigan belgilar '
  'birlashtiriladi). Saqlash uchun emas — faqat to''qnashuv tekshiruvi.';

/*
 * FAOL KODLAR ORASIDA FOLD SHAKLI YAGONA.
 *
 * Faolsiz kod hisobga olinmaydi: egasi kodini o'zgartirgan bo'lsa,
 * eski shakl yangi odamga berilishi mumkin — tarixiy atributsiyalar
 * `referral_attributions.referrer_profile_id` ga bog'langan, kodga
 * emas, ya'ni ular buzilmaydi (§13).
 */
create unique index if not exists uq_referral_codes_folded
  on public.referral_codes (public.referral_fold_code(code))
  where is_active;

/* ====================================================================== *
 * 2. ATRIBUTSIYA IZLASH
 * ====================================================================== */

-- "Bu arizaga tavsiya biriktirilganmi" — ariza oqimi shu bo'yicha qaraydi.
create unique index if not exists uq_referral_attributions_application
  on public.referral_attributions (application_id)
  where application_id is not null;

-- "Bu nomzod allaqachon kimgadir biriktirilganmi" (§15: birinchi
-- atributsiya saqlanadi, osongina ustidan yozilmaydi).
create unique index if not exists uq_referral_attributions_referred
  on public.referral_attributions (referred_profile_id)
  where referred_profile_id is not null;

create index if not exists idx_referral_attributions_referrer_stage
  on public.referral_attributions (referrer_profile_id, stage);

/* ====================================================================== *
 * 3. BALL QOIDALARI
 *
 *    `point_rules` admin tomonidan o'zgartiriladi — qiymatlar bu yerda
 *    QOTIB QOLMAYDI. Seed faqat boshlang'ich holat.
 *
 *    KATEGORIYA `jamiyatga_hissa`: mavjud `point_rules` izohi tavsiyani
 *    aynan shu kategoriyaga yo'naltirgan va §18 tavsiya ballini alohida
 *    kategoriyada ushlab turishni talab qiladi.
 * ====================================================================== */

insert into public.point_rules (code, category, label, points, is_active, description)
values
  /*
   * BITTA TAVSIYA UCHUN 40 BALL.
   *
   * Mavjud shkalaga qarab tanlangan: MEHR'da hamkor tashkilotchi 40,
   * tashkilotchi 60 ball oladi. To'lov qilgan VA profili chop etilgan
   * nomzodni olib kelish — haqiqiy hissa, shuning uchun hamkor
   * tashkilotchi darajasida.
   *
   * MUHIM: ball FAQAT `payment_confirmed` bosqichida VA nomzodning
   * profili chop etilgan bo'lsa beriladi (egasining qarori). Ariza
   * topshirish, ro'yxatdan o'tish va tekin qabul ball BERMAYDI —
   * shuning uchun spec'dagi 'registered' va 'approved' qoidalari bu
   * yerda YO'Q.
   */
  ('referral.payment_confirmed', 'jamiyatga_hissa',
   'Tavsiya — to''lov qilgan va chop etilgan nomzod', 40, true,
   'Shaxsiy tavsiya kodi bilan kelgan nomzod to''lov qildi va profili chop etildi.'),

  /*
   * MILESTONE QIYMATLARI SPEC'DAN OLINGAN, LEKIN OGOHLANTIRISH BILAN.
   *
   * 100 tavsiya uchun 600 ball — MEHR tashkilotchisidan (60) o'n
   * baravar ko'p. §18 tavsiya ballining butun reytingni egallab
   * ketmasligini talab qiladi, ya'ni umumiy hissa CHEGARASI haqida
   * qaror kerak. Chegara BU MIGRATSIYADA YO'Q va jimgina ham
   * kiritilmagan: §18 "do not silently introduce a cap" deydi.
   *
   * Qiymatlar `point_rules` da turgani uchun admin ularni deploy'siz
   * o'zgartirishi mumkin.
   */
  ('referral.milestone_5',   'jamiyatga_hissa', 'Tavsiya — 5 ta',   30,  true, '5 ta tasdiqlangan tavsiya.'),
  ('referral.milestone_10',  'jamiyatga_hissa', 'Tavsiya — 10 ta',  70,  true, '10 ta tasdiqlangan tavsiya.'),
  ('referral.milestone_25',  'jamiyatga_hissa', 'Tavsiya — 25 ta',  150, true, '25 ta tasdiqlangan tavsiya.'),
  ('referral.milestone_50',  'jamiyatga_hissa', 'Tavsiya — 50 ta',  300, true, '50 ta tasdiqlangan tavsiya.'),
  ('referral.milestone_100', 'jamiyatga_hissa', 'Tavsiya — 100 ta', 600, true, '100 ta tasdiqlangan tavsiya.')
on conflict (code) do nothing;

/* ====================================================================== *
 * 4. KODNI EGASIGA YECHISH
 *
 *    Ariza formasi kiritilgan kodning egasini topishi kerak. Buni
 *    jadvalni ommaviy o'qishga ochib qilish MUMKIN EMAS: u
 *    `profile_id` -> kod jadvali va ochilsa, butun ro'yxatni sanab
 *    chiqish mumkin bo'lardi.
 *
 *    Shuning uchun bitta qiymat qaytaradigan funksiya: u ro'yxat
 *    bermaydi va faqat server chaqiradi.
 * ====================================================================== */

create or replace function public.resolve_referral_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  /*
   * FOLD BO'YICHA IZLAYDI, satr bo'yicha emas.
   *
   * Foydalanuvchi "ASADBEK0X" deb yozishi, kod esa "ASADBEKOX"
   * bo'lishi mumkin. Satr bo'yicha izlasak, kod topilmay qolardi va
   * tavsiya hech kimga yozilmasdi.
   *
   * `limit 1` xavfsiz: fold bo'yicha unikal indeks bitta faol kodni
   * kafolatlaydi.
   */
  select rc.profile_id
  from public.referral_codes rc
  where rc.is_active
    and public.referral_fold_code(rc.code) = public.referral_fold_code(p_code)
  limit 1;
$$;

revoke all on function public.resolve_referral_code(text) from public, anon, authenticated;

comment on function public.resolve_referral_code is
  'Kod egasining profil id sini qaytaradi. Bitta qiymat — ro''yxat '
  'bermaydi. Faqat service_role.';

/* ====================================================================== *
 * 5. VIP EGALARINING KODLARI — ARIZA FORMASIDA TAKLIF QILISH
 *
 *    Egasining talabi: arizada promo kod MAJBURIY va VIP obunachilarning
 *    kodlari ro'yxatda chiqib turadi.
 *
 *    KO'RINISH FAQAT ISM VA KODNI BERADI. `profile_id` chiqarilmaydi:
 *    u ichki identifikator va uni ommaviy ro'yxatga qo'shishning
 *    sababi yo'q (§76 — faqat ruxsat etilgan narsa ko'rsatiladi).
 * ====================================================================== */

create or replace view public.vip_referral_code_suggestions
with (security_invoker = false)
as
select
  p.full_name,
  rc.code
from public.referral_codes rc
join public.profiles p on p.id = rc.profile_id
join public.vip_subscriptions s on s.profile_id = rc.profile_id
where
  rc.is_active
  and p.is_active
  /*
   * HUQUQ BERAYOTGAN OBUNA — holat va sana bo'yicha.
   *
   * `vip_active_entitlements` ko'rinishiga tayanmaydi: u huquq
   * kalitlariga bog'langan va tarif huquqlari o'zgarsa, bu ro'yxat
   * kutilmaganda bo'shab qolardi.
   */
  and s.state in ('active', 'grace_period')
  and (
    s.current_period_end is null
    or now() <= coalesce(s.grace_until, s.current_period_end)
  );

comment on view public.vip_referral_code_suggestions is
  'Ariza formasida taklif qilinadigan VIP kodlari: faqat ism va kod. '
  'security_invoker = false — ko''rinish egasining huquqi bilan '
  'o''qiladi, ya''ni jadvallarni ommaviy ochish kerak emas.';

-- Ariza formasi imzosiz so'rov: ro'yxat anonim rolga ham kerak.
grant select on public.vip_referral_code_suggestions to anon, authenticated;
