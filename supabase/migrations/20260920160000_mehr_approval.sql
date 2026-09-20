-- ============================================================
-- MEHR 365+ — TASDIQLASH TRANZAKSIYASI (§27)
--
-- NEGA POSTGRES FUNKSIYASI, JS EMAS.
--
-- Tasdiq bir vaqtning o'zida 6 ta narsani qiladi: holatni
-- o'zgartiradi, ishtirokni muzlatadi, ball yozadi, sertifikat
-- beradi, jamlanmani yangilaydi va xabar yuboradi.
--
-- JS'da bular 6 ta alohida so'rov bo'lardi. To'rtinchisida
-- tarmoq uzilsa, odamlarda ball bo'lib, sertifikat bo'lmasdi —
-- va tizim buni o'zi ham bilmasdi. Bitta funksiya esa bitta
-- tranzaksiya: yo hammasi bo'ladi, yo hech nima.
--
-- QAYTA ISHGA TUSHIRISH XAVFSIZ: har bir yozuv `on conflict
-- do nothing` bilan tushadi va unikal indekslar ikkinchi
-- nusxaga yo'l bermaydi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. SERTIFIKAT KODI
--
--    Alifboda I, L, O, U yo'q: I/1 va O/0 qo'lda ko'chirishda
--    chalkashadi. TS tomondagi certificate-code.ts bilan bir xil.
-- ------------------------------------------------------------
create or replace function public.mehr_certificate_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  -- 32 ta belgi. 256 unga qoldiqsiz bo'linadi, shuning uchun
  -- modulo siljishi yo'q: har bir belgi teng ehtimollikda.
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  raw bytea;
  body text := '';
  i integer;
begin
  /*
   * random() EMAS, gen_random_bytes().
   *
   * random() bashorat qilinadigan: urug'ini bilgan odam keyingi
   * kodlarni hisoblab chiqa olardi. Sertifikat kodi ommaviy
   * tekshirish manzilining o'zi — u taxmin qilinadigan
   * bo'lmasligi kerak.
   */
  raw := gen_random_bytes(10);

  for i in 0..9 loop
    body := body || substr(alphabet, 1 + (get_byte(raw, i) % 32), 1);
  end loop;

  return 'MEHR-' || body;
end;
$$;

-- ------------------------------------------------------------
-- 2. JAMLANMANI QAYTA HISOBLASH
--
--    Jamlanma HECH QACHON qo'lda o'zgartirilmaydi — u har safar
--    daftardan qayta hisoblanadi. Shuning uchun u va daftar
--    bir-biridan ajralib keta olmaydi.
--
--    Davr chegarasi Toshkent vaqti bo'yicha: UTC bilan hisoblansa,
--    5-soatlik farq tufayli oyning birinchi kunidagi ish o'tgan
--    oyga tushib qolardi.
-- ------------------------------------------------------------
create or replace function public.recompute_point_aggregates(p_profile_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_profile_ids is null or array_length(p_profile_ids, 1) is null then
    return;
  end if;

  insert into public.point_aggregates (profile_id, period, period_key, category, total_points, updated_at)
  select
    l.profile_id,
    g.period,
    g.period_key,
    g.category,
    sum(l.points)::integer,
    now()
  from public.point_ledger l
  cross join lateral (
    values
      ('all',   'all',                                                              l.category),
      ('all',   'all',                                                              'total'),
      ('year',  to_char(l.created_at at time zone 'Asia/Tashkent', 'YYYY'),         l.category),
      ('year',  to_char(l.created_at at time zone 'Asia/Tashkent', 'YYYY'),         'total'),
      ('month', to_char(l.created_at at time zone 'Asia/Tashkent', 'YYYY-MM'),      l.category),
      ('month', to_char(l.created_at at time zone 'Asia/Tashkent', 'YYYY-MM'),      'total')
  ) as g(period, period_key, category)
  where l.profile_id = any(p_profile_ids)
  group by l.profile_id, g.period, g.period_key, g.category
  on conflict (profile_id, period, period_key, category)
  do update set total_points = excluded.total_points, updated_at = now();
end;
$$;

-- ------------------------------------------------------------
-- 3. TASDIQLASH
-- ------------------------------------------------------------
create or replace function public.mehr_approve_activity(
  p_activity_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_activity public.mehr_activities%rowtype;
  v_transitioned boolean := false;
  v_frozen integer := 0;
  v_points_added integer := 0;
  v_certs_added integer := 0;
  v_profiles uuid[];
  v_slug text;
begin
  -- Bir vaqtda ikki admin bosishi mumkin: qatorni qulflaymiz.
  select * into v_activity
  from public.mehr_activities
  where id = p_activity_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_activity.status not in ('submitted', 'approved') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_state', 'status', v_activity.status);
  end if;

  /*
   * HOLAT O'TISHI — FAQAT BIR MARTA.
   *
   * Xabarnomalar aynan shunga bog'lanadi: qayta chaqirilganda
   * o'tish bo'lmaydi va odamlar ikkinchi marta bezovta
   * qilinmaydi. Ball va sertifikat esa baribir tekshiriladi —
   * shunda avvalgi yugurish yarim qolgan bo'lsa, tuzatiladi.
   */
  if v_activity.status = 'submitted' then
    v_slug := coalesce(
      v_activity.slug,
      regexp_replace(lower(v_activity.title), '[^a-z0-9]+', '-', 'g') || '-' || left(replace(p_activity_id::text, '-', ''), 8)
    );

    update public.mehr_activities
       set status = 'approved',
           approved_at = now(),
           reviewed_at = now(),
           reviewed_by = p_actor_user_id,
           slug = v_slug
     where id = p_activity_id;

    v_transitioned := true;

    insert into public.mehr_reviews (activity_id, action, actor_user_id)
    values (p_activity_id, 'approved', p_actor_user_id);
  end if;

  -- Ishtirok ro'yxatini muzlatamiz (§27.2).
  update public.mehr_participants
     set frozen_at = now()
   where activity_id = p_activity_id
     and status = 'checked_in'
     and frozen_at is null;
  get diagnostics v_frozen = row_count;

  -- Ball. Takrorlanmaslik kaliti bo'yicha unikal indeks himoya qiladi.
  with inserted as (
    insert into public.point_ledger (
      profile_id, rule_code, category, source_type, source_id,
      points, idempotency_key, created_by
    )
    select
      p.profile_id,
      r.code,
      r.category,
      'mehr_activity',
      p_activity_id,
      r.points,
      'mehr_activity:' || p_activity_id || ':' || p.role || ':' || p.profile_id,
      p_actor_user_id
    from public.mehr_participants p
    join public.point_rules r
      on r.code = case p.role
           when 'participant'  then 'mehr.participant'
           when 'co_organizer' then 'mehr.co_organizer'
           when 'organizer'    then 'mehr.organizer'
         end
     and r.is_active
    where p.activity_id = p_activity_id
      and p.status = 'checked_in'
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*)::integer into v_points_added from inserted;

  -- Sertifikat. Bitta tadbir + odam + rol = bitta sertifikat.
  with inserted as (
    insert into public.certificates (code, recipient_profile_id, kind, activity_id, role)
    select
      public.mehr_certificate_code(),
      p.profile_id,
      'mehr_activity',
      p_activity_id,
      p.role
    from public.mehr_participants p
    where p.activity_id = p_activity_id
      and p.status = 'checked_in'
    on conflict (activity_id, recipient_profile_id, role) where activity_id is not null
    do nothing
    returning 1
  )
  select count(*)::integer into v_certs_added from inserted;

  select array_agg(distinct profile_id) into v_profiles
  from public.mehr_participants
  where activity_id = p_activity_id and status = 'checked_in';

  perform public.recompute_point_aggregates(v_profiles);

  /*
   * XABARNOMA — FAQAT HAQIQIY O'TISHDA.
   *
   * Bu jadvalda takrorlanmaslik kaliti yo'q, shuning uchun
   * dedupe holat o'tishining o'ziga bog'landi: qayta chaqiruvda
   * o'tish bo'lmaydi va ikkinchi xabar ketmaydi.
   */
  if v_transitioned and v_profiles is not null then
    insert into public.notifications (recipient_id, title, body, kind, link)
    select
      p.profile_id,
      'Ezgulik ishingiz tasdiqlandi',
      v_activity.title || ' — ball va sertifikat hisobingizga qo''shildi.',
      'mehr',
      '/mehr/ezgulik/' || v_slug
    from public.mehr_participants p
    where p.activity_id = p_activity_id and p.status = 'checked_in';
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', case when v_transitioned then 'approved' else 'already_approved' end,
    'transitioned', v_transitioned,
    'frozen_participants', v_frozen,
    'points_created', v_points_added,
    'certificates_created', v_certs_added,
    'slug', coalesce(v_slug, v_activity.slug)
  );
end;
$$;

/*
 * ============================================================
 * IJRO HUQUQI — FAQAT SERVERGA
 *
 * PostgREST public sxemadagi funksiyalarni HTTP orqali ochadi.
 * Agar huquq olib tashlanmasa, tizimga kirgan istalgan
 * foydalanuvchi o'z tadbirini o'zi tasdiqlab, o'ziga ball va
 * sertifikat yozib olardi — butun ishonch zanjirini chetlab.
 * ============================================================
 */
revoke all on function public.mehr_approve_activity(uuid, uuid) from public;
revoke all on function public.mehr_approve_activity(uuid, uuid) from anon;
revoke all on function public.mehr_approve_activity(uuid, uuid) from authenticated;
grant execute on function public.mehr_approve_activity(uuid, uuid) to service_role;

revoke all on function public.recompute_point_aggregates(uuid[]) from public;
revoke all on function public.recompute_point_aggregates(uuid[]) from anon;
revoke all on function public.recompute_point_aggregates(uuid[]) from authenticated;
grant execute on function public.recompute_point_aggregates(uuid[]) to service_role;

revoke all on function public.mehr_certificate_code() from public;
revoke all on function public.mehr_certificate_code() from anon;
revoke all on function public.mehr_certificate_code() from authenticated;
grant execute on function public.mehr_certificate_code() to service_role;
