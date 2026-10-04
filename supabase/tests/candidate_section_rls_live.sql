-- ============================================================
-- BIOGRAFIYA BO'LIMLARI — JONLI TEKSHIRUV
--
-- VIP a'zo o'z biografiyasining MATNINI tahrirlay oladi. Bu
-- tekshiruv ilova mantig'ini emas, BAZA darajasidagi
-- kafolatlarni sinaydi: frontendda tugmani yashirish
-- avtorizatsiya emas, shuning uchun RLS ning o'zi to'sishi kerak.
--
-- Nima tekshiriladi:
--   1. egasi o'zining KUTAYOTGAN matnini ko'radi;
--   2. VIP a'zo BOSHQA odamning matnini ko'rmaydi/o'zgartirmaydi;
--   3. a'zo bazaga TO'G'RIDAN-TO'G'RI yozolmaydi — na o'ziga
--      (matn ko'rikdan o'tishi kerak), na boshqa odamga, va
--      o'zini NASHR qilolmaydi;
--   4. anon kutayotgan matnni ko'rmaydi, nashr bo'lganini ko'radi;
--   5. panel saqlashi (`save_candidate_profile_v2`) a'zoning
--      kutayotgan matnini O'CHIRMAYDI.
--
-- Bitta tranzaksiya, oxirida ROLLBACK — ma'lumot qolmaydi.
--
-- Ishga tushirish (lokal):
--   docker exec -i supabase_db_liderlar-admin psql -U postgres \
--     -d postgres -v ON_ERROR_STOP=1 -q -f - \
--     < supabase/tests/candidate_section_rls_live.sql
-- ============================================================

begin;
set local client_min_messages to warning;

create temp table t(nom text, otdi boolean, izoh text) on commit drop;

-- Natijalar jadvali sinov rollari uchun ham yozilishi kerak: 
-- dan keyin xulosani SHU rol yozadi.
grant insert, select on t to authenticated, anon;

-- --- sinov ma'lumotlari (service_role / superuser bilan) -------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('11111111-1111-4111-8111-111111111111','a@test.local','x',now(),'{}','{}','authenticated','authenticated'),
  ('22222222-2222-4222-8222-222222222222','b@test.local','x',now(),'{}','{}','authenticated','authenticated')
on conflict (id) do nothing;

insert into public.profiles (id, full_name)
values ('11111111-1111-4111-8111-111111111111','A a''zo'),
       ('22222222-2222-4222-8222-222222222222','B a''zo')
on conflict (id) do nothing;

insert into public.candidates (id, slug, full_name, status, user_id)
values
  ('aaaaaaaa-0000-4000-8000-000000000001','sinov-a','Sinov A','published','11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-000000000002','sinov-b','Sinov B','published','22222222-2222-4222-8222-222222222222')
on conflict (id) do nothing;

insert into public.candidate_sections (id, candidate_id, title, content, sort_order, review_state, submitted_by)
values
  ('cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Kutayotgan','A yozgan matn',1,'pending_review','11111111-1111-4111-8111-111111111111'),
  ('cccccccc-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','Nashr bo''lgan','Tahririyat matni',0,'published',null),
  ('cccccccc-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000002','B kutayotgani','B yozgan matn',0,'pending_review','22222222-2222-4222-8222-222222222222')
on conflict (id) do nothing;

-- ====================== 1. EGASI O'ZINI KO'RADI =======================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into t
select 'egasi o''zining kutayotgan matnini ko''radi',
       count(*) = 1, 'ko''rinadi: ' || count(*)
from public.candidate_sections
where id = 'cccccccc-0000-4000-8000-000000000001';

insert into t
select 'VIP a''zo BOSHQA odamning kutayotgan matnini KO''RMAYDI',
       count(*) = 0, 'ko''rinadi: ' || count(*)
from public.candidate_sections
where id = 'cccccccc-0000-4000-8000-000000000003';

-- ============ 3. A'ZO BAZAGA TO'G'RIDAN-TO'G'RI YOZOLMAYDI ============
with x as (
  update public.candidate_sections set content = 'BUZILGAN'
  where id = 'cccccccc-0000-4000-8000-000000000002' returning 1
)
insert into t select 'a''zo O''Z nashr matnini RLS orqali o''zgartirolmaydi',
                     count(*) = 0, 'yozilgan qator: ' || count(*) from x;

with x as (
  update public.candidate_sections set content = 'BUZILGAN'
  where id = 'cccccccc-0000-4000-8000-000000000003' returning 1
)
insert into t select 'a''zo BOSHQA odamning matnini o''zgartirolmaydi',
                     count(*) = 0, 'yozilgan qator: ' || count(*) from x;

with x as (
  update public.candidates set full_name = 'BUZILGAN'
  where id = 'aaaaaaaa-0000-4000-8000-000000000001' returning 1
)
insert into t select 'a''zo nomzod ustunini RLS orqali o''zgartirolmaydi',
                     count(*) = 0, 'yozilgan qator: ' || count(*) from x;

with x as (
  update public.candidates set status = 'published'
  where id = 'bbbbbbbb-0000-4000-8000-000000000002' returning 1
)
insert into t select 'a''zo o''zini NASHR qilolmaydi',
                     count(*) = 0, 'yozilgan qator: ' || count(*) from x;

-- ================== 2. OMMAVIY KO'RINISH (anon) =======================
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into t
select 'anon KUTAYOTGAN matnni ko''rmaydi', count(*) = 0, 'ko''rinadi: ' || count(*)
from public.candidate_sections where review_state = 'pending_review';

insert into t
select 'anon NASHR BO''LGAN matnni ko''radi', count(*) = 1, 'ko''rinadi: ' || count(*)
from public.candidate_sections where id = 'cccccccc-0000-4000-8000-000000000002';

-- ============ 4. PANEL SAQLASHI KUTAYOTGANNI O'CHIRMAYDI ==============
reset role;
select public.save_candidate_profile_v2(
  'aaaaaaaa-0000-4000-8000-000000000001',
  '{"fullName":"Sinov A","slug":"sinov-a"}'::jsonb,
  '[{"id":"cccccccc-0000-4000-8000-000000000002","title":"Nashr bo''lgan","content":"Tahririyat matni","order":0}]'::jsonb,
  null
);

insert into t
select 'panel saqlashi a''zoning kutayotgan matnini O''CHIRMAYDI',
       count(*) = 1, 'qolgan: ' || count(*)
from public.candidate_sections
where id = 'cccccccc-0000-4000-8000-000000000001' and review_state = 'pending_review';

-- ================== TASDIQLASHDAN KEYIN OMMAGA ========================
update public.candidate_sections set review_state = 'published'
where id = 'cccccccc-0000-4000-8000-000000000001';

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
insert into t
select 'tasdiqlangandan keyin anon matnni KO''RADI', count(*) = 1, 'ko''rinadi: ' || count(*)
from public.candidate_sections where id = 'cccccccc-0000-4000-8000-000000000001';

reset role;
select nom, otdi, izoh from t order by nom;

rollback;
