-- ============================================================
-- JONLI RLS TEKSHIRUVI — HAQIQIY ROLLAR BILAN
--
-- Bu skript siyosat matnini emas, POSTGRES XULQINI tekshiradi:
-- `set local role` bilan haqiqiy anon/authenticated roliga
-- o'tib, nima ko'rinishini sanaydi.
--
-- Hammasi bitta tranzaksiyada va oxirida ROLLBACK — bazada
-- hech qanday sinov ma'lumoti qolmaydi.
-- ============================================================

begin;

set local client_min_messages to warning;

create temporary table rls_results (
  id serial,
  scenario text,
  expected text,
  actual text,
  passed boolean
) on commit drop;

/*
 * Natija jadvali rol almashganda ham yozilishi kerak, shuning
 * uchun huquq hammaga beriladi. Bu FAQAT vaqtinchalik jadval
 * va tranzaksiya oxirida yo'qoladi.
 */
grant all on rls_results to public;
grant usage, select on sequence rls_results_id_seq to public;

create or replace function pg_temp.check_it(
  p_scenario text, p_expected text, p_actual text
) returns void language plpgsql as $$
begin
  insert into rls_results (scenario, expected, actual, passed)
  values (p_scenario, p_expected, p_actual, p_expected = p_actual);
end;
$$;

-- ------------------------------------------------------------
-- SINOV MA'LUMOTI
-- ------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'org@test.local',  '', now(), now()),
  ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'part@test.local', '', now(), now()),
  ('aaaaaaaa-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@test.local','', now(), now());

/*
 * `auth.users` ga trigger ilingan va profilni O'ZI yaratadi.
 * Shuning uchun bu yerda faqat nom qo'yiladi — qayta insert
 * qilish unikal kalitni buzardi.
 */
insert into public.profiles (id, full_name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Tashkilotchi'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Ishtirokchi'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'Begona')
on conflict (id) do update set full_name = excluded.full_name;

-- Bitta QORALAMA, bitta TASDIQLANGAN tadbir.
insert into public.mehr_activities (id, organizer_profile_id, title, status, requires_location)
values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Qoralama tadbir', 'draft', false),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Tasdiqlangan tadbir', 'approved', false);

insert into public.mehr_participants (id, activity_id, profile_id, role, status)
values
  ('cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', 'participant', 'checked_in');

insert into public.mehr_activity_sessions (id, activity_id, signing_secret)
values ('dddddddd-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'MAXFIY-KALIT');

insert into public.point_ledger (profile_id, category, source_type, source_id, points, idempotency_key)
values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'ijtimoiy_tasir', 'mehr_activity', 'bbbbbbbb-0000-4000-8000-000000000002', 20, 'test:ledger:part'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'yetakchilik',    'mehr_activity', 'bbbbbbbb-0000-4000-8000-000000000002', 60, 'test:ledger:org');

insert into public.certificates (code, recipient_profile_id, kind, activity_id, role)
values ('MEHR-TEST000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'mehr_activity', 'bbbbbbbb-0000-4000-8000-000000000002', 'participant');

insert into public.referral_codes (profile_id, code) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'TESTREF1');

insert into public.member_link_tokens (profile_id, token_hash, expires_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', repeat('a', 64), now() + interval '10 minutes');

insert into public.member_accounts (profile_id) values ('aaaaaaaa-0000-4000-8000-000000000001');

-- ============================================================
-- 1. ANONIM FOYDALANUVCHI
-- ============================================================
set local role anon;

select pg_temp.check_it(
  'anon: faqat tasdiqlangan tadbirni ko''radi',
  '1', (select count(*)::text from public.mehr_activities));

select pg_temp.check_it(
  'anon: qoralama tadbirni KO''RMAYDI',
  '0', (select count(*)::text from public.mehr_activities where status = 'draft'));

select pg_temp.check_it(
  'anon: ishtirokchilar ro''yxatini ko''rmaydi',
  '0', (select count(*)::text from public.mehr_participants));

select pg_temp.check_it(
  'anon: check-in dalillarini ko''rmaydi',
  '0', (select count(*)::text from public.mehr_checkins));

select pg_temp.check_it(
  'anon: QR imzolash kalitini ko''rmaydi',
  '0', (select count(*)::text from public.mehr_activity_sessions));

select pg_temp.check_it(
  'anon: ball daftarini ko''rmaydi',
  '0', (select count(*)::text from public.point_ledger));

select pg_temp.check_it(
  'anon: referral kodlarini ko''rmaydi',
  '0', (select count(*)::text from public.referral_codes));

select pg_temp.check_it(
  'anon: bog''lash tokenlarini ko''rmaydi',
  '0', (select count(*)::text from public.member_link_tokens));

select pg_temp.check_it(
  'anon: a''zo akkauntlarini ko''rmaydi',
  '0', (select count(*)::text from public.member_accounts));

select pg_temp.check_it(
  'anon: sertifikatni tekshira oladi (ommaviy tekshiruv uchun)',
  '1', (select count(*)::text from public.certificates));

select pg_temp.check_it(
  'anon: ball qoidalarini ko''radi (shaffoflik)',
  'true', (select (count(*) > 0)::text from public.point_rules));

-- ============================================================
-- 2. TASHKILOTCHI
-- ============================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select pg_temp.check_it(
  'tashkilotchi: O''Z qoralamasini ko''radi',
  '1', (select count(*)::text from public.mehr_activities where status = 'draft'));

select pg_temp.check_it(
  'tashkilotchi: o''z tadbiri ishtirokchilarini ko''radi',
  '1', (select count(*)::text from public.mehr_participants));

select pg_temp.check_it(
  'tashkilotchi: O''Z ballini ko''radi',
  '1', (select count(*)::text from public.point_ledger where profile_id = 'aaaaaaaa-0000-4000-8000-000000000001'));

select pg_temp.check_it(
  'tashkilotchi: BOSHQANING ballini ko''rmaydi',
  '0', (select count(*)::text from public.point_ledger where profile_id = 'aaaaaaaa-0000-4000-8000-000000000002'));

select pg_temp.check_it(
  'tashkilotchi: QR imzolash kalitini KO''RMAYDI',
  '0', (select count(*)::text from public.mehr_activity_sessions));

select pg_temp.check_it(
  'tashkilotchi: o''z referral kodini ko''radi',
  '1', (select count(*)::text from public.referral_codes));

select pg_temp.check_it(
  'tashkilotchi: bog''lash tokenini KO''RMAYDI (o''ziniki bo''lsa ham)',
  '0', (select count(*)::text from public.member_link_tokens));

-- ============================================================
-- 3. ISHTIROKCHI
-- ============================================================
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}';

select pg_temp.check_it(
  'ishtirokchi: begona qoralamani ko''rmaydi',
  '0', (select count(*)::text from public.mehr_activities where status = 'draft'));

select pg_temp.check_it(
  'ishtirokchi: O''Z ishtirokini ko''radi',
  '1', (select count(*)::text from public.mehr_participants));

select pg_temp.check_it(
  'ishtirokchi: O''Z ballini ko''radi',
  '1', (select count(*)::text from public.point_ledger));

select pg_temp.check_it(
  'ishtirokchi: begona referral kodini ko''rmaydi',
  '0', (select count(*)::text from public.referral_codes));

-- ============================================================
-- 4. BEGONA A'ZO
-- ============================================================
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}';

select pg_temp.check_it(
  'begona: faqat tasdiqlangan tadbirni ko''radi',
  '1', (select count(*)::text from public.mehr_activities));

select pg_temp.check_it(
  'begona: begona ishtirokni ko''rmaydi',
  '0', (select count(*)::text from public.mehr_participants));

select pg_temp.check_it(
  'begona: begona ballni ko''rmaydi',
  '0', (select count(*)::text from public.point_ledger));

-- ============================================================
-- 5. YOZISHGA URINISH
-- ============================================================
do $$
declare v_err text;
begin
  begin
    insert into public.point_ledger (profile_id, category, source_type, points, idempotency_key)
    values ('aaaaaaaa-0000-4000-8000-000000000003', 'yutuqlar', 'adjustment', 9999, 'hack:self:award');
    v_err := 'YOZILDI';
  exception when others then
    v_err := 'RAD ETILDI';
  end;
  perform pg_temp.check_it('a''zo o''ziga ball yoza olmaydi', 'RAD ETILDI', v_err);
end;
$$;

do $$
declare v_err text;
begin
  begin
    update public.mehr_activities set status = 'approved'
    where id = 'bbbbbbbb-0000-4000-8000-000000000001';
    -- RLS update siyosati yo'q: 0 qator tegadi, xato bermaydi.
    v_err := case when found then 'O''ZGARDI' else 'TEGMADI' end;
  exception when others then
    v_err := 'RAD ETILDI';
  end;
  perform pg_temp.check_it('a''zo tadbirni o''zi tasdiqlay olmaydi', 'TEGMADI', v_err);
end;
$$;

-- ============================================================
-- 6. TASDIQLASH FUNKSIYASI — HTTP ORQALI OCHIQMI?
-- ============================================================
do $$
declare v_err text;
begin
  begin
    perform public.mehr_approve_activity('bbbbbbbb-0000-4000-8000-000000000001', null);
    v_err := 'BAJARILDI';
  exception
    when insufficient_privilege then v_err := 'RUXSAT YO''Q';
    when others then v_err := 'XATO: ' || sqlstate;
  end;
  perform pg_temp.check_it('authenticated tasdiqlash RPC ni CHAQIRA OLMAYDI', 'RUXSAT YO''Q', v_err);
end;
$$;

set local role anon;
do $$
declare v_err text;
begin
  begin
    perform public.mehr_approve_activity('bbbbbbbb-0000-4000-8000-000000000001', null);
    v_err := 'BAJARILDI';
  exception
    when insufficient_privilege then v_err := 'RUXSAT YO''Q';
    when others then v_err := 'XATO: ' || sqlstate;
  end;
  perform pg_temp.check_it('anon tasdiqlash RPC ni CHAQIRA OLMAYDI', 'RUXSAT YO''Q', v_err);
end;
$$;

do $$
declare v_err text;
begin
  begin
    perform public.recompute_point_aggregates(array['aaaaaaaa-0000-4000-8000-000000000001'::uuid]);
    v_err := 'BAJARILDI';
  exception
    when insufficient_privilege then v_err := 'RUXSAT YO''Q';
    when others then v_err := 'XATO: ' || sqlstate;
  end;
  perform pg_temp.check_it('anon jamlanma funksiyasini chaqira olmaydi', 'RUXSAT YO''Q', v_err);
end;
$$;

-- ============================================================
-- NATIJA
-- ============================================================
reset role;

select
  lpad(id::text, 2) || '. ' ||
  case when passed then '✅' else '❌' end || '  ' ||
  scenario ||
  case when passed then '' else '   [kutilgan: ' || expected || ', natija: ' || actual || ']' end
  as natija
from rls_results order by id;

select
  count(*) filter (where passed) || ' / ' || count(*) || ' o''tdi' as jami,
  count(*) filter (where not passed) as yiqildi
from rls_results;

rollback;
