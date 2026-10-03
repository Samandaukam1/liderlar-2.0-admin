-- =========================================================================
-- PROFIL KO'RISHLARI — ANTI-FRAUD (Premium Challenge ko'rishlarga tayanadi)
--
-- MUAMMO: tashrif buyuruvchi faqat cookie bilan aniqlanardi. Cookie
-- yubormagan skript har so'rovda YANGI tasodifiy ID olardi va har so'rov
-- "yangi noyob ko'rish" bo'lib sanalardi — `curl` sikli cheksiz ko'rish
-- berardi. Endi ko'rishlar VIP mukofotini hal qiladi, ya'ni bu teshik
-- pulga teng.
--
-- YECHIM (xom IP SAQLANMAYDI):
--   · `network_hash` — server kunlik kalit bilan hisoblagan HMAC(IP).
--     Kun almashganda kalit ham almashadi: kunlar orasida bog'lab
--     bo'lmaydi.
--   · Bitta nomzodga bitta tarmoqdan kuniga 10 tadan ortiq ko'rish
--     SANALMAYDI ('network_cap'). Chegara ataylab 1 emas: O'zbekiston
--     mobil operatorlari CGNAT ishlatadi — bitta IP ortida yuzlab real
--     odam bo'ladi.
--   · Bitta tarmoqdan soatiga 120 dan ortiq sanalgan ko'rish (barcha
--     nomzodlarga) — 'velocity'. Ichki belgi, ochiq ayblov emas.
--   · Cookie'siz so'rov ilova tomonida sanalmaydi ('no_cookie').
--
-- `record_profile_view` imzosi o'zgaradi (yangi ixtiyoriy parametr) —
-- eski funksiya o'chiriladi, aks holda PostgREST ikkisidan birini tanlay
-- olmasdi. Eski kod (4 parametr) yangi funksiyani chaqiraveradi.
--
-- FORWARD-ONLY.
-- =========================================================================

alter table public.profile_views
  add column if not exists network_hash text;

comment on column public.profile_views.network_hash is
  'HMAC(kunlik kalit, IP) — xom IP emas. Kunlik chegaralar uchun.';

create index if not exists idx_profile_views_network_time
  on public.profile_views (network_hash, created_at)
  where network_hash is not null;

-- Kunlik challenge oynasi bo'yicha sanash (vaqt oralig'i -> nomzod).
create index if not exists idx_profile_views_counted_time
  on public.profile_views (created_at, candidate_id)
  where is_counted;

alter table public.profile_view_exclusions
  drop constraint if exists profile_view_exclusions_reason_check;
alter table public.profile_view_exclusions
  add constraint profile_view_exclusions_reason_check
  check (reason in ('bot', 'self', 'unpublished', 'network_cap', 'velocity', 'no_cookie'));

drop function if exists public.record_profile_view(text, text, uuid, boolean);

create or replace function public.record_profile_view(
  p_candidate_slug text,
  p_viewer_hash text,
  p_viewer_user_id uuid default null,
  p_is_bot boolean default false,
  p_network_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate uuid;
  v_owner uuid;
  v_reason text;
  v_day date;
  v_day_start timestamptz;
  v_count integer;
begin
  if p_viewer_hash is null or char_length(p_viewer_hash) < 16 then
    return false;
  end if;

  select id, user_id into v_candidate, v_owner
  from public.candidates
  where slug = p_candidate_slug and status = 'published' and deleted_at is null;

  if v_candidate is null then
    return false;
  end if;

  v_day := (timezone('Asia/Tashkent', now()))::date;
  v_day_start := (v_day::timestamp) at time zone 'Asia/Tashkent';

  if p_is_bot then
    v_reason := 'bot';
  elsif v_owner is not null and p_viewer_user_id is not null and v_owner = p_viewer_user_id then
    v_reason := 'self';
  end if;

  if v_reason is null and p_network_hash is not null then
    select count(*) into v_count
      from public.profile_views
     where candidate_id = v_candidate
       and network_hash = p_network_hash
       and is_counted
       and created_at >= v_day_start;

    if v_count >= 10 then
      v_reason := 'network_cap';
    else
      select count(*) into v_count
        from public.profile_views
       where network_hash = p_network_hash
         and is_counted
         and created_at > now() - interval '1 hour';
      if v_count >= 120 then
        v_reason := 'velocity';
      end if;
    end if;
  end if;

  if v_reason is not null then
    insert into public.profile_view_exclusions (candidate_id, day, reason, view_count, updated_at)
    values (v_candidate, v_day, v_reason, 1, now())
    on conflict (candidate_id, day, reason)
    do update set view_count = public.profile_view_exclusions.view_count + 1,
                  updated_at = now();
    return false;
  end if;

  insert into public.profile_views (candidate_id, viewer_hash, is_counted, network_hash)
  values (v_candidate, p_viewer_hash, true, p_network_hash)
  on conflict do nothing;

  return found;
end;
$$;

revoke all on function public.record_profile_view(text, text, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_profile_view(text, text, uuid, boolean, text)
  to service_role;

-- Cookie'siz so'rovni ilova shu yerga qayd etadi (sanamasdan).
create or replace function public.record_profile_view_exclusion(p_candidate_slug text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate uuid;
begin
  if p_reason not in ('no_cookie', 'bot') then
    raise exception 'Sabab noto''g''ri: %', p_reason using errcode = '22023';
  end if;
  select id into v_candidate from public.candidates
   where slug = p_candidate_slug and status = 'published' and deleted_at is null;
  if v_candidate is null then
    return;
  end if;
  insert into public.profile_view_exclusions (candidate_id, day, reason, view_count, updated_at)
  values (v_candidate, (timezone('Asia/Tashkent', now()))::date, p_reason, 1, now())
  on conflict (candidate_id, day, reason)
  do update set view_count = public.profile_view_exclusions.view_count + 1, updated_at = now();
end;
$$;

revoke all on function public.record_profile_view_exclusion(text, text) from public, anon, authenticated;
grant execute on function public.record_profile_view_exclusion(text, text) to service_role;
