-- ============================================================
-- PAROLNI TIKLASH + VIP ADMIN BOSHQARUVI: JONLI TEKSHIRUV
--
-- 20261003120000_account_recovery.sql va
-- 20261003121000_vip_admin_control.sql qo'llangandan keyin.
--
-- Haqiqiy rollar bilan (`set local role`): anon va a'zo nimaga
-- tega olmasligi, VIP berish va muddat tugashi bazada qanday
-- ishlashi. Hammasi bitta tranzaksiyada va oxirida ROLLBACK.
--
-- Ishga tushirish: psql "$DATABASE_URL" -f supabase/tests/recovery_vip_live.sql
-- ============================================================

begin;

set local client_min_messages to warning;

create temporary table rv_results (
  id serial,
  scenario text,
  expected text,
  actual text,
  passed boolean
) on commit drop;

grant all on rv_results to public;
grant usage, select on sequence rv_results_id_seq to public;

create or replace function pg_temp.check_it(p_scenario text, p_expected text, p_actual text)
returns void language plpgsql as $$
begin
  insert into rv_results (scenario, expected, actual, passed)
  values (p_scenario, p_expected, p_actual, p_expected is not distinct from p_actual);
end;
$$;

create or replace function pg_temp.attempt(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'BAJARILDI';
exception
  when insufficient_privilege then return 'RUXSAT YO''Q';
  when others then return 'XATO: ' || sqlstate;
end;
$$;

/* UPDATE nechta qatorga tegdi (RLS jim 0 qaytaradi). */
create or replace function pg_temp.affected(p_sql text) returns text language plpgsql as $$
declare
  v_count bigint;
begin
  execute 'with changed as (' || p_sql || ' returning 1) select count(*) from changed' into v_count;
  return v_count::text;
exception
  when insufficient_privilege then return 'RUXSAT YO''Q';
  when others then return 'XATO: ' || sqlstate;
end;
$$;

-- ------------------------------------------------------------
-- SINOV MA'LUMOTI
--   ...11 — a'zo (nomzod egasi)
--   ...12 — boshqa a'zo
-- ------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('eeeeeeee-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rv-member@test.local', '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rv-other@test.local', '', now(), now());

insert into public.profiles (id, full_name, is_active) values
  ('eeeeeeee-0000-4000-8000-000000000011', 'RV A''zo', true),
  ('eeeeeeee-0000-4000-8000-000000000012', 'RV Boshqa', true)
on conflict (id) do update set full_name = excluded.full_name;

insert into public.account_recoveries (profile_id, token_hash, expires_at)
values ('eeeeeeee-0000-4000-8000-000000000011', repeat('a', 64), now() + interval '24 hours');

-- ============================================================
-- 1. TIKLASH JADVALI — HECH KIMGA OCHIQ EMAS
-- ============================================================
set local role anon;
select pg_temp.check_it('anon: tiklash havolalarini o''qiy olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select count(*) from public.account_recoveries $q$));
select pg_temp.check_it('anon: tiklash havolasi yarata olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.account_recoveries (profile_id, token_hash, expires_at) values ('eeeeeeee-0000-4000-8000-000000000011', repeat('b', 64), now() + interval '1 hour') $q$));
select pg_temp.check_it('anon: sessiyalarni yopa olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.revoke_user_sessions('eeeeeeee-0000-4000-8000-000000000011') $q$));
select pg_temp.check_it('anon: VIP bera olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.vip_admin_grant('eeeeeeee-0000-4000-8000-000000000011', 'LIDERLAR_VIP', now(), now() + interval '30 days', 'x', null) $q$));
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"eeeeeeee-0000-4000-8000-000000000011","role":"authenticated"}';
select pg_temp.check_it('a''zo: O''Z tiklash havolasini ham o''qiy olmaydi (hash ham)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select token_hash from public.account_recoveries $q$));
select pg_temp.check_it('a''zo: havolani o''zi "ishlatilmagan" qila olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ update public.account_recoveries set consumed_at = null $q$));
select pg_temp.check_it('a''zo: boshqaning sessiyalarini yopa olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.revoke_user_sessions('eeeeeeee-0000-4000-8000-000000000012') $q$));
select pg_temp.check_it('a''zo: o''ziga VIP bera olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.vip_admin_grant('eeeeeeee-0000-4000-8000-000000000011', 'LIDERLAR_VIP', now(), now() + interval '3650 days', 'x', null) $q$));
select pg_temp.check_it('a''zo: o''z parolini/profilini to''g''ridan-to''g''ri o''zgartira olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ update public.profiles set is_active = true where id = 'eeeeeeee-0000-4000-8000-000000000011' $q$));
reset role;

-- ============================================================
-- 2. TIKLASH JADVALI CHEKLOVLARI
-- ============================================================
select pg_temp.check_it('bitta hisobga ikkinchi AMALDAGI havola qo''shilmaydi', 'XATO: 23505',
  pg_temp.attempt($q$ insert into public.account_recoveries (profile_id, token_hash, expires_at) values ('eeeeeeee-0000-4000-8000-000000000011', repeat('c', 64), now() + interval '1 hour') $q$));
select pg_temp.check_it('72 soatdan uzun havola bazada rad etiladi', 'XATO: 23514',
  pg_temp.attempt($q$ insert into public.account_recoveries (profile_id, token_hash, expires_at) values ('eeeeeeee-0000-4000-8000-000000000012', repeat('d', 64), now() + interval '73 hours') $q$));
select pg_temp.check_it('xom token (hash emas) saqlanmaydi', 'XATO: 23514',
  pg_temp.attempt($q$ insert into public.account_recoveries (profile_id, token_hash, expires_at) values ('eeeeeeee-0000-4000-8000-000000000012', 'ochiq-token-matni', now() + interval '1 hour') $q$));
select pg_temp.check_it('yangi xavfsizlik hodisasi turlari yoziladi', 'BAJARILDI',
  pg_temp.attempt($q$ insert into public.member_security_events (profile_id, event_type, actor) values ('eeeeeeee-0000-4000-8000-000000000011', 'password_reset_completed', 'member'), ('eeeeeeee-0000-4000-8000-000000000011', 'recovery_link_created', 'admin') $q$));
select pg_temp.check_it('eski hodisa turlari ham saqlangan', 'BAJARILDI',
  pg_temp.attempt($q$ insert into public.member_security_events (profile_id, event_type, actor) values ('eeeeeeee-0000-4000-8000-000000000011', 'activation_consumed', 'member') $q$));
select pg_temp.check_it('sessiyalarni yopish server (postgres) uchun ishlaydi', 'BAJARILDI',
  pg_temp.attempt($q$ select public.revoke_user_sessions('eeeeeeee-0000-4000-8000-000000000011') $q$));

-- ============================================================
-- 3. VIP BERISH (server yo'li) VA SANALAR
-- ============================================================
select pg_temp.check_it('tarifda imtiyoz davri yo''q (tugash sanasida yopiladi)', '0',
  (select grace_days::text from public.vip_plans where code = 'LIDERLAR_VIP'));
select pg_temp.check_it('kelajakdagi boshlanish rad etiladi', 'XATO: 22023',
  pg_temp.attempt($q$ select public.vip_admin_grant('eeeeeeee-0000-4000-8000-000000000011', 'LIDERLAR_VIP', now() + interval '2 days', now() + interval '30 days', 'x', null) $q$));
select pg_temp.check_it('o''tgan tugash sanasi rad etiladi', 'XATO: 22023',
  pg_temp.attempt($q$ select public.vip_admin_grant('eeeeeeee-0000-4000-8000-000000000011', 'LIDERLAR_VIP', now() - interval '40 days', now() - interval '10 days', 'x', null) $q$));
select pg_temp.check_it('VIP beriladi: darhol active, imtiyozsiz', 'active|true',
  (select v.state || '|' || (v.grace_until is null)::text
   from public.vip_admin_grant('eeeeeeee-0000-4000-8000-000000000011', 'LIDERLAR_VIP', now() - interval '1 day', now() + interval '30 days', 'Sinov', null) v));
select pg_temp.check_it('tarixda ikki yozuv: created + activated', '2',
  (select count(*)::text from public.vip_subscription_events e
   join public.vip_subscriptions s on s.id = e.subscription_id
   where s.profile_id = 'eeeeeeee-0000-4000-8000-000000000011'));
select pg_temp.check_it('ikkinchi marta berib bo''lmaydi (ochiq obuna bor)', 'XATO: 23505',
  pg_temp.attempt($q$ select public.vip_admin_grant('eeeeeeee-0000-4000-8000-000000000011', 'LIDERLAR_VIP', now(), now() + interval '30 days', 'x', null) $q$));

-- VIP ON -> huquq bor (sayt va bot shu ko'rinish bilan bir xil qoidani ishlatadi).
select pg_temp.check_it('VIP FAOL: huquqlar ochiq (profile.self_edit)', 'true',
  (select (count(*) > 0)::text from public.vip_active_entitlements
   where profile_id = 'eeeeeeee-0000-4000-8000-000000000011' and entitlement = 'profile.self_edit'));
select pg_temp.check_it('VIP FAOL: telegram.profile_edit ochiq', 'true',
  (select (count(*) > 0)::text from public.vip_active_entitlements
   where profile_id = 'eeeeeeee-0000-4000-8000-000000000011' and entitlement = 'telegram.profile_edit'));

-- MUDDAT TUGADI (fon vazifasi hali yurmagan, holat hamon 'active').
update public.vip_subscriptions
   set current_period_end = now() - interval '1 second', started_at = now() - interval '31 days'
 where profile_id = 'eeeeeeee-0000-4000-8000-000000000011';
select pg_temp.check_it('VIP TUGAGAN (holat hali active): huquq YOPIQ', '0',
  (select count(*)::text from public.vip_active_entitlements
   where profile_id = 'eeeeeeee-0000-4000-8000-000000000011'));

-- VIP O'CHIRILDI.
update public.vip_subscriptions
   set state = 'cancelled', current_period_end = now() + interval '30 days', cancelled_at = now()
 where profile_id = 'eeeeeeee-0000-4000-8000-000000000011';
select pg_temp.check_it('VIP O''CHIRILGAN (muddat hali bor): huquq YOPIQ', '0',
  (select count(*)::text from public.vip_active_entitlements
   where profile_id = 'eeeeeeee-0000-4000-8000-000000000011'));
select pg_temp.check_it('o''chirilgandan keyin qayta berish mumkin (yangi obuna)', 'active',
  (select v.state from public.vip_admin_grant('eeeeeeee-0000-4000-8000-000000000011', 'LIDERLAR_VIP', now(), now() + interval '90 days', 'Qayta', null) v));
select pg_temp.check_it('obuna tarixi saqlanadi (eski obuna o''chmaydi)', '2',
  (select count(*)::text from public.vip_subscriptions where profile_id = 'eeeeeeee-0000-4000-8000-000000000011'));

-- A'zo o'z obunasini o'zi uzaytira olmaydi.
set local role authenticated;
set local request.jwt.claims to '{"sub":"eeeeeeee-0000-4000-8000-000000000011","role":"authenticated"}';
select pg_temp.check_it('a''zo: obuna sanasini o''zi uzaytira olmaydi (0 qator yoki ruxsat yo''q)', 'true',
  (select (pg_temp.affected($q$ update public.vip_subscriptions set current_period_end = now() + interval '100 years' $q$)
           in ('0', 'RUXSAT YO''Q'))::text));
reset role;
select pg_temp.check_it('... va sana haqiqatan o''zgarmagan', 'true',
  (select (max(current_period_end) < now() + interval '1 year')::text
   from public.vip_subscriptions where profile_id = 'eeeeeeee-0000-4000-8000-000000000011'));

-- ============================================================
-- NATIJA
-- ============================================================
select
  lpad(id::text, 2) || '. ' || case when passed then '✅' else '❌' end || '  ' || scenario ||
  case when passed then '' else '   [kutilgan: ' || expected || ', natija: ' || coalesce(actual, 'null') || ']' end
  as natija
from rv_results order by id;

select count(*) filter (where passed) || ' / ' || count(*) || ' o''tdi' as jami from rv_results;

rollback;
