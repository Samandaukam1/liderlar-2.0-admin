-- =========================================================================
-- VIP KUNLARI — YAGONA BERISH XIZMATI
--
-- Endi VIP muddati UCH manbadan keladi:
--   admin           — qo'lda uzaytirish;
--   daily_challenge — Kunlik Premium Challenge g'oliblari (30/20/10 kun);
--   referral        — promo kod orqali kelgan nomzod chop etilganda (+10 kun,
--                     ko'pi bilan 30).
-- Har biri `current_period_end` ni o'zicha yozsa, ular bir-birini bosib
-- ketardi (masalan, mukofot admin uzaytirgan muddatni qisqartirib qo'yardi).
-- Shu sabab BITTA funksiya: `vip_grant_days`.
--
-- KAFOLATLAR:
--   · IDEMPOTENT — `vip_grants.idempotency_key` unikal: cron qayta yurganda
--     yoki so'rov takrorlanganda ikkinchi marta kun QO'SHILMAYDI;
--   · NAVBAT — profil bo'yicha `pg_advisory_xact_lock`: ikki mukofot bir
--     vaqtda kelsa ham, ikkalasi ham qo'shiladi, biri ikkinchisini bosmaydi;
--   · HECH QACHON QISQARTIRMAYDI — faol VIP tugash sanasidan uzaytiriladi;
--     faol bo'lmasa — hozirdan boshlab yoqiladi;
--   · ADMIN TO'XTATGAN obuna (`suspended`) to'xtatilganicha qoladi — kunlar
--     qo'shiladi, lekin avtomatik mukofot admin qarorini bekor qilmaydi;
--   · Har o'zgarish `vip_subscription_events` ga (mavjud tarix) va
--     `vip_grants` ga (manba bilan) yoziladi.
--
-- FORWARD-ONLY.
-- =========================================================================

create table if not exists public.vip_grants (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null references public.profiles(id) on delete restrict,
  subscription_id uuid not null references public.vip_subscriptions(id) on delete restrict,

  days integer not null check (days between 1 and 3650),

  source text not null check (source in ('admin', 'daily_challenge', 'referral')),
  -- Manba obyekti: challenge sanasi/o'rni, atributsiya id si va h.k.
  source_id text,

  idempotency_key text not null unique check (char_length(btrim(idempotency_key)) > 0),

  -- Muddatsiz obunada ikkalasi ham `null`.
  period_end_before timestamptz,
  period_end_after timestamptz,

  actor_id uuid references auth.users(id) on delete set null,
  reason text,

  created_at timestamptz not null default now()
);

create index if not exists idx_vip_grants_profile on public.vip_grants (profile_id, created_at desc);
create index if not exists idx_vip_grants_source on public.vip_grants (source, created_at desc);

comment on table public.vip_grants is
  'VIP kunlari berilishi tarixi (admin / kunlik challenge / referal). '
  'Faqat vip_grant_days() yozadi; o''zgarmas.';

-- O'ZGARMAS: berilgan kun tarixdan o'chirilmaydi va tahrirlanmaydi.
create or replace function public.vip_grants_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vip_grants o''zgarmas: tuzatish faqat yangi yozuv bilan';
end;
$$;

drop trigger if exists trg_vip_grants_append_only on public.vip_grants;
create trigger trg_vip_grants_append_only
  before update or delete on public.vip_grants
  for each row execute function public.vip_grants_append_only();

alter table public.vip_grants enable row level security;
revoke insert, update, delete, truncate on table public.vip_grants from anon, authenticated;

-- A'zo O'Z tarixini ko'radi (kabinetdagi "VIP tarixi"); admin — hammasini.
drop policy if exists "member reads own vip grants" on public.vip_grants;
create policy "member reads own vip grants"
  on public.vip_grants for select
  to authenticated
  using (profile_id = auth.uid());

drop policy if exists "admins read vip grants" on public.vip_grants;
create policy "admins read vip grants"
  on public.vip_grants for select
  to authenticated
  using (public.has_permission('vip.view'));

/* ====================================================================== *
 * BERISH
 * ====================================================================== */

create or replace function public.vip_grant_days(
  p_profile_id uuid,
  p_days integer,
  p_source text,
  p_source_id text,
  p_idempotency_key text,
  p_actor_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.vip_grants;
  v_sub public.vip_subscriptions;
  v_have boolean := false;
  v_now timestamptz := now();
  v_before timestamptz;
  v_after timestamptz;
  v_grant_id uuid;
  v_event text;
  v_from text;
  v_to text;
  v_meta jsonb;
begin
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'Kun soni noto''g''ri: %', p_days using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('admin', 'daily_challenge', 'referral') then
    raise exception 'Manba noto''g''ri: %', p_source using errcode = '22023';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Takrorlanmaslik kaliti majburiy' using errcode = '22023';
  end if;

  -- Profil bo'yicha navbat: parallel mukofotlar bir-birini bosib ketmasin.
  perform pg_advisory_xact_lock(hashtextextended('vip_grant:' || p_profile_id::text, 0));

  select * into v_existing from public.vip_grants where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'granted', false, 'duplicate', true, 'grant_id', v_existing.id,
      'subscription_id', v_existing.subscription_id, 'period_end', v_existing.period_end_after
    );
  end if;

  select * into v_sub
    from public.vip_subscriptions
   where profile_id = p_profile_id
     and state in ('pending', 'active', 'grace_period', 'suspended')
   for update;
  v_have := found;

  /*
   * Faol holatda qolgan, lekin muddati o'tgan obuna (fon vazifasi hali
   * yopmagan) — avval yopiladi, tarix to'g'ri qolsin; keyin yangisi.
   */
  if v_have and v_sub.state in ('active', 'grace_period')
     and v_sub.current_period_end is not null
     and coalesce(v_sub.grace_until, v_sub.current_period_end) <= v_now then
    update public.vip_subscriptions set state = 'expired' where id = v_sub.id;
    insert into public.vip_subscription_events
      (subscription_id, profile_id, event, from_state, to_state, reason, actor_id, metadata)
    values
      (v_sub.id, p_profile_id, 'expired', v_sub.state, 'expired',
       'Muddat tugagan — yangi VIP berishdan oldin yopildi', null, '{}'::jsonb);
    v_have := false;
  end if;

  v_meta := jsonb_build_object('source', p_source, 'source_id', p_source_id, 'days', p_days);

  if v_have and v_sub.state in ('active', 'grace_period') and v_sub.current_period_end is null then
    -- Muddatsiz obuna: qo'shadigan narsa yo'q, lekin berilgani qayd etiladi.
    v_before := null; v_after := null;
    v_event := null;

  elsif v_have and v_sub.state in ('active', 'grace_period') then
    v_before := v_sub.current_period_end;
    v_after := v_sub.current_period_end + make_interval(days => p_days);
    update public.vip_subscriptions
       set state = 'active', current_period_end = v_after, grace_until = null
     where id = v_sub.id;
    v_event := 'extended'; v_from := v_sub.state; v_to := 'active';

  elsif v_have and v_sub.state = 'suspended' then
    -- Admin to'xtatgan: kunlar saqlanadi, holat o'zgarmaydi.
    v_before := v_sub.current_period_end;
    v_after := greatest(coalesce(v_sub.current_period_end, v_now), v_now) + make_interval(days => p_days);
    update public.vip_subscriptions
       set current_period_end = v_after, grace_until = null
     where id = v_sub.id;
    v_event := 'extended'; v_from := 'suspended'; v_to := 'suspended';

  elsif v_have and v_sub.state = 'pending' then
    v_before := null;
    v_after := v_now + make_interval(days => p_days);
    update public.vip_subscriptions
       set state = 'active', started_at = v_now, current_period_end = v_after, grace_until = null
     where id = v_sub.id;
    v_event := 'activated'; v_from := 'pending'; v_to := 'active';

  else
    v_before := null;
    v_after := v_now + make_interval(days => p_days);
    insert into public.vip_subscriptions
      (profile_id, plan_code, state, started_at, current_period_end, grace_until, created_by)
    values
      (p_profile_id, 'LIDERLAR_VIP', 'active', v_now, v_after, null, p_actor_id)
    returning * into v_sub;
    insert into public.vip_subscription_events
      (subscription_id, profile_id, event, from_state, to_state, reason, actor_id, metadata)
    values
      (v_sub.id, p_profile_id, 'created', null, 'active', null, p_actor_id, v_meta);
    v_event := 'activated'; v_from := null; v_to := 'active';
  end if;

  insert into public.vip_grants
    (profile_id, subscription_id, days, source, source_id, idempotency_key,
     period_end_before, period_end_after, actor_id, reason)
  values
    (p_profile_id, v_sub.id, p_days, p_source, p_source_id, p_idempotency_key,
     v_before, v_after, p_actor_id, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_grant_id;

  if v_event is not null then
    insert into public.vip_subscription_events
      (subscription_id, profile_id, event, from_state, to_state, reason, actor_id, metadata)
    values
      (v_sub.id, p_profile_id, v_event, v_from, v_to,
       nullif(btrim(coalesce(p_reason, '')), ''), p_actor_id,
       v_meta || jsonb_build_object('grant_id', v_grant_id));
  end if;

  return jsonb_build_object(
    'granted', true, 'duplicate', false, 'grant_id', v_grant_id,
    'subscription_id', v_sub.id, 'period_end_before', v_before, 'period_end', v_after
  );
end;
$$;

revoke all on function public.vip_grant_days(uuid, integer, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.vip_grant_days(uuid, integer, text, text, text, uuid, text)
  to service_role;

/* ====================================================================== *
 * REFERAL MUKOFOTI — +10 KUN, KO'PI BILAN 30 (3 ta chop etilgan tavsiya)
 *
 * Egasining qoidasi (2026-10-04): 1 ta -> jami 10, 2 ta -> 20, 3+ -> 30.
 * Ya'ni har yangi chop etilgan tavsiya +10, cheklov 3 ta berish. Bosqich
 * bonuslari (10+20+30=60) EMAS.
 *
 * Tekshiruvlar BAZADA (brauzerdan kelgan hech narsaga ishonilmaydi):
 *   · atributsiya shu taklifchiniki;
 *   · nomzod HOZIR chop etilgan va o'chirilmagan;
 *   · o'ziga o'zi tavsiya emas;
 *   · shu NOMZOD uchun boshqa atributsiya orqali mukofot berilmagan.
 * ====================================================================== */

create or replace function public.vip_grant_referral_reward(
  p_referrer_profile_id uuid,
  p_attribution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := 'referral-vip:' || p_attribution_id::text;
  v_candidate uuid;
  v_status text;
  v_deleted timestamptz;
  v_owner uuid;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('vip_grant:' || p_referrer_profile_id::text, 0));

  if exists (select 1 from public.vip_grants where idempotency_key = v_key) then
    return jsonb_build_object('granted', false, 'duplicate', true);
  end if;

  select a.candidate_id, c.status, c.deleted_at, c.user_id
    into v_candidate, v_status, v_deleted, v_owner
    from public.referral_attributions a
    join public.candidates c on c.id = a.candidate_id
   where a.id = p_attribution_id
     and a.referrer_profile_id = p_referrer_profile_id;

  if v_candidate is null then
    return jsonb_build_object('granted', false, 'reason', 'no_candidate');
  end if;
  if v_status <> 'published' or v_deleted is not null then
    return jsonb_build_object('granted', false, 'reason', 'not_published');
  end if;
  if v_owner is not null and v_owner = p_referrer_profile_id then
    return jsonb_build_object('granted', false, 'reason', 'self_referral');
  end if;

  if exists (
    select 1
      from public.vip_grants g
      join public.referral_attributions a2 on a2.id::text = g.source_id
     where g.source = 'referral' and a2.candidate_id = v_candidate
  ) then
    return jsonb_build_object('granted', false, 'reason', 'candidate_already_rewarded');
  end if;

  select count(*) into v_count
    from public.vip_grants
   where profile_id = p_referrer_profile_id and source = 'referral';
  if v_count >= 3 then
    return jsonb_build_object('granted', false, 'reason', 'capped');
  end if;

  return public.vip_grant_days(
    p_referrer_profile_id, 10, 'referral', p_attribution_id::text, v_key, null,
    'Promo-kod orqali taklif qilingan nomzod chop etildi'
  );
end;
$$;

revoke all on function public.vip_grant_referral_reward(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vip_grant_referral_reward(uuid, uuid) to service_role;

create index if not exists idx_referral_attributions_candidate
  on public.referral_attributions (candidate_id)
  where candidate_id is not null;
