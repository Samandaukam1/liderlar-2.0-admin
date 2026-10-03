-- =========================================================================
-- POYGA XATOLARI UCHUN TO'G'RI KOD — CHEKSIZ QAYTA URINISHNING OLDINI OLISH
--
-- MUAMMO: ikki funksiya (`vip_apply_transition`,
-- `apply_candidate_profile_edit`) "holat o'zgargan" degan BIZNES
-- holatini `serialization_failure` (SQLSTATE 40001) bilan bildirardi.
--
-- 40001 va 40P01 — PostgreSQL'ning HAQIQIY parallellik xatolari uchun
-- ajratilgan kodlar. PostgREST ularni o'tkinchi deb hisoblaydi va
-- tranzaksiyani O'ZI QAYTA URINADI. Bizning holatimizda shart
-- deterministik: obuna haqiqatan boshqa holatda, tahrir haqiqatan
-- allaqachon ko'rilgan — qayta urinish har safar xuddi shu xatoga
-- uriladi. Natija: so'rov osilib qoladi, ulanish band, log to'ladi
-- (supabase/agent-skills#617 da tasvirlangan hodisaning aynan o'zi).
-- Admin "Tasdiqlash" ni bosganda tugma javobsiz qotib qolardi.
--
-- YECHIM: `PT409` — PostgREST'ning maxsus kodi. U HTTP 409 Conflict
-- sifatida qaytadi, qayta urinilmaydi va ilova uni `error.code`
-- orqali aniq taniydi.
--
-- QO'SHIMCHA: `vip_apply_transition` ga versiya sharti
-- (`p_expected_updated_at`). Faqat holatni solishtirish yetmaydi:
-- fon vazifasi `active` obunani o'qib bo'lgach, admin uni uzaytirsa
-- (holat yana `active`), vazifa ESKI sanalar bilan yozib, uzaytirishni
-- jimgina yo'q qilardi. `updated_at` har yozuvda trigger orqali
-- yangilanadi, ya'ni u qatorning haqiqiy versiyasi.
--
-- FORWARD-ONLY. Ma'lumotga tegilmaydi.
-- =========================================================================

/* ====================================================================== *
 * 1. VIP OBUNA O'TISHI
 *
 *    Imzo O'ZGARADI (yangi parametr), shuning uchun eski funksiya
 *    O'CHIRILADI. `create or replace` yangi imzo bilan ikkinchi
 *    funksiyani yonida yaratib qo'yardi va PostgREST nomlangan
 *    parametrlar bo'yicha ikkisidan birini tanlay olmay, xato
 *    qaytarardi.
 *
 *    Yangi parametr ixtiyoriy (`default null`): migratsiya kod
 *    deploy'idan oldin qo'llansa ham eski kod ishlayveradi.
 * ====================================================================== */

drop function if exists public.vip_apply_transition(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz, text, uuid, jsonb
);

create or replace function public.vip_apply_transition(
  p_subscription_id uuid,
  -- Chaqiruvchi KUTGAN joriy holat. Mos kelmasa, amal bajarilmaydi.
  p_expected_state text,
  p_new_state text,
  p_event text,
  p_started_at timestamptz,
  p_current_period_end timestamptz,
  p_grace_until timestamptz,
  p_reason text,
  p_actor_id uuid,
  p_metadata jsonb default '{}'::jsonb,
  -- Chaqiruvchi o'qigan qator versiyasi. `null` — tekshirilmaydi.
  p_expected_updated_at timestamptz default null
)
returns public.vip_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.vip_subscriptions;
  v_after  public.vip_subscriptions;
begin
  -- Qatorni band qilamiz: parallel amal shu yerda navbat kutadi.
  select * into v_before
  from public.vip_subscriptions
  where id = p_subscription_id
  for update;

  if not found then
    raise exception 'Obuna topilmadi: %', p_subscription_id
      using errcode = 'no_data_found';
  end if;

  /*
   * OPTIMISTIK TEKSHIRUV — holat VA versiya.
   *
   * Kod `PT409`: HTTP 409, qayta urinilmaydi (yuqoridagi izohga qarang).
   */
  if v_before.state <> p_expected_state
     or (p_expected_updated_at is not null
         and v_before.updated_at is distinct from p_expected_updated_at) then
    raise exception
      'Obuna holati o''zgargan: kutilgani %, hozirgisi %',
      p_expected_state, v_before.state
      using errcode = 'PT409';
  end if;

  update public.vip_subscriptions
  set
    state              = p_new_state,
    started_at         = p_started_at,
    current_period_end = p_current_period_end,
    grace_until        = p_grace_until,
    cancelled_at       = case when p_new_state = 'cancelled'
                              then coalesce(cancelled_at, now()) end,
    suspended_at       = case when p_new_state = 'suspended'
                              then coalesce(suspended_at, now()) end
  where id = p_subscription_id
  returning * into v_after;

  insert into public.vip_subscription_events (
    subscription_id, profile_id, event,
    from_state, to_state, reason, actor_id, metadata
  )
  values (
    p_subscription_id, v_after.profile_id, p_event,
    v_before.state, p_new_state, nullif(trim(coalesce(p_reason, '')), ''),
    p_actor_id, coalesce(p_metadata, '{}'::jsonb)
  );

  return v_after;
end;
$$;

-- Faqat server: `security definer` RLS'ni chetlab o'tadi (§43).
revoke all on function public.vip_apply_transition(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz, text, uuid, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.vip_apply_transition(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz, text, uuid, jsonb, timestamptz
) to service_role;

comment on function public.vip_apply_transition is
  'Obuna holatini va tarix yozuvini bitta tranzaksiyada saqlaydi. Holat '
  'yoki versiya mos kelmasa PT409 (HTTP 409) qaytaradi — qayta '
  'urinilmaydi. Faqat service_role.';

/* ====================================================================== *
 * 2. YANGI OBUNANI TARIXI BILAN BIRGA YARATISH
 *
 *    Avval obuna `insert` qilinib, `created` hodisasi alohida
 *    so'rovda yozilardi va uning xatosi tekshirilmasdi. Ikkinchisi
 *    yiqilsa, obuna tarixsiz qolardi — §37 aynan shuni taqiqlaydi.
 * ====================================================================== */

create or replace function public.vip_create_subscription(
  p_profile_id uuid,
  p_plan_code text,
  p_actor_id uuid
)
returns public.vip_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vip_subscriptions;
begin
  insert into public.vip_subscriptions (profile_id, plan_code, state, created_by)
  values (p_profile_id, p_plan_code, 'pending', p_actor_id)
  returning * into v_row;

  insert into public.vip_subscription_events (
    subscription_id, profile_id, event, from_state, to_state, actor_id
  )
  values (v_row.id, p_profile_id, 'created', null, 'pending', p_actor_id);

  return v_row;
end;
$$;

revoke all on function public.vip_create_subscription(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.vip_create_subscription(uuid, text, uuid)
  to service_role;

comment on function public.vip_create_subscription is
  'Obunani `pending` holatda va `created` tarix yozuvi bilan bitta '
  'tranzaksiyada yaratadi. Ochiq obuna bo''lsa 23505 qaytadi. Faqat service_role.';

/* ====================================================================== *
 * 3. PROFIL TAHRIRINI QO'LLASH
 *
 *    Imzo o'zgarmaydi — faqat xato kodi. `create or replace` yetarli.
 * ====================================================================== */

create or replace function public.apply_candidate_profile_edit(
  p_edit_id uuid,
  p_reviewer_id uuid,
  p_note text default null
)
returns public.candidate_profile_edits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edit public.candidate_profile_edits;
  v_result public.candidate_profile_edits;
begin
  select * into v_edit
  from public.candidate_profile_edits
  where id = p_edit_id
  for update;

  if not found then
    raise exception 'Tahrir topilmadi: %', p_edit_id using errcode = 'no_data_found';
  end if;

  if v_edit.state <> 'pending_review' then
    /*
     * Ikki admin bir vaqtda tasdiqlasa, ikkinchisi shu yerda to'xtaydi.
     * `PT409` — 40001 EMAS: shart deterministik va qayta urinish
     * har safar shu yerga qaytib kelardi.
     */
    raise exception 'Bu tahrir allaqachon ko''rildi: %', v_edit.state
      using errcode = 'PT409';
  end if;

  /*
   * MAYDONLAR RO'YXATI QAT'IY — dinamik SQL yo'q (in'ektsiya imkonsiz).
   * Ro'yxat koddagi `CANDIDATE_FIELDS` ning `review` siyosatidagi
   * maydonlari bilan mos.
   */
  if v_edit.field = 'birth_date' then
    update public.candidates
      set birth_date = nullif(v_edit.after_value, '')::date
      where id = v_edit.candidate_id;

  elsif v_edit.field = 'region_id' then
    update public.candidates
      set region_id = nullif(v_edit.after_value, '')::uuid
      where id = v_edit.candidate_id;

  elsif v_edit.field = 'category_id' then
    update public.candidates
      set category_id = nullif(v_edit.after_value, '')::uuid
      where id = v_edit.candidate_id;

  else
    raise exception 'Bu maydon qo''llanmaydi: %', v_edit.field
      using errcode = 'invalid_parameter_value';
  end if;

  update public.candidate_profile_edits
    set state = 'applied',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        review_note = p_note
    where id = p_edit_id
    returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.apply_candidate_profile_edit(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.apply_candidate_profile_edit(uuid, uuid, text)
  to service_role;
