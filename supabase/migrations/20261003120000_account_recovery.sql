-- =========================================================================
-- PAROLNI TIKLASH — ADMIN BERADIGAN BIR MARTALIK HAVOLA
--
-- MUAMMO: a'zolarning auth email'i ichki manzil
-- (`u-…@users.liderlar.uz`) — Supabase'ning email orqali tiklash xati
-- hech kimga yetib bormaydi. Admin panelidagi "Parolni tiklash" tugmasi
-- shu sababli amalda ishlamasdi.
--
-- YECHIM: faollashtirish (`candidate_activations`) bilan bir xil model.
--   · Admin havola yaratadi va uni panelda KO'RADI (email yo'q).
--   · Havolani Telegram orqali a'zoga yuboradi.
--   · A'zo yangi parolni O'ZI qo'yadi — admin uni ko'rmaydi.
--
-- TOKENNING O'ZI SAQLANMAYDI — faqat sha256 hash. Baza nusxasi sizib
-- chiqsa ham, undan ishlaydigan havola yasab bo'lmaydi. Parol degan
-- tushuncha bu jadvalda umuman yo'q: u to'g'ridan-to'g'ri Supabase
-- Auth'ga boradi.
--
-- FORWARD-ONLY. Mavjud jadval va ma'lumotga tegilmaydi (faqat
-- `member_security_events` hodisa turlari ro'yxati kengayadi).
-- =========================================================================

/* ====================================================================== *
 * 1. JADVAL
 * ====================================================================== */

create table if not exists public.account_recoveries (
  id uuid primary key default gen_random_uuid(),

  /*
   * KIMNING HISOBI. Hisob o'chirilsa, havola ham ketadi — u boshqa
   * hech narsaga ishora qilmaydi.
   */
  profile_id uuid not null references auth.users(id) on delete cascade,

  -- sha256(token), hex. Ochiq token faqat adminning ekranida va havolada.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  consumed_at timestamptz,

  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text,

  /*
   * MUDDAT CHEKLANGAN — bazada ham.
   *
   * Ilovadagi xato (masalan, sozlamaga "9999" yozilishi) amalda
   * abadiy kalit yaratmasin: 72 soatdan uzoq havola rad etiladi.
   */
  constraint account_recoveries_ttl check (
    expires_at > created_at and expires_at <= created_at + interval '72 hours'
  ),
  constraint account_recoveries_revoke_reason check (
    revoked_at is null
    or (revoke_reason is not null and char_length(btrim(revoke_reason)) > 0)
  )
);

/*
 * BITTA HISOB — BITTA AMALDAGI HAVOLA.
 *
 * Yangisini yaratish eskisini bekor qiladi (ilova tomonda), indeks esa
 * poygani to'sadi: eski havola xabarda qolib, keyin ishlatilmasin.
 */
create unique index if not exists account_recoveries_one_active_uidx
  on public.account_recoveries (profile_id)
  where consumed_at is null and revoked_at is null;

create index if not exists account_recoveries_profile_idx
  on public.account_recoveries (profile_id, created_at desc);

comment on table public.account_recoveries is
  'Admin bergan bir martalik parol tiklash havolalari. Faqat token hash '
  'saqlanadi. Faqat server (service_role) o''qiydi va yozadi.';

/*
 * RLS: SIYOSAT ATAYLAB YO'Q.
 *
 * Anon ham, authenticated ham (hatto admin ham PostgREST orqali) hech
 * narsa ko'rmaydi va yoza olmaydi. Tekshirish va ishlatish faqat
 * serverda. Jadval huquqi ham olinadi: siyosat tasodifan qo'shilsa
 * ham, rol huquqi to'sadi.
 */
alter table public.account_recoveries enable row level security;
revoke all on table public.account_recoveries from anon, authenticated;

/* ====================================================================== *
 * 2. XAVFSIZLIK HODISALARI
 *
 *    Mavjud ro'yxat O'ZGARMAYDI — faqat uchta yangi tur qo'shiladi.
 *    Ro'yxat 20260920180000_candidate_activations.sql dagi bilan
 *    aynan bir xil boshlanadi.
 * ====================================================================== */

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
    'activation_created',
    'activation_revoked',
    'activation_consumed',
    'activation_failed',
    'account_linked',
    'account_unlinked',
    'account_link_conflict',
    -- Parolni tiklash havolasi
    'recovery_link_created',
    'recovery_link_revoked',
    'password_reset_completed'
  ));

/* ====================================================================== *
 * 3. PAROL O'ZGARGACH ESKI SESSIYALARNI YOPISH
 *
 *    `auth.admin.updateUserById` parolni almashtiradi, lekin ochiq
 *    sessiyalarni YOPMAYDI. Hisob begona qo'lga o'tgani uchun tiklash
 *    so'ralgan bo'lsa, begona odam eski sessiya bilan ichkarida
 *    qolardi. Bu funksiya refresh tokenlarni o'chiradi: amaldagi
 *    access token o'z muddati (≈1 soat) tugaguncha ishlaydi, keyin
 *    yangilanmaydi.
 * ====================================================================== */

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;

  -- Sessiyasiz (eski formatdagi) refresh tokenlar ham.
  delete from auth.refresh_tokens where user_id = p_user_id::text;

  return v_count;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

comment on function public.revoke_user_sessions(uuid) is
  'Foydalanuvchining barcha sessiyalarini yopadi (parol tiklangandan '
  'keyin). Faqat service_role.';
