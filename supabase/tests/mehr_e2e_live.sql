-- ============================================================
-- TO'LIQ OQIM — JONLI TEKSHIRUV (§18)
--
-- Tashkilotchi → tadbir → seans → ko'p ishtirokchi → dalil
-- → tasdiq → ball → sertifikat → QAYTA TASDIQ (dublikat yo'q).
--
-- Bitta tranzaksiya, oxirida ROLLBACK.
-- ============================================================

begin;
set local client_min_messages to warning;

create temporary table e2e (
  id serial, scenario text, expected text, actual text, passed boolean
) on commit drop;

create or replace function pg_temp.chk(s text, e text, a text) returns void
language plpgsql as $$
begin
  insert into e2e (scenario, expected, actual, passed) values (s, e, a, e = a);
end; $$;

-- ------------------------------------------------------------
-- ODAMLAR: 1 tashkilotchi + 3 ishtirokchi
-- ------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
select
  ('eeeeeeee-0000-4000-8000-00000000000' || i)::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'e2e' || i || '@test.local', '', now(), now()
from generate_series(1, 4) i;

insert into public.profiles (id, full_name)
select ('eeeeeeee-0000-4000-8000-00000000000' || i)::uuid, 'E2E ' || i
from generate_series(1, 4) i
on conflict (id) do update set full_name = excluded.full_name;

-- ------------------------------------------------------------
-- TADBIR (qoralama) + tashkilotchi ishtirokchi sifatida
-- ------------------------------------------------------------
insert into public.mehr_activities
  (id, organizer_profile_id, title, status, requires_location, starts_at, beneficiary_count,
   description, purpose, cover_image_url)
values
  ('ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001',
   'Qishki yordam aksiyasi', 'draft', false, now() - interval '1 day', 40,
   'Issiq kiyim tarqatildi.', 'Kam ta''minlangan oilalarga yordam.', 'https://example.com/c.jpg');

insert into public.mehr_participants (activity_id, profile_id, role, status, checked_in_at)
values ('ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001',
        'organizer', 'checked_in', now());

-- ------------------------------------------------------------
-- SEANS + KO'P ISHTIROKCHI BIR QR ORQALI
--
-- QR "sarflanmaydi": u tadbirdagi ekranda turadi va uni bir
-- nechta odam skanerlaydi. Shuni tekshiramiz.
-- ------------------------------------------------------------
insert into public.mehr_activity_sessions (id, activity_id, signing_secret, status)
values ('ffffffff-0000-4000-8000-0000000000aa', 'ffffffff-0000-4000-8000-000000000001',
        'e2e-kalit', 'open');

insert into public.mehr_participants (activity_id, profile_id, role, status, checked_in_at)
select 'ffffffff-0000-4000-8000-000000000001',
       ('eeeeeeee-0000-4000-8000-00000000000' || i)::uuid, 'participant', 'checked_in', now()
from generate_series(2, 4) i;

-- Uchalasi ham BITTA seansning bitta nonce'i bilan kirdi.
insert into public.mehr_checkins (activity_session_id, participant_id, nonce, location_verified)
select 'ffffffff-0000-4000-8000-0000000000aa', p.id, 'BIR-XIL-NONCE', false
from public.mehr_participants p
where p.activity_id = 'ffffffff-0000-4000-8000-000000000001'
  and p.role = 'participant';

select pg_temp.chk('bitta QR — uch xil ishtirokchi check-in qildi', '3',
  (select count(*)::text from public.mehr_checkins
   where activity_session_id = 'ffffffff-0000-4000-8000-0000000000aa'));

-- TAKRORIY CHECK-IN — bir odam ikkinchi marta
do $$
declare v text;
begin
  begin
    insert into public.mehr_participants (activity_id, profile_id, role, status)
    values ('ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000002',
            'participant', 'checked_in');
    v := 'YOZILDI';
  exception when unique_violation then v := 'RAD ETILDI';
  end;
  perform pg_temp.chk('bir odam ikkinchi marta check-in qila olmaydi', 'RAD ETILDI', v);
end; $$;

-- ------------------------------------------------------------
-- DALIL YUBORISH
-- ------------------------------------------------------------
insert into public.mehr_media (activity_id, url, kind)
values ('ffffffff-0000-4000-8000-000000000001', 'https://example.com/1.jpg', 'photo');

update public.mehr_activities
   set status = 'submitted', submitted_at = now()
 where id = 'ffffffff-0000-4000-8000-000000000001';

-- ------------------------------------------------------------
-- TASDIQ — BIRINCHI MARTA
-- ------------------------------------------------------------
create temporary table approve_out (r jsonb) on commit drop;

insert into approve_out
select public.mehr_approve_activity('ffffffff-0000-4000-8000-000000000001',
                                     'eeeeeeee-0000-4000-8000-000000000001');

select pg_temp.chk('tasdiq bajarildi', 'approved',
  (select r->>'reason' from approve_out limit 1));

select pg_temp.chk('holat approved bo''ldi', 'approved',
  (select status from public.mehr_activities where id = 'ffffffff-0000-4000-8000-000000000001'));

select pg_temp.chk('ishtirok ro''yxati muzlatildi (4 ta)', '4',
  (select count(*)::text from public.mehr_participants
   where activity_id = 'ffffffff-0000-4000-8000-000000000001' and frozen_at is not null));

-- BALL
select pg_temp.chk('tashkilotchi AYNAN 60 ball oldi', '60',
  (select coalesce(sum(points), 0)::text from public.point_ledger
   where profile_id = 'eeeeeeee-0000-4000-8000-000000000001'
     and source_id = 'ffffffff-0000-4000-8000-000000000001'));

select pg_temp.chk('har ishtirokchi AYNAN 20 ball oldi', '20,20,20',
  (select string_agg(total::text, ',' order by total) from (
     select sum(points) as total from public.point_ledger
     where profile_id in ('eeeeeeee-0000-4000-8000-000000000002',
                          'eeeeeeee-0000-4000-8000-000000000003',
                          'eeeeeeee-0000-4000-8000-000000000004')
       and source_id = 'ffffffff-0000-4000-8000-000000000001'
     group by profile_id) t));

select pg_temp.chk('jami 4 ta ball yozuvi', '4',
  (select count(*)::text from public.point_ledger
   where source_id = 'ffffffff-0000-4000-8000-000000000001'));

-- SERTIFIKAT
select pg_temp.chk('4 ta sertifikat berildi', '4',
  (select count(*)::text from public.certificates
   where activity_id = 'ffffffff-0000-4000-8000-000000000001'));

select pg_temp.chk('tashkilotchi sertifikati roli farq qiladi', 'organizer',
  (select role from public.certificates
   where activity_id = 'ffffffff-0000-4000-8000-000000000001'
     and recipient_profile_id = 'eeeeeeee-0000-4000-8000-000000000001'));

select pg_temp.chk('sertifikat kodi to''g''ri shaklda', 'true',
  (select bool_and(code ~ '^MEHR-[0-9A-HJ-NP-TV-Z]{10}$')::text
   from public.certificates where activity_id = 'ffffffff-0000-4000-8000-000000000001'));

select pg_temp.chk('sertifikat kodlari takrorlanmaydi', '4',
  (select count(distinct code)::text from public.certificates
   where activity_id = 'ffffffff-0000-4000-8000-000000000001'));

-- JAMLANMA
select pg_temp.chk('jamlanma tashkilotchi uchun 60', '60',
  (select total_points::text from public.point_aggregates
   where profile_id = 'eeeeeeee-0000-4000-8000-000000000001'
     and period = 'all' and period_key = 'all' and category = 'total'));

-- ------------------------------------------------------------
-- QAYTA TASDIQ — DUBLIKAT BO'LMASLIGI
-- ------------------------------------------------------------
delete from approve_out;
insert into approve_out
select public.mehr_approve_activity('ffffffff-0000-4000-8000-000000000001',
                                     'eeeeeeee-0000-4000-8000-000000000001');

select pg_temp.chk('qayta tasdiq "already_approved" qaytaradi', 'already_approved',
  (select r->>'reason' from approve_out limit 1));

select pg_temp.chk('qayta tasdiqda YANGI ball yaratilmadi', '0',
  (select r->>'points_created' from approve_out limit 1));

select pg_temp.chk('qayta tasdiqda YANGI sertifikat yaratilmadi', '0',
  (select r->>'certificates_created' from approve_out limit 1));

select pg_temp.chk('ball yozuvlari soni O''ZGARMADI', '4',
  (select count(*)::text from public.point_ledger
   where source_id = 'ffffffff-0000-4000-8000-000000000001'));

select pg_temp.chk('sertifikatlar soni O''ZGARMADI', '4',
  (select count(*)::text from public.certificates
   where activity_id = 'ffffffff-0000-4000-8000-000000000001'));

select pg_temp.chk('jamlanma O''ZGARMADI', '60',
  (select total_points::text from public.point_aggregates
   where profile_id = 'eeeeeeee-0000-4000-8000-000000000001'
     and period = 'all' and period_key = 'all' and category = 'total'));

-- ------------------------------------------------------------
-- O'ZGARMASLIK KAFOLATLARI
-- ------------------------------------------------------------
do $$
declare v text;
begin
  begin
    update public.point_ledger set points = 9999
    where source_id = 'ffffffff-0000-4000-8000-000000000001';
    v := 'O''ZGARDI';
  exception when others then v := 'RAD ETILDI';
  end;
  perform pg_temp.chk('ball daftarini TAHRIRLAB bo''lmaydi', 'RAD ETILDI', v);
end; $$;

do $$
declare v text;
begin
  begin
    delete from public.point_ledger where source_id = 'ffffffff-0000-4000-8000-000000000001';
    v := 'O''CHDI';
  exception when others then v := 'RAD ETILDI';
  end;
  perform pg_temp.chk('ball daftaridan O''CHIRIB bo''lmaydi', 'RAD ETILDI', v);
end; $$;

do $$
declare v text;
begin
  begin
    delete from public.mehr_activities where id = 'ffffffff-0000-4000-8000-000000000001';
    v := 'O''CHDI';
  exception when others then v := 'RAD ETILDI';
  end;
  perform pg_temp.chk('tasdiqlangan tadbirni o''chirib bo''lmaydi', 'RAD ETILDI', v);
end; $$;

do $$
declare v text;
begin
  begin
    delete from public.profiles where id = 'eeeeeeee-0000-4000-8000-000000000001';
    v := 'O''CHDI';
  exception when others then v := 'RAD ETILDI';
  end;
  perform pg_temp.chk('ball tarixi bor a''zoni o''chirib bo''lmaydi', 'RAD ETILDI', v);
end; $$;

-- TESKARI YOZUV — tuzatishning YAGONA yo'li
insert into public.point_ledger
  (profile_id, category, source_type, source_id, points, idempotency_key, note, reverses_ledger_id)
select profile_id, category, 'adjustment', source_id, -points,
       'reversal:' || idempotency_key || ':soxta-dalil', 'Soxta dalil aniqlandi', id
from public.point_ledger
where profile_id = 'eeeeeeee-0000-4000-8000-000000000002'
  and source_id = 'ffffffff-0000-4000-8000-000000000001';

select pg_temp.chk('teskari yozuv bilan ball nolga tushdi', '0',
  (select coalesce(sum(points), 0)::text from public.point_ledger
   where profile_id = 'eeeeeeee-0000-4000-8000-000000000002'));

select pg_temp.chk('asl yozuv O''CHMADI — tarix saqlandi', '2',
  (select count(*)::text from public.point_ledger
   where profile_id = 'eeeeeeee-0000-4000-8000-000000000002'));

-- ------------------------------------------------------------
-- NATIJA
-- ------------------------------------------------------------
select
  lpad(id::text, 2) || '. ' || case when passed then '✅' else '❌' end || '  ' || scenario ||
  case when passed then '' else '   [kutilgan: ' || expected || ', natija: ' || actual || ']' end
from e2e order by id;

select count(*) filter (where passed) || ' / ' || count(*) || ' o''tdi' from e2e;

rollback;
