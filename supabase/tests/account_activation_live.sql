-- ============================================================
-- PHASE 12 — JONLI TEKSHIRUV
--
-- Faollashtirishning BAZA DARAJASIDAGI kafolatlari. Ilova
-- mantig'i emas — aynan indekslar va shartli UPDATE'lar
-- haqiqatan to'sadimi.
--
-- Bitta tranzaksiya, oxirida ROLLBACK.
-- ============================================================

begin;
set local client_min_messages to warning;

create temporary table a12 (
  id serial, scenario text, expected text, actual text, passed boolean
) on commit drop;

grant all on a12 to public;
grant usage, select on sequence a12_id_seq to public;

create or replace function pg_temp.chk(s text, e text, a text) returns void
language plpgsql as $$
begin
  insert into a12 (scenario, expected, actual, passed) values (s, e, a, e = a);
end; $$;

-- ------------------------------------------------------------
-- MA'LUMOT
-- ------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('12000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a12-1@test.local', '', now(), now()),
  ('12000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a12-2@test.local', '', now(), now());

insert into public.candidates (id, slug, full_name, status)
values
  ('12000000-0000-4000-8000-0000000000c1', 'test-nomzod-bir', 'Test Nomzod Bir', 'published'),
  ('12000000-0000-4000-8000-0000000000c2', 'test-nomzod-ikki', 'Test Nomzod Ikki', 'published');

-- ------------------------------------------------------------
-- 1. BITTA NOMZOD — BITTA AMALDAGI TAKLIFNOMA
-- ------------------------------------------------------------
insert into public.candidate_activations (candidate_id, token_hash, expires_at)
values ('12000000-0000-4000-8000-0000000000c1', repeat('a', 64), now() + interval '48 hours');

do $$
declare v text;
begin
  begin
    insert into public.candidate_activations (candidate_id, token_hash, expires_at)
    values ('12000000-0000-4000-8000-0000000000c1', repeat('b', 64), now() + interval '48 hours');
    v := 'YOZILDI';
  exception when unique_violation then v := 'RAD ETILDI';
  end;
  perform pg_temp.chk('ikkinchi amaldagi taklifnoma yaratilmaydi', 'RAD ETILDI', v);
end; $$;

-- Eskisi bekor qilinsa — yangisi mumkin.
update public.candidate_activations
   set revoked_at = now(), revoked_by = null, revoke_reason = 'Yangi havola yaratildi'
 where candidate_id = '12000000-0000-4000-8000-0000000000c1' and consumed_at is null and revoked_at is null;

insert into public.candidate_activations (candidate_id, token_hash, expires_at)
values ('12000000-0000-4000-8000-0000000000c1', repeat('b', 64), now() + interval '48 hours');

select pg_temp.chk('bekor qilingandan keyin yangisi yaratiladi', '2',
  (select count(*)::text from public.candidate_activations
   where candidate_id = '12000000-0000-4000-8000-0000000000c1'));

-- ------------------------------------------------------------
-- 2. TAKLIFNOMANI EGALLASH — MUTEX
-- ------------------------------------------------------------
with claim as (
  update public.candidate_activations
     set consumed_at = now(), consumed_by_user_id = '12000000-0000-4000-8000-000000000001',
         consumed_mode = 'new_account'
   where token_hash = repeat('b', 64)
     and consumed_at is null and revoked_at is null and expires_at > now()
  returning 1
)
select pg_temp.chk('taklifnoma egallandi', '1', (select count(*)::text from claim));

-- Ikkinchi urinish — 0 qator.
with claim as (
  update public.candidate_activations
     set consumed_at = now(), consumed_by_user_id = '12000000-0000-4000-8000-000000000002'
   where token_hash = repeat('b', 64)
     and consumed_at is null and revoked_at is null and expires_at > now()
  returning 1
)
select pg_temp.chk('IKKINCHI marta egallab bo''lmaydi', '0', (select count(*)::text from claim));

-- Bekor qilingan taklifnoma ishlamaydi.
with claim as (
  update public.candidate_activations
     set consumed_at = now()
   where token_hash = repeat('a', 64)
     and consumed_at is null and revoked_at is null and expires_at > now()
  returning 1
)
select pg_temp.chk('BEKOR QILINGAN taklifnoma ishlamaydi', '0', (select count(*)::text from claim));

-- Muddati o'tgan taklifnoma ishlamaydi.
insert into public.candidate_activations (candidate_id, token_hash, expires_at)
values ('12000000-0000-4000-8000-0000000000c2', repeat('c', 64), now() - interval '1 hour');

with claim as (
  update public.candidate_activations
     set consumed_at = now()
   where token_hash = repeat('c', 64)
     and consumed_at is null and revoked_at is null and expires_at > now()
  returning 1
)
select pg_temp.chk('MUDDATI O''TGAN taklifnoma ishlamaydi', '0', (select count(*)::text from claim));

-- ------------------------------------------------------------
-- 3. NOMZODNI BOG'LASH
-- ------------------------------------------------------------
with link as (
  update public.candidates
     set user_id = '12000000-0000-4000-8000-000000000001'
   where id = '12000000-0000-4000-8000-0000000000c1' and user_id is null and deleted_at is null
  returning 1
)
select pg_temp.chk('nomzod bog''landi', '1', (select count(*)::text from link));

-- Ikkinchi marta bog'lab bo'lmaydi.
with link as (
  update public.candidates
     set user_id = '12000000-0000-4000-8000-000000000002'
   where id = '12000000-0000-4000-8000-0000000000c1' and user_id is null and deleted_at is null
  returning 1
)
select pg_temp.chk('bog''langan nomzodni qayta bog''lab bo''lmaydi', '0',
  (select count(*)::text from link));

-- BITTA HISOB — BITTA NOMZOD.
do $$
declare v text;
begin
  begin
    update public.candidates
       set user_id = '12000000-0000-4000-8000-000000000001'
     where id = '12000000-0000-4000-8000-0000000000c2';
    v := 'YOZILDI';
  exception when unique_violation then v := 'RAD ETILDI';
  end;
  perform pg_temp.chk('bitta hisob ikkinchi nomzodni egallay olmaydi', 'RAD ETILDI', v);
end; $$;

-- ------------------------------------------------------------
-- 4. MAQOLA VA NOMZOD O'ZGARMAYDI
-- ------------------------------------------------------------
select pg_temp.chk('nomzod slug''i o''zgarmadi', 'test-nomzod-bir',
  (select slug from public.candidates where id = '12000000-0000-4000-8000-0000000000c1'));

select pg_temp.chk('ikkinchi nomzod hamon bog''lanmagan', 'true',
  (select (user_id is null)::text from public.candidates
   where id = '12000000-0000-4000-8000-0000000000c2'));

-- ------------------------------------------------------------
-- 5. RLS — TAKLIFNOMALAR HECH KIMGA OCHIQ EMAS
-- ------------------------------------------------------------
set local role anon;
select pg_temp.chk('anon taklifnomalarni sanay olmaydi', '0',
  (select count(*)::text from public.candidate_activations));

set local role authenticated;
set local request.jwt.claims to '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}';
select pg_temp.chk('a''zo ham taklifnomalarni ko''rmaydi', '0',
  (select count(*)::text from public.candidate_activations));

do $$
declare v text;
begin
  begin
    update public.candidates set user_id = '12000000-0000-4000-8000-000000000001'
    where id = '12000000-0000-4000-8000-0000000000c2';
    v := case when found then 'O''ZGARDI' else 'TEGMADI' end;
  exception when others then v := 'RAD ETILDI';
  end;
  perform pg_temp.chk('a''zo o''zini nomzodga bog''lay olmaydi', 'TEGMADI', v);
end; $$;

reset role;

-- ------------------------------------------------------------
-- NATIJA
-- ------------------------------------------------------------
select
  lpad(id::text, 2) || '. ' || case when passed then '✅' else '❌' end || '  ' || scenario ||
  case when passed then '' else '   [kutilgan: ' || expected || ', natija: ' || actual || ']' end
from a12 order by id;

select count(*) filter (where passed) || ' / ' || count(*) || ' o''tdi' from a12;

rollback;
