-- =========================================================================
-- VIP — ADMIN QO'LDA BOSHQARADI (avtomatik to'lov yo'q)
--
-- 1. IMTIYOZ (GRACE) DAVRI OLIB TASHLANADI.
--
--    Egasining qarori (2026-10-03): `expires_at` kelganda VIP imkoniyatlari
--    YOPILADI. Tarifdagi 14 kunlik imtiyoz bunga zid edi — huquq tugash
--    sanasidan keyin yana ikki hafta ochiq qolardi. To'lov avtomatik
--    emas, admin muddatni o'zi uzaytiradi, ya'ni "to'lov kechikdi"
--    holatini yumshatuvchi imtiyozga ehtiyoj yo'q.
--
--    Huquq tekshiruvi `coalesce(grace_until, current_period_end)` ga
--    qaraydi: `grace_until` bo'sh bo'lsa, kirish aynan tugash sanasida
--    yopiladi. Bu yangilash hech qanday obunani o'zgartirmaydi
--    (production'da obuna yo'q) — faqat keyingilarini.
--
-- 2. VIP BERISH — BITTA TRANZAKSIYADA, ADMIN SANALARI BILAN.
--
--    Avval: `vip_create_subscription` (pending) + `vip_apply_transition`
--    (activate, muddat tarifdan va "hozir"dan). Admin esa boshlanish va
--    tugash sanasini O'ZI belgilaydi (30/90/180/365 kun yoki aniq sana).
--    Ikki alohida chaqiruvda ikkinchisi yiqilsa, obuna `pending` holda
--    osilib qolardi — shu sabab bitta funksiya.
--
-- FORWARD-ONLY.
-- =========================================================================

update public.vip_plans
   set grace_days = 0
 where code = 'LIDERLAR_VIP'
   and grace_days <> 0;

create or replace function public.vip_admin_grant(
  p_profile_id uuid,
  p_plan_code text,
  p_started_at timestamptz,
  p_period_end timestamptz,
  p_reason text,
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
  /*
   * SANALAR BAZADA HAM TEKSHIRILADI — ilova tekshiruvidan mustaqil.
   *
   *   · boshlanish kelajakda emas: kelajakdagi boshlanish huquqni
   *     DARHOL berib qo'yardi (huquq tekshiruvi `started_at` ga
   *     qaramaydi). 5 daqiqa — soatlar farqi uchun;
   *   · tugash kelajakda: o'tgan sana bilan berilgan VIP darhol
   *     "tugagan" bo'lib, admin "yoqdim" deb o'ylab qolardi;
   *   · tugash boshlanishdan keyin.
   */
  if p_started_at is null or p_period_end is null then
    raise exception 'Boshlanish va tugash sanasi majburiy' using errcode = '22023';
  end if;
  if p_started_at > now() + interval '5 minutes' then
    raise exception 'Boshlanish sanasi kelajakda bo''lmasin' using errcode = '22023';
  end if;
  if p_period_end <= now() then
    raise exception 'Tugash sanasi kelajakda bo''lishi kerak' using errcode = '22023';
  end if;
  if p_period_end <= p_started_at then
    raise exception 'Tugash sanasi boshlanishdan keyin bo''lishi kerak' using errcode = '22023';
  end if;

  /*
   * Ochiq obuna bo'lsa — `uq_vip_subscription_open` 23505 qaytaradi.
   * Ilova uni "allaqachon faol — uzaytiring" deb tushuntiradi.
   */
  insert into public.vip_subscriptions (
    profile_id, plan_code, state, started_at, current_period_end, grace_until, created_by
  )
  values (
    p_profile_id, p_plan_code, 'active', p_started_at, p_period_end, null, p_actor_id
  )
  returning * into v_row;

  insert into public.vip_subscription_events (
    subscription_id, profile_id, event, from_state, to_state, reason, actor_id, metadata
  )
  values
    (v_row.id, p_profile_id, 'created', null, 'active', null, p_actor_id, '{}'::jsonb),
    (
      v_row.id, p_profile_id, 'activated', null, 'active',
      nullif(btrim(coalesce(p_reason, '')), ''), p_actor_id,
      jsonb_build_object('started_at', p_started_at, 'current_period_end', p_period_end)
    );

  return v_row;
end;
$$;

revoke all on function public.vip_admin_grant(uuid, text, timestamptz, timestamptz, text, uuid)
  from public, anon, authenticated;
grant execute on function public.vip_admin_grant(uuid, text, timestamptz, timestamptz, text, uuid)
  to service_role;

comment on function public.vip_admin_grant is
  'Admin VIP beradi: obuna darhol `active`, admin bergan sanalar bilan, '
  'tarix yozuvlari bilan bitta tranzaksiyada. Faqat service_role.';
