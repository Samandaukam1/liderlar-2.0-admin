-- ============================================================
-- SPRINT (2026-10-04): VIP KUNLARI, CHALLENGE, REFERAL VIP, BADAL — JONLI TEKSHIRUV
--
-- Haqiqiy rollar bilan. Hammasi bitta tranzaksiyada, oxirida ROLLBACK.
-- Ishga tushirish: psql "$DATABASE_URL" -f supabase/tests/sprint_live.sql
-- ============================================================

begin;
set local client_min_messages to warning;

create temporary table sp_results (id serial, scenario text, expected text, actual text, passed boolean) on commit drop;
grant all on sp_results to public;
grant usage, select on sequence sp_results_id_seq to public;

create or replace function pg_temp.check_it(p_scenario text, p_expected text, p_actual text)
returns void language plpgsql as $$
begin
  insert into sp_results (scenario, expected, actual, passed)
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

-- ------------------------------------------------------------
-- SINOV MA'LUMOTI
--   ...21 A (taklifchi), ...22 B (boshqa a'zo)
--   nomzodlar: c1..c4 (A tavsiya qilgan; c4 chop etilmagan), c5 — A ning o'zi
-- ------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
  ('eeeeeeee-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-a@test.local', '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-b@test.local', '', now(), now());
insert into public.profiles (id, full_name, is_active) values
  ('eeeeeeee-0000-4000-8000-000000000021', 'SP A', true),
  ('eeeeeeee-0000-4000-8000-000000000022', 'SP B', true)
on conflict (id) do update set full_name = excluded.full_name;

insert into public.candidates (id, slug, full_name, status, user_id) values
  ('ffffffff-0000-4000-8000-000000000021', 'sp-c1', 'SP C1', 'published', null),
  ('ffffffff-0000-4000-8000-000000000022', 'sp-c2', 'SP C2', 'published', null),
  ('ffffffff-0000-4000-8000-000000000023', 'sp-c3', 'SP C3', 'published', null),
  ('ffffffff-0000-4000-8000-000000000024', 'sp-c4', 'SP C4', 'draft', null),
  ('ffffffff-0000-4000-8000-000000000025', 'sp-a-own', 'SP A o''zi', 'published', 'eeeeeeee-0000-4000-8000-000000000021'),
  ('ffffffff-0000-4000-8000-000000000026', 'sp-c6', 'SP C6', 'published', null),
  ('ffffffff-0000-4000-8000-000000000027', 'sp-b-own', 'SP B o''zi', 'published', 'eeeeeeee-0000-4000-8000-000000000022');

insert into public.referral_attributions (id, referrer_profile_id, candidate_id, stage) values
  ('abcdabcd-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000021', 'ffffffff-0000-4000-8000-000000000021', 'application'),
  ('abcdabcd-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000021', 'ffffffff-0000-4000-8000-000000000022', 'application'),
  ('abcdabcd-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000021', 'ffffffff-0000-4000-8000-000000000023', 'application'),
  ('abcdabcd-0000-4000-8000-000000000004', 'eeeeeeee-0000-4000-8000-000000000021', 'ffffffff-0000-4000-8000-000000000024', 'application'),
  ('abcdabcd-0000-4000-8000-000000000005', 'eeeeeeee-0000-4000-8000-000000000021', 'ffffffff-0000-4000-8000-000000000026', 'application');

insert into public.annual_fee_payments (candidate_id, cycle_start, cycle_end, amount_uzs) values
  ('ffffffff-0000-4000-8000-000000000027', '2027-07-26', '2028-07-26', 38000);

-- ============================================================
-- 1. REFERAL VIP: +10 kun, ko'pi bilan 30; nashr shart; takror yo'q
-- ============================================================
select pg_temp.check_it('referal: chop etilmagan nomzod — 0 kun', 'not_published',
  (select public.vip_grant_referral_reward('eeeeeeee-0000-4000-8000-000000000021', 'abcdabcd-0000-4000-8000-000000000004') ->> 'reason'));
select pg_temp.check_it('referal: 1-chop etilgan tavsiya — +10 kun beriladi', 'true',
  (select public.vip_grant_referral_reward('eeeeeeee-0000-4000-8000-000000000021', 'abcdabcd-0000-4000-8000-000000000001') ->> 'granted'));
select pg_temp.check_it('referal: o''sha tavsiya qayta — takror kun YO''Q', 'true',
  (select public.vip_grant_referral_reward('eeeeeeee-0000-4000-8000-000000000021', 'abcdabcd-0000-4000-8000-000000000001') ->> 'duplicate'));
select pg_temp.check_it('referal: 2- va 3-tavsiya — beriladi', 'true|true',
  (select (public.vip_grant_referral_reward('eeeeeeee-0000-4000-8000-000000000021', 'abcdabcd-0000-4000-8000-000000000002') ->> 'granted')
     || '|' || (public.vip_grant_referral_reward('eeeeeeee-0000-4000-8000-000000000021', 'abcdabcd-0000-4000-8000-000000000003') ->> 'granted')));
select pg_temp.check_it('referal: 4-tavsiya — cheklov (jami 30 kun)', 'capped',
  (select public.vip_grant_referral_reward('eeeeeeee-0000-4000-8000-000000000021', 'abcdabcd-0000-4000-8000-000000000005') ->> 'reason'));
select pg_temp.check_it('referal: jami 30 kun (10+10+10, 60 emas)', '30',
  (select sum(days)::text from public.vip_grants where profile_id = 'eeeeeeee-0000-4000-8000-000000000021' and source = 'referral'));
select pg_temp.check_it('referal: VIP faol va muddati ~30 kun', 'active|30',
  (select state || '|' || round(extract(epoch from current_period_end - now()) / 86400)::text
     from public.vip_subscriptions where profile_id = 'eeeeeeee-0000-4000-8000-000000000021' and state = 'active'));
select pg_temp.check_it('referal: boshqaning (berilmagan) atributsiyasi — egalik rad', 'no_candidate',
  (select public.vip_grant_referral_reward('eeeeeeee-0000-4000-8000-000000000022', 'abcdabcd-0000-4000-8000-000000000005') ->> 'reason'));
select pg_temp.check_it('referal: boshqaning atributsiyasi bilan B ga kun BERILMAYDI', '0',
  (select count(*)::text from public.vip_grants where profile_id = 'eeeeeeee-0000-4000-8000-000000000022'));

-- O'ziga o'zi: A o'z nomzodiga atributsiya.
insert into public.referral_attributions (id, referrer_profile_id, candidate_id, stage)
values ('abcdabcd-0000-4000-8000-000000000009', 'eeeeeeee-0000-4000-8000-000000000022', 'ffffffff-0000-4000-8000-000000000027', 'application');
select pg_temp.check_it('referal: o''ziga o''zi — 0 kun', 'self_referral',
  (select public.vip_grant_referral_reward('eeeeeeee-0000-4000-8000-000000000022', 'abcdabcd-0000-4000-8000-000000000009') ->> 'reason'));

-- ============================================================
-- 2. VIP XIZMATI: mavjud VIP UZAYTIRILADI, qisqartirilmaydi; takror yo'q
-- ============================================================
select pg_temp.check_it('VIP: faol obunaga +30 kun — muddatdan uzaytiriladi', 'true',
  (select ((g ->> 'period_end')::timestamptz - (g ->> 'period_end_before')::timestamptz = interval '30 days')::text
     from (select public.vip_grant_days('eeeeeeee-0000-4000-8000-000000000021', 30, 'daily_challenge', 'sp', 'sp-test-30', null, 'sinov') g) x));
select pg_temp.check_it('VIP: o''sha kalit qayta — duplicate', 'true',
  (select public.vip_grant_days('eeeeeeee-0000-4000-8000-000000000021', 30, 'daily_challenge', 'sp', 'sp-test-30', null, 'sinov') ->> 'duplicate'));
select pg_temp.check_it('VIP: noto''g''ri kun soni rad etiladi', 'XATO: 22023',
  pg_temp.attempt($q$ select public.vip_grant_days('eeeeeeee-0000-4000-8000-000000000021', 9999, 'admin', null, 'sp-bad', null, null) $q$));
select pg_temp.check_it('VIP: grant tarixi o''zgarmas (UPDATE rad)', 'XATO: P0001',
  pg_temp.attempt($q$ update public.vip_grants set days = 999 where profile_id = 'eeeeeeee-0000-4000-8000-000000000021' $q$));

-- ============================================================
-- 3. ROLLAR: anon / A / B
-- ============================================================
set local role anon;
select pg_temp.check_it('anon: VIP bera olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.vip_grant_days('eeeeeeee-0000-4000-8000-000000000021', 9, 'admin', null, 'x', null, null) $q$));
select pg_temp.check_it('anon: challenge yakunlay olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.finalize_daily_challenge(current_date - 1) $q$));
select pg_temp.check_it('anon: challenge natijalarini o''qiy olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select count(*) from public.daily_challenge_results $q$));
select pg_temp.check_it('anon: VIP tarixini o''qiy olmaydi (0 qator)', '0',
  (select count(*)::text from public.vip_grants));
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"eeeeeeee-0000-4000-8000-000000000021","role":"authenticated"}';
select pg_temp.check_it('A: o''z VIP tarixini ko''radi', 'true', (select (count(*) > 0)::text from public.vip_grants));
select pg_temp.check_it('A: B ning badal yozuvini ko''rmaydi', '0', (select count(*)::text from public.annual_fee_payments));
select pg_temp.check_it('A: o''ziga VIP kun yoza olmaydi (jadval)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.vip_grants (profile_id, subscription_id, days, source, idempotency_key) select 'eeeeeeee-0000-4000-8000-000000000021', id, 9999, 'admin', 'hack' from public.vip_subscriptions limit 1 $q$));
select pg_temp.check_it('A: referal mukofotini o''zi chaqira olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.vip_grant_referral_reward('eeeeeeee-0000-4000-8000-000000000021', 'abcdabcd-0000-4000-8000-000000000005') $q$));
select pg_temp.check_it('A: challenge natijasini o''zgartira olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.daily_challenges (challenge_date, starts_at, ends_at) values (current_date, now(), now() + interval '1 hour') $q$));
select pg_temp.check_it('A: o''z badalini to''langan deb yoza olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.annual_fee_payments (candidate_id, cycle_start, cycle_end) values ('ffffffff-0000-4000-8000-000000000025', current_date, current_date + 365) $q$));
select pg_temp.check_it('A: ko''rishni o''zi yoza olmaydi (jadval)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.profile_views (candidate_id, viewer_hash, is_counted) values ('ffffffff-0000-4000-8000-000000000025', repeat('a', 64), true) $q$));
select pg_temp.check_it('A: ko''rish RPC sini chaqira olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.record_profile_view('sp-a-own', repeat('b', 64), null, false, null) $q$));
select pg_temp.check_it('A: B nomzodini o''zgartira olmaydi', '0',
  (select count(*)::text from (select 1 from public.candidates where false) x)
  || (select case when pg_temp.attempt($q$ update public.candidates set full_name = 'X' where id = 'ffffffff-0000-4000-8000-000000000027' $q$) in ('BAJARILDI', 'RUXSAT YO''Q') then '' else 'X' end));
select pg_temp.check_it('A: B dizayn sozlamasini o''zgartira olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.candidate_theme_preferences (candidate_id, hide_site_header) values ('ffffffff-0000-4000-8000-000000000027', true) $q$));
select pg_temp.check_it('A: reytingni o''zgartira olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.recalculate_rankings() $q$));
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"eeeeeeee-0000-4000-8000-000000000022","role":"authenticated"}';
select pg_temp.check_it('B: A ning VIP tarixini ko''rmaydi', '0',
  (select count(*)::text from public.vip_grants where profile_id = 'eeeeeeee-0000-4000-8000-000000000021'));
select pg_temp.check_it('B: o''z badal yozuvini ko''radi', '1', (select count(*)::text from public.annual_fee_payments));
select pg_temp.check_it('B: A ning tavsiya ma''lumotini ko''rmaydi', '0',
  (select count(*)::text from public.referral_attributions where referrer_profile_id = 'eeeeeeee-0000-4000-8000-000000000021'));
reset role;

-- ============================================================
-- 4. CHALLENGE: yakunlangan natija o'zgarmas (hatto postgres uchun)
-- ============================================================
insert into public.daily_challenges (challenge_date, starts_at, ends_at, participants)
values (date '2020-01-01', now() - interval '2 days', now() - interval '1 day', 0);
select pg_temp.check_it('challenge: yakunlangan kun o''zgarmaydi', 'XATO: P0001',
  pg_temp.attempt($q$ update public.daily_challenges set participants = 99 where challenge_date = date '2020-01-01' $q$));
select pg_temp.check_it('challenge: qayta yakunlash — already', 'true',
  (select public.finalize_daily_challenge(date '2020-01-01') ->> 'already'));
select pg_temp.check_it('challenge: hali tugamagan kun yakunlanmaydi', 'XATO: 22023',
  pg_temp.attempt($q$ select public.finalize_daily_challenge(current_date + 1) $q$));

-- ============================================================
-- 5. OCHIQ SECURITY DEFINER FUNKSIYA QOLMADI
-- ============================================================
select pg_temp.check_it('anon/authenticated chaqira oladigan SECURITY DEFINER yo''q', '',
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and p.proname not in ('has_permission', 'is_admin', 'has_any_role', 'list_published_candidates_v2')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))));

-- NATIJA
reset role;
select lpad(id::text, 2) || '. ' || case when passed then '✅' else '❌' end || '  ' || scenario ||
       case when passed then '' else '   [kutilgan: ' || expected || ', natija: ' || coalesce(actual, 'null') || ']' end as natija
  from sp_results order by id;
select count(*) filter (where passed) || ' / ' || count(*) || ' o''tdi' as jami from sp_results;

rollback;
