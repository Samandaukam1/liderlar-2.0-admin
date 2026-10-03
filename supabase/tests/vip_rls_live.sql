-- ============================================================
-- VIP: JONLI RLS VA HUQUQ TEKSHIRUVI — HAQIQIY ROLLAR BILAN
--
-- Siyosat matni emas, POSTGRES XULQI tekshiriladi: `set local role`
-- bilan anon / a'zo / xodim roliga o'tib, nima ko'rinishi va nima
-- chaqirilishi sanaladi.
--
-- Qamrov:
--   · SECURITY DEFINER funksiyalar faqat service_role uchun
--     (20261003101000_lock_down_definer_functions.sql);
--   · a'zo o'z profilini to'g'ridan-to'g'ri o'zgartira olmaydi
--     (20261003102000_profiles_no_direct_update.sql);
--   · VIP jadvallari: a'zo faqat o'zinikini ko'radi, hech narsa yoza
--     olmaydi;
--   · sertifikat dalili: yopiq bucket, umumiy admin siyosatlari uni
--     qamramaydi (20261002233000_certificate_evidence.sql);
--   · PT409: poyga holati qayta urinilmaydigan kod bilan qaytadi
--     (20261002230000_rpc_conflict_codes.sql).
--
-- Hammasi bitta tranzaksiyada va oxirida ROLLBACK — bazada sinov
-- ma'lumoti qolmaydi. Ishga tushirish: Supabase SQL Editor yoki
--   psql "$DATABASE_URL" -f supabase/tests/vip_rls_live.sql
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

grant all on rls_results to public;
grant usage, select on sequence rls_results_id_seq to public;

create or replace function pg_temp.check_it(
  p_scenario text, p_expected text, p_actual text
) returns void language plpgsql as $$
begin
  insert into rls_results (scenario, expected, actual, passed)
  values (p_scenario, p_expected, p_actual, p_expected is not distinct from p_actual);
end;
$$;

/* So'rovni joriy rol bilan bajaradi: natija yoki xato turi. */
create or replace function pg_temp.attempt(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'BAJARILDI';
exception
  when insufficient_privilege then return 'RUXSAT YO''Q';
  when others then return 'XATO: ' || sqlstate;
end;
$$;

/* UPDATE/DELETE nechta qatorga tegdi (RLS jim 0 qaytaradi). */
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
--   ...01 — VIP a'zo (nomzod egasi)
--   ...02 — boshqa a'zo (VIP emas)
--   ...03 — admin (candidates.edit, media.view, audit.view, vip.view)
--   ...04 — viewer (media.view, lekin candidates.edit YO'Q)
--   ...05 — BOSHQA VIP a'zo (o'z nomzodi va o'z obunasi bilan)
-- ------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('eeeeeeee-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vip@test.local',    '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@test.local', '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local',  '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.local', '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vip2@test.local',   '', now(), now());

insert into public.profiles (id, full_name, is_active) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'VIP A''zo', true),
  ('eeeeeeee-0000-4000-8000-000000000002', 'Oddiy A''zo', true),
  ('eeeeeeee-0000-4000-8000-000000000003', 'Admin Xodim', true),
  ('eeeeeeee-0000-4000-8000-000000000004', 'Kuzatuvchi', true),
  ('eeeeeeee-0000-4000-8000-000000000005', 'Boshqa VIP', true)
on conflict (id) do update set full_name = excluded.full_name, is_active = true;

insert into public.user_roles (user_id, role_id)
select 'eeeeeeee-0000-4000-8000-000000000003', id from public.roles where slug = 'admin';
insert into public.user_roles (user_id, role_id)
select 'eeeeeeee-0000-4000-8000-000000000004', id from public.roles where slug = 'viewer';

insert into public.candidates (id, slug, full_name, status, user_id)
values
  ('ffffffff-0000-4000-8000-000000000001', 'vip-rls-test-nomzod', 'VIP Sinov Nomzod', 'published', 'eeeeeeee-0000-4000-8000-000000000001'),
  ('ffffffff-0000-4000-8000-000000000002', 'oddiy-rls-test-nomzod', 'Oddiy Sinov Nomzod', 'published', 'eeeeeeee-0000-4000-8000-000000000002'),
  ('ffffffff-0000-4000-8000-000000000003', 'vip2-rls-test-nomzod', 'Boshqa VIP Nomzod', 'published', 'eeeeeeee-0000-4000-8000-000000000005');

insert into public.member_articles (id, candidate_id, title)
values ('adadadad-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'Sinov maqola (qoralama)');

insert into public.candidate_certificates (id, candidate_id, title, trust)
values ('abababab-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'Sinov sertifikati', 'pending_review');

insert into public.certificate_evidence (certificate_id, candidate_id, path, mime_type, size_bytes, uploaded_by)
values (
  'abababab-0000-4000-8000-000000000001',
  'ffffffff-0000-4000-8000-000000000001',
  'candidates/ffffffff-0000-4000-8000-000000000001/abababab-0000-4000-8000-000000000001/cdcdcdcd-0000-4000-8000-000000000001.pdf',
  'application/pdf',
  1024,
  'eeeeeeee-0000-4000-8000-000000000001'
);

insert into storage.objects (bucket_id, name) values
  ('certificate-evidence', 'candidates/ffffffff-0000-4000-8000-000000000001/abababab-0000-4000-8000-000000000001/cdcdcdcd-0000-4000-8000-000000000001.pdf'),
  ('candidate-gallery', 'vip-rls-test/rasm.jpg');

insert into public.candidate_profile_edits (id, candidate_id, profile_id, field, before_value, after_value)
values
  ('acacacac-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'birth_date', null, '1990-01-01'),
  ('acacacac-0000-4000-8000-000000000002', 'ffffffff-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000002', 'birth_date', null, '1991-02-02');

insert into public.referral_codes (profile_id, code) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'VIPRLSTEST1'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'ODDIYRLSTEST2');

insert into public.audit_logs (actor_id, action, entity_type, entity_id)
values ('eeeeeeee-0000-4000-8000-000000000003', 'vip.subscription.activated', 'vip_subscription', 'test');

-- VIP obuna: yaratish va faollashtirish — server yo'li (RPC) bilan.
select public.vip_create_subscription('eeeeeeee-0000-4000-8000-000000000001', 'LIDERLAR_VIP', 'eeeeeeee-0000-4000-8000-000000000003');
select public.vip_apply_transition(
  (select id from public.vip_subscriptions where profile_id = 'eeeeeeee-0000-4000-8000-000000000001'),
  'pending', 'active', 'activated', now(), now() + interval '365 days', now() + interval '379 days',
  'Sinov', 'eeeeeeee-0000-4000-8000-000000000003', '{}'::jsonb, null
);
select public.vip_create_subscription('eeeeeeee-0000-4000-8000-000000000005', 'LIDERLAR_VIP', 'eeeeeeee-0000-4000-8000-000000000003');
select public.vip_apply_transition(
  (select id from public.vip_subscriptions where profile_id = 'eeeeeeee-0000-4000-8000-000000000005'),
  'pending', 'active', 'activated', now(), now() + interval '365 days', now() + interval '379 days',
  'Sinov', 'eeeeeeee-0000-4000-8000-000000000003', '{}'::jsonb, null
);

-- ============================================================
-- 1. ANONIM
-- ============================================================
set local role anon;

select pg_temp.check_it('anon: grant_role_by_email ni chaqira olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.grant_role_by_email('vip@test.local', 'super_admin') $q$));
select pg_temp.check_it('anon: audit jurnaliga soxta yozuv yoza olmaydi (write_audit_log)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.write_audit_log(null, 'soxta', 'candidate') $q$));
select pg_temp.check_it('anon: ko''rishni to''g''ridan-to''g''ri yoza olmaydi (record_profile_view)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.record_profile_view('vip-rls-test-nomzod', repeat('a', 64), null, true) $q$));
select pg_temp.check_it('anon: reytingni qayta hisoblata olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.recalculate_rankings() $q$));
select pg_temp.check_it('anon: login bo''yicha emailni ola olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.auth_email_for_username('vip') $q$));
select pg_temp.check_it('anon: VIP obuna yarata olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.vip_create_subscription('eeeeeeee-0000-4000-8000-000000000002', 'LIDERLAR_VIP', null) $q$));
select pg_temp.check_it('anon: oylik tokenni tekshira olmaydi (faqat server)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.verify_update_token(repeat('0', 64)) $q$));

select pg_temp.check_it('anon: RLS yordamchisi ochiq qoladi (has_permission -> false)', 'false',
  (select public.has_permission('vip.view')::text));
select pg_temp.check_it('anon: ommaviy nomzodlar ro''yxati ishlaydi', 'true',
  (select (count(*) >= 2)::text from public.list_published_candidates_v2(null, null, null, null, null, 48, 0)));

select pg_temp.check_it('anon: audit jurnalini ko''rmaydi', '0', (select count(*)::text from public.audit_logs));
select pg_temp.check_it('anon: VIP obunalarni ko''rmaydi', '0', (select count(*)::text from public.vip_subscriptions));
select pg_temp.check_it('anon: sertifikat dalili jadvalini ko''rmaydi', '0', (select count(*)::text from public.certificate_evidence));
select pg_temp.check_it('anon: dalil faylini storage''dan ko''rmaydi', '0',
  (select count(*)::text from storage.objects where bucket_id = 'certificate-evidence'));
select pg_temp.check_it('anon: VIP kodlari ro''yxatida faqat faol VIP', 'VIPRLSTEST1',
  (select string_agg(code, ',') from public.vip_referral_code_suggestions where code like '%RLSTEST%'));

reset role;

-- ============================================================
-- 2. VIP A'ZO (o'z nomzodi, o'z obunasi)
-- ============================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"eeeeeeee-0000-4000-8000-000000000001","role":"authenticated"}';

select pg_temp.check_it('a''zo: o''ziga super_admin bera olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.grant_role_by_email('vip@test.local', 'super_admin') $q$));
select pg_temp.check_it('a''zo: anketani nomzodga aylantira/nashr qila olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.promote_candidate_intake(gen_random_uuid(), null, true, null, null) $q$));
select pg_temp.check_it('a''zo: audit jurnaliga yoza olmaydi (RPC)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.write_audit_log(null, 'soxta', 'candidate') $q$));
select pg_temp.check_it('a''zo: audit jurnaliga yoza olmaydi (jadval)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.audit_logs (action, entity_type) values ('soxta', 'candidate') $q$));
select pg_temp.check_it('a''zo: obuna o''tishini o''zi qila olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.vip_apply_transition(gen_random_uuid(), 'active', 'active', 'extended', now(), now(), now(), null, null, '{}'::jsonb, null) $q$));
select pg_temp.check_it('a''zo: dalilni o''zi biriktira olmaydi (RPC)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.attach_certificate_evidence(gen_random_uuid(), gen_random_uuid(), null, 'x', 'application/pdf', 1) $q$));

select pg_temp.check_it('a''zo: o''z profilini o''qiydi', '1',
  (select count(*)::text from public.profiles where id = 'eeeeeeee-0000-4000-8000-000000000001'));
select pg_temp.check_it('a''zo: boshqalarning profilini ko''rmaydi', '1', (select count(*)::text from public.profiles));
select pg_temp.check_it('a''zo: o''zini faollashtira/bloklay olmaydi (is_active)', 'RUXSAT YO''Q',
  pg_temp.affected($q$ update public.profiles set is_active = false where id = 'eeeeeeee-0000-4000-8000-000000000001' $q$));
select pg_temp.check_it('a''zo: band qilingan loginni chetlab o''rnata olmaydi', 'RUXSAT YO''Q',
  pg_temp.affected($q$ update public.profiles set username = 'admin' where id = 'eeeeeeee-0000-4000-8000-000000000001' $q$));
select pg_temp.check_it('a''zo: ommaviy ismini to''g''ridan-to''g''ri o''zgartira olmaydi', 'RUXSAT YO''Q',
  pg_temp.affected($q$ update public.profiles set full_name = 'Liderlar.uz ma''muriyati' where id = 'eeeeeeee-0000-4000-8000-000000000001' $q$));

select pg_temp.check_it('VIP: faqat o''z obunasini ko''radi (boshqa VIP nikini emas)', '1', (select count(*)::text from public.vip_subscriptions));
select pg_temp.check_it('a''zo: obuna tarixini (admin jurnali) ko''rmaydi', '0',
  (select count(*)::text from public.vip_subscription_events));
select pg_temp.check_it('a''zo: obunani to''g''ridan-to''g''ri uzaytira olmaydi', '0',
  pg_temp.affected($q$ update public.vip_subscriptions set current_period_end = now() + interval '100 years' $q$));
select pg_temp.check_it('a''zo: o''ziga obuna qo''sha olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.vip_subscriptions (profile_id, plan_code, state) values ('eeeeeeee-0000-4000-8000-000000000001', 'LIDERLAR_VIP', 'active') $q$));

select pg_temp.check_it('a''zo: audit jurnalini ko''rmaydi', '0', (select count(*)::text from public.audit_logs));
select pg_temp.check_it('a''zo: o''z dalilining yo''lini ham ko''rmaydi (faqat server havolasi)', '0',
  (select count(*)::text from public.certificate_evidence));
select pg_temp.check_it('a''zo: dalil faylini storage''dan o''qiy olmaydi', '0',
  (select count(*)::text from storage.objects where bucket_id = 'certificate-evidence'));
select pg_temp.check_it('a''zo: sertifikatiga o''zi "tasdiqlangan" qo''ya olmaydi', '0',
  pg_temp.affected($q$ update public.candidate_certificates set trust = 'verified' $q$));
select pg_temp.check_it('a''zo: nomzodini o''zi nashrdan ola/o''zgartira olmaydi', '0',
  pg_temp.affected($q$ update public.candidates set status = 'draft' where id = 'ffffffff-0000-4000-8000-000000000001' $q$));

select pg_temp.check_it('a''zo: faqat o''z tahrirlarini ko''radi', '1',
  (select count(*)::text from public.candidate_profile_edits));
select pg_temp.check_it('a''zo: ko''rik navbatini chetlab tahrir qo''sha olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.candidate_profile_edits (candidate_id, profile_id, field, after_value, state) values ('ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'birth_date', '2000-01-01', 'applied') $q$));
select pg_temp.check_it('a''zo: faqat o''z tavsiya kodini ko''radi', 'VIPRLSTEST1',
  (select string_agg(code, ',') from public.referral_codes where code like '%RLSTEST%'));

-- BOSHQA VIP VA YOZISH YO'LLARI (§43, §60–65)
select pg_temp.check_it('VIP: boshqa VIP nomzodini o''zgartira olmaydi', '0',
  pg_temp.affected($q$ update public.candidates set full_name = 'Buzildi' where id = 'ffffffff-0000-4000-8000-000000000003' $q$));
select pg_temp.check_it('VIP: boshqa VIP obunasini o''zgartira olmaydi', '0',
  pg_temp.affected($q$ update public.vip_subscriptions set state = 'cancelled' where profile_id = 'eeeeeeee-0000-4000-8000-000000000005' $q$));
select pg_temp.check_it('VIP: boshqa nomzod papkasiga rasm yuklay olmaydi (storage)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into storage.objects (bucket_id, name) values ('candidate-gallery', 'candidates/ffffffff-0000-4000-8000-000000000003/x.jpg') $q$));
select pg_temp.check_it('VIP: o''z papkasiga ham storage''ga to''g''ridan-to''g''ri yozmaydi (faqat server imzosi)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into storage.objects (bucket_id, name) values ('candidate-avatars', 'candidates/ffffffff-0000-4000-8000-000000000001/x.jpg') $q$));
select pg_temp.check_it('VIP: ball yoza olmaydi (point_ledger)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.point_ledger (profile_id, category, source_type, points, idempotency_key) values ('eeeeeeee-0000-4000-8000-000000000001', 'jamiyatga_hissa', 'referral', 1000, 'rls-test:hack') $q$));
select pg_temp.check_it('VIP: tavsiya mukofotini o''zi yoza olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.referral_rewards (referrer_profile_id, stage, points) values ('eeeeeeee-0000-4000-8000-000000000001', 'payment_confirmed', 100) $q$));
select pg_temp.check_it('VIP: platforma sertifikatini o''ziga bera olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.certificates (code, recipient_profile_id) values ('RLS-HACK-0001', 'eeeeeeee-0000-4000-8000-000000000001') $q$));
select pg_temp.check_it('VIP: o''z maqolasini ko''radi', '1', (select count(*)::text from public.member_articles where title like 'Sinov maqola%'));
select pg_temp.check_it('VIP: o''z maqolasini o''zi nashr qila olmaydi', '0',
  pg_temp.affected($q$ update public.member_articles set state = 'published' $q$));
select pg_temp.check_it('VIP: dizayn tanlovini to''g''ridan-to''g''ri yoza olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into public.candidate_theme_preferences (candidate_id) values ('ffffffff-0000-4000-8000-000000000001') $q$));

reset role;

-- ============================================================
-- 3. KUZATUVCHI (media.view bor, candidates.edit yo'q)
-- ============================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"eeeeeeee-0000-4000-8000-000000000004","role":"authenticated"}';

select pg_temp.check_it('kuzatuvchi: umumiy bucketdagi faylni ko''radi (siyosat buzilmagan)', '1',
  (select count(*)::text from storage.objects where bucket_id = 'candidate-gallery' and name = 'vip-rls-test/rasm.jpg'));
select pg_temp.check_it('kuzatuvchi: dalil faylini ko''rmaydi (media.view yetmaydi)', '0',
  (select count(*)::text from storage.objects where bucket_id = 'certificate-evidence'));
select pg_temp.check_it('kuzatuvchi: dalil jadvalini ko''rmaydi', '0',
  (select count(*)::text from public.certificate_evidence));
select pg_temp.check_it('kuzatuvchi: dalil bucketiga fayl yuklay olmaydi', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ insert into storage.objects (bucket_id, name) values ('certificate-evidence', 'candidates/x/y/z.pdf') $q$));

reset role;

-- ============================================================
-- 4. ADMIN
-- ============================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"eeeeeeee-0000-4000-8000-000000000003","role":"authenticated"}';

select pg_temp.check_it('admin: dalil yozuvini ko''radi (candidates.edit)', '1',
  (select count(*)::text from public.certificate_evidence));
select pg_temp.check_it('admin: dalil faylini storage''dan TO''G''RIDAN-TO''G''RI o''qiy olmaydi', '0',
  (select count(*)::text from storage.objects where bucket_id = 'certificate-evidence'));
select pg_temp.check_it('admin: audit jurnalini ko''radi', 'true',
  (select (count(*) >= 1)::text from public.audit_logs));
select pg_temp.check_it('admin: barcha obunalarni ko''radi', 'true',
  (select (count(*) >= 1)::text from public.vip_subscriptions));
select pg_temp.check_it('admin: grant_role_by_email ni ham chaqira olmaydi (faqat server)', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.grant_role_by_email('member@test.local', 'admin') $q$));
select pg_temp.check_it('admin: obuna o''tishi faqat server orqali', 'RUXSAT YO''Q',
  pg_temp.attempt($q$ select public.vip_apply_transition(gen_random_uuid(), 'active', 'active', 'extended', now(), now(), now(), null, null, '{}'::jsonb, null) $q$));

reset role;

-- ============================================================
-- 5. POYGA HOLATI — PT409 (qayta urinilmaydigan kod)
-- ============================================================
select pg_temp.check_it('obuna: kutilgan holat mos kelmasa PT409', 'XATO: PT409',
  pg_temp.attempt($q$
    select public.vip_apply_transition(
      (select id from public.vip_subscriptions where profile_id = 'eeeeeeee-0000-4000-8000-000000000001'),
      'pending', 'active', 'activated', now(), now(), now(), null, null, '{}'::jsonb, null)
  $q$));
select pg_temp.check_it('obuna: eskirgan versiya (updated_at) bilan PT409', 'XATO: PT409',
  pg_temp.attempt($q$
    select public.vip_apply_transition(
      (select id from public.vip_subscriptions where profile_id = 'eeeeeeee-0000-4000-8000-000000000001'),
      'active', 'suspended', 'suspended', now(), now(), now(), null, null, '{}'::jsonb,
      '2000-01-01T00:00:00Z'::timestamptz)
  $q$));
select pg_temp.check_it('obuna: to''g''ri versiya bilan o''tadi', 'BAJARILDI',
  pg_temp.attempt($q$
    select public.vip_apply_transition(s.id, 'active', 'suspended', 'suspended',
      s.started_at, s.current_period_end, s.grace_until, 'Sinov', null, '{}'::jsonb, s.updated_at)
    from public.vip_subscriptions s
    where s.profile_id = 'eeeeeeee-0000-4000-8000-000000000001'
  $q$));
select pg_temp.check_it('obuna: har o''tish tarixda (created, activated, suspended)', '3',
  (select count(*)::text from public.vip_subscription_events e
   join public.vip_subscriptions s on s.id = e.subscription_id
   where s.profile_id = 'eeeeeeee-0000-4000-8000-000000000001'));

select pg_temp.check_it('tahrir: birinchi tasdiq o''tadi', 'BAJARILDI',
  pg_temp.attempt($q$ select public.apply_candidate_profile_edit('acacacac-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000003', null) $q$));
select pg_temp.check_it('tahrir: ikkinchi tasdiq PT409 (40001 emas — cheksiz qayta urinish yo''q)', 'XATO: PT409',
  pg_temp.attempt($q$ select public.apply_candidate_profile_edit('acacacac-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000003', null) $q$));
select pg_temp.check_it('tahrir: qiymat nomzodga yozildi', '1990-01-01',
  (select birth_date::text from public.candidates where id = 'ffffffff-0000-4000-8000-000000000001'));

-- ============================================================
-- 6. QOLGAN OCHIQ SECURITY DEFINER FUNKSIYALAR
--    (jonli bazada repoda yo'q funksiya bo'lsa, shu yerda ko'rinadi)
-- ============================================================
select pg_temp.check_it('anon/authenticated chaqira oladigan boshqa SECURITY DEFINER funksiya yo''q', '',
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.prokind = 'f'
     and p.prorettype <> 'trigger'::regtype
     and p.proname not in ('has_permission', 'is_admin', 'has_any_role', 'list_published_candidates_v2')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))));

-- ============================================================
-- NATIJA
-- ============================================================
reset role;

select
  lpad(id::text, 2) || '. ' ||
  case when passed then '✅' else '❌' end || '  ' ||
  scenario ||
  case when passed then '' else '   [kutilgan: ' || expected || ', natija: ' || coalesce(actual, 'null') || ']' end
  as natija
from rls_results order by id;

select
  count(*) filter (where passed) || ' / ' || count(*) || ' o''tdi' as jami,
  count(*) filter (where not passed) as yiqildi
from rls_results;

rollback;
