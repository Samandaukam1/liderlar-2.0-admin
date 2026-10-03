-- =========================================================================
-- KUNLIK PREMIUM CHALLENGE
--
-- Har kuni Asia/Tashkent bo'yicha:
--   09:00 — bellashuv boshlanadi (hamma 0 dan; umrbod ko'rishlar O'ZGARMAYDI);
--   19:00 — yopiladi va natija BIR MARTA muzlatiladi.
--
-- ISHTIROKCHI: `candidates.published_at < bugungi 09:00` (18:50 da chop
-- etilgan maqola deyarli tugagan bellashuvga kirmasin), holati
-- `published`, o'chirilmagan.
--
-- BALL: oyna ichidagi SANALGAN ko'rishlar (`profile_views.is_counted`):
-- tashrif buyuruvchi kuniga bir marta, botlar, o'z profilini ko'rish va
-- tarmoq chegaralari tashqarida (20261004101000).
--
-- TENG NATIJA (deterministik):
--   1. ko'proq ko'rish;
--   2. yakuniy natijaga ERTAROQ yetgan (oxirgi sanalgan ko'rish vaqti);
--   3. nomzod id si (o'zgarmas).
--
-- MUKOFOT: 1-o'rin 30, 2-o'rin 20, 3-o'rin 10 kun VIP — `vip_grant_days`
-- orqali (kalit `daily-challenge:SANA:O'RIN`). Ko'rishi bor ishtirokchi
-- 3 tadan kam bo'lsa — g'olib o'ylab topilmaydi.
--
-- TARIX MUZLATILADI: `daily_challenge_results` yakunlash paytidagi
-- natijani saqlaydi; keyingi ko'rishlar uni o'zgartirmaydi.
--
-- FORWARD-ONLY.
-- =========================================================================

create table if not exists public.daily_challenges (
  challenge_date date primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Ko'rishi bor ishtirokchilar soni (yakunlash paytida).
  participants integer not null default 0,
  finalized_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

comment on table public.daily_challenges is
  'Yakunlangan kunlik Premium Challenge''lar. Qator faqat 19:00 dan keyin, '
  'finalize_daily_challenge() orqali yoziladi.';

create table if not exists public.daily_challenge_results (
  challenge_date date not null references public.daily_challenges(challenge_date) on delete restrict,
  position integer not null check (position between 1 and 10),
  candidate_id uuid not null references public.candidates(id) on delete restrict,
  views integer not null check (views > 0),
  reached_at timestamptz not null,
  reward_days integer not null default 0 check (reward_days in (0, 10, 20, 30)),
  /*
   * granted   — VIP berildi;
   * duplicate — oldin berilgan (qayta urinish);
   * no_account— nomzodda akkaunt yo'q (VIP akkauntga beriladi);
   * none      — sovrinli o'rin emas.
   */
  reward_status text not null check (reward_status in ('granted', 'duplicate', 'no_account', 'none')),
  grant_id uuid references public.vip_grants(id) on delete restrict,
  primary key (challenge_date, position),
  unique (challenge_date, candidate_id)
);

create index if not exists idx_daily_challenge_results_candidate
  on public.daily_challenge_results (candidate_id, challenge_date desc);

alter table public.daily_challenges enable row level security;
alter table public.daily_challenge_results enable row level security;
revoke all on table public.daily_challenges from anon, authenticated;
revoke all on table public.daily_challenge_results from anon, authenticated;

/*
 * O'QISH SERVER ORQALI (service_role). Natijalar ommaviy sahifada
 * ko'rsatiladi, lekin jadvalni brauzerga ochish shart emas.
 */

-- O'ZGARMAS: yakunlangan natija jim o'zgarmasin.
create or replace function public.daily_challenge_frozen()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Yakunlangan challenge natijasi o''zgarmas';
end;
$$;

drop trigger if exists trg_daily_challenges_frozen on public.daily_challenges;
create trigger trg_daily_challenges_frozen
  before update or delete on public.daily_challenges
  for each row execute function public.daily_challenge_frozen();

drop trigger if exists trg_daily_challenge_results_frozen on public.daily_challenge_results;
create trigger trg_daily_challenge_results_frozen
  before update or delete on public.daily_challenge_results
  for each row execute function public.daily_challenge_frozen();

/* ====================================================================== *
 * OYNA VA JORIY NATIJA
 * ====================================================================== */

create or replace function public.daily_challenge_window(p_date date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
-- `stable`, `immutable` emas: vaqt zonasi ma'lumotlari (tzdata) yangilanishi mumkin.
stable
as $$
  select ((p_date + time '09:00') at time zone 'Asia/Tashkent'),
         ((p_date + time '19:00') at time zone 'Asia/Tashkent');
$$;

create or replace function public.daily_challenge_standings(p_date date, p_limit integer default 10)
returns table (place bigint, candidate_id uuid, views bigint, reached_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with w as (select * from public.daily_challenge_window(p_date)),
  v as (
    select pv.candidate_id, count(*) as views, max(pv.created_at) as reached_at
      from public.profile_views pv, w
     where pv.is_counted
       and pv.created_at >= w.starts_at
       and pv.created_at < w.ends_at
     group by pv.candidate_id
  ),
  eligible as (
    select v.*
      from v
      join public.candidates c on c.id = v.candidate_id, w
     where c.status = 'published'
       and c.deleted_at is null
       and c.published_at is not null
       and c.published_at < w.starts_at
  )
  select row_number() over (order by e.views desc, e.reached_at asc, e.candidate_id asc) as place,
         e.candidate_id, e.views, e.reached_at
    from eligible e
   order by place
   -- Ochiq sahifa 10–20 so'raydi; ishtirokchilar sonini sanash uchun katta chegara.
   limit greatest(1, least(coalesce(p_limit, 10), 100000));
$$;

revoke all on function public.daily_challenge_standings(date, integer) from public, anon, authenticated;
grant execute on function public.daily_challenge_standings(date, integer) to service_role;

/* ====================================================================== *
 * YAKUNLASH — BIR MARTA, BITTA TRANZAKSIYADA
 * ====================================================================== */

create or replace function public.finalize_daily_challenge(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_row record;
  v_days integer;
  v_profile uuid;
  v_grant jsonb;
  v_status text;
  v_grant_id uuid;
  v_participants integer;
  v_winners jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('daily_challenge:' || p_date::text, 0));

  if exists (select 1 from public.daily_challenges where challenge_date = p_date) then
    return jsonb_build_object('finalized', false, 'already', true, 'date', p_date);
  end if;

  select w.starts_at, w.ends_at into v_start, v_end from public.daily_challenge_window(p_date) w;
  if now() < v_end then
    raise exception 'Bellashuv hali tugamagan (%)', v_end using errcode = '22023';
  end if;

  select count(*) into v_participants from public.daily_challenge_standings(p_date, 100000);

  insert into public.daily_challenges (challenge_date, starts_at, ends_at, participants)
  values (p_date, v_start, v_end, v_participants);

  for v_row in select * from public.daily_challenge_standings(p_date, 10) loop
    v_days := case v_row.place when 1 then 30 when 2 then 20 when 3 then 10 else 0 end;
    v_grant_id := null;

    select c.user_id into v_profile
      from public.candidates c
      join public.profiles p on p.id = c.user_id
     where c.id = v_row.candidate_id;

    if v_days = 0 then
      v_status := 'none';
    elsif v_profile is null then
      v_status := 'no_account';
    else
      v_grant := public.vip_grant_days(
        v_profile, v_days, 'daily_challenge',
        p_date::text || ':' || v_row.place,
        'daily-challenge:' || p_date::text || ':' || v_row.place,
        null,
        format('Kunlik Premium Challenge %s — %s-o''rin', to_char(p_date, 'DD.MM.YYYY'), v_row.place)
      );
      v_status := case when (v_grant ->> 'duplicate')::boolean then 'duplicate' else 'granted' end;
      v_grant_id := (v_grant ->> 'grant_id')::uuid;
    end if;

    insert into public.daily_challenge_results
      (challenge_date, position, candidate_id, views, reached_at, reward_days, reward_status, grant_id)
    values
      (p_date, v_row.place, v_row.candidate_id, v_row.views, v_row.reached_at,
       case when v_status in ('granted', 'duplicate', 'no_account') then v_days else 0 end,
       v_status, v_grant_id);

    if v_days > 0 then
      v_winners := v_winners || jsonb_build_object(
        'place', v_row.place, 'candidate_id', v_row.candidate_id, 'profile_id', v_profile,
        'views', v_row.views, 'days', v_days, 'status', v_status
      );
    end if;
  end loop;

  return jsonb_build_object(
    'finalized', true, 'date', p_date, 'participants', v_participants, 'winners', v_winners
  );
end;
$$;

revoke all on function public.finalize_daily_challenge(date) from public, anon, authenticated;
grant execute on function public.finalize_daily_challenge(date) to service_role;
