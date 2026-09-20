-- ============================================================
-- PROFIL KO'RISHLARI → BALL — JONLI TEKSHIRUV
-- ============================================================

begin;
set local client_min_messages to warning;

create temporary table vp (id serial, scenario text, expected text, actual text, passed boolean) on commit drop;
grant all on vp to public;
grant usage, select on sequence vp_id_seq to public;

create or replace function pg_temp.chk(s text, e text, a text) returns void
language plpgsql as $$
begin insert into vp (scenario, expected, actual, passed) values (s, e, a, e = a); end; $$;

-- ODAMLAR VA NOMZOD
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('99000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vp-owner@test.local', '', now(), now()),
  ('99000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vp-other@test.local', '', now(), now());

insert into public.candidates (id, slug, full_name, status, user_id)
values ('99000000-0000-4000-8000-0000000000c1', 'vp-test-nomzod', 'VP Test', 'published',
        '99000000-0000-4000-8000-000000000001');

-- ------------------------------------------------------------
-- 1. ODDIY KO'RISH
-- ------------------------------------------------------------
select pg_temp.chk('birinchi ko''rish hisoblanadi', 'true',
  public.record_profile_view('vp-test-nomzod', repeat('a', 64))::text);

-- ------------------------------------------------------------
-- 2. YANGILASH — BALL TERISH MUMKIN EMAS
-- ------------------------------------------------------------
select pg_temp.chk('o''sha tashrifchi ikkinchi marta hisoblanmaydi', 'false',
  public.record_profile_view('vp-test-nomzod', repeat('a', 64))::text);

select pg_temp.chk('uchinchi marta ham hisoblanmaydi', 'false',
  public.record_profile_view('vp-test-nomzod', repeat('a', 64))::text);

select pg_temp.chk('jadvalda bitta qator qoldi', '1',
  (select count(*)::text from public.profile_views
   where candidate_id = '99000000-0000-4000-8000-0000000000c1'));

-- ------------------------------------------------------------
-- 3. BOSHQA TASHRIFCHI — HISOBLANADI
-- ------------------------------------------------------------
select pg_temp.chk('boshqa tashrifchi hisoblanadi', 'true',
  public.record_profile_view('vp-test-nomzod', repeat('b', 64))::text);

-- ------------------------------------------------------------
-- 4. BOT — HISOBLANMAYDI VA JADVALGA YOZILMAYDI
-- ------------------------------------------------------------
select pg_temp.chk('bot hisoblanmaydi', 'false',
  public.record_profile_view('vp-test-nomzod', repeat('c', 64), null, true)::text);

select pg_temp.chk('bot profile_views ga YOZILMAYDI', '2',
  (select count(*)::text from public.profile_views
   where candidate_id = '99000000-0000-4000-8000-0000000000c1'));

select pg_temp.chk('bot alohida sanoqqa tushdi', '1',
  (select view_count::text from public.profile_view_exclusions
   where candidate_id = '99000000-0000-4000-8000-0000000000c1' and reason = 'bot'));

-- Bot yangi cookie bilan qaytsa ham jadval o'smaydi.
select public.record_profile_view('vp-test-nomzod', repeat('d', 64), null, true);
select public.record_profile_view('vp-test-nomzod', repeat('e', 64), null, true);

select pg_temp.chk('botlar jadvalni shishirmaydi', '2',
  (select count(*)::text from public.profile_views
   where candidate_id = '99000000-0000-4000-8000-0000000000c1'));

select pg_temp.chk('bot sanog''i o''sdi', '3',
  (select view_count::text from public.profile_view_exclusions
   where candidate_id = '99000000-0000-4000-8000-0000000000c1' and reason = 'bot'));

-- ------------------------------------------------------------
-- 5. O'Z SAHIFASINI KO'RISH — BALL BERMAYDI
-- ------------------------------------------------------------
select pg_temp.chk('egasi o''z sahifasini ko''rsa hisoblanmaydi', 'false',
  public.record_profile_view('vp-test-nomzod', repeat('f', 64),
                             '99000000-0000-4000-8000-000000000001')::text);

select pg_temp.chk('o''z-ko''rish alohida belgilandi', '1',
  (select view_count::text from public.profile_view_exclusions
   where candidate_id = '99000000-0000-4000-8000-0000000000c1' and reason = 'self'));

-- Boshqa tizimga kirgan odam — hisoblanadi.
select pg_temp.chk('boshqa a''zo ko''rsa hisoblanadi', 'true',
  public.record_profile_view('vp-test-nomzod', repeat('0', 64),
                             '99000000-0000-4000-8000-000000000002')::text);

-- ------------------------------------------------------------
-- 6. NASHR QILINMAGAN NOMZOD
-- ------------------------------------------------------------
select pg_temp.chk('mavjud bo''lmagan slug hisoblanmaydi', 'false',
  public.record_profile_view('yoq-bunday-nomzod', repeat('9', 64))::text);

-- ------------------------------------------------------------
-- 7. SIYOSAT SOZLAMADAN O'QILADI
-- ------------------------------------------------------------
select pg_temp.chk('standart siyosat: 50 ko''rish = 1 ball', '50',
  (select views_per_point::text from public.ranking_view_policy()));

select pg_temp.chk('standart chegara: 20 ball', '20',
  (select points_cap::text from public.ranking_view_policy()));

update public.site_settings set value = '25' where key = 'ranking.views_per_point';
select pg_temp.chk('sozlama o''zgarsa siyosat ham o''zgaradi', '25',
  (select views_per_point::text from public.ranking_view_policy()));

-- Buzuq qiymat butun reytingni yiqitmasligi kerak.
update public.site_settings set value = '0' where key = 'ranking.views_per_point';
select pg_temp.chk('nol qiymat nolga bo''lishga olib kelmaydi', 'true',
  ((select views_per_point from public.ranking_view_policy()) >= 1)::text);

update public.site_settings set value = '50' where key = 'ranking.views_per_point';

-- Bayroq o'chirilsa.
update public.site_settings set value = 'false' where key = 'ranking.profile_views_enabled';
select pg_temp.chk('bayroq o''chirilsa siyosat buni aytadi', 'false',
  (select enabled::text from public.ranking_view_policy()));
update public.site_settings set value = 'true' where key = 'ranking.profile_views_enabled';

-- ------------------------------------------------------------
-- 8. MAXFIYLIK
-- ------------------------------------------------------------
select pg_temp.chk('chiqarib tashlangan ko''rishlarda tashrifchi identifikatori YO''Q', '0',
  (select count(*)::text from information_schema.columns
   where table_name = 'profile_view_exclusions'
     and column_name in ('viewer_hash', 'ip', 'ip_address', 'user_agent')));

set local role anon;
select pg_temp.chk('anon chiqarib tashlanganlarni ko''rmaydi', '0',
  (select count(*)::text from public.profile_view_exclusions));
reset role;

-- ------------------------------------------------------------
-- 9. OYLIK HAVOLA — TAKRORLANMASLIK
-- ------------------------------------------------------------
insert into public.monthly_update_tokens (candidate_id, token_hash, period_key, expires_at)
values ('99000000-0000-4000-8000-0000000000c1', repeat('1', 64), '2026-09', now() + interval '30 days');

do $$
declare v text;
begin
  begin
    insert into public.monthly_update_tokens (candidate_id, token_hash, period_key, expires_at)
    values ('99000000-0000-4000-8000-0000000000c1', repeat('2', 64), '2026-09', now() + interval '30 days');
    v := 'YOZILDI';
  exception when unique_violation then v := 'RAD ETILDI';
  end;
  perform pg_temp.chk('bitta davrga ikkinchi avtomatik havola yaratilmaydi', 'RAD ETILDI', v);
end; $$;

-- Keyingi oy — mumkin.
insert into public.monthly_update_tokens (candidate_id, token_hash, period_key, expires_at)
values ('99000000-0000-4000-8000-0000000000c1', repeat('3', 64), '2026-10', now() + interval '30 days');

select pg_temp.chk('keyingi oy uchun yangi havola yaratiladi', '2',
  (select count(*)::text from public.monthly_update_tokens
   where candidate_id = '99000000-0000-4000-8000-0000000000c1' and period_key is not null));

-- Qo'lda yaratilgan havola cheklovga tushmaydi.
insert into public.monthly_update_tokens (candidate_id, token_hash, expires_at)
values ('99000000-0000-4000-8000-0000000000c1', repeat('4', 64), now() + interval '30 days');
insert into public.monthly_update_tokens (candidate_id, token_hash, expires_at)
values ('99000000-0000-4000-8000-0000000000c1', repeat('5', 64), now() + interval '30 days');

select pg_temp.chk('qo''lda yaratilgan havolalar cheklanmaydi', '2',
  (select count(*)::text from public.monthly_update_tokens
   where candidate_id = '99000000-0000-4000-8000-0000000000c1' and period_key is null));

-- ------------------------------------------------------------
-- NATIJA
-- ------------------------------------------------------------
select
  lpad(id::text, 2) || '. ' || case when passed then '✅' else '❌' end || '  ' || scenario ||
  case when passed then '' else '   [kutilgan: ' || expected || ', natija: ' || actual || ']' end
from vp order by id;

select count(*) filter (where passed) || ' / ' || count(*) || ' o''tdi' from vp;

rollback;
