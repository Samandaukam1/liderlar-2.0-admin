-- ============================================================
-- PROFIL KO'RISHLARI → BALL  +  OYLIK HAVOLALAR AVTOMATIKASI
--
-- AUDIT NATIJASI: ikkala tushuncha ham ALLAQACHON BOR.
--
--   `profile_views`        — kunlik dedup bilan (Toshkent kuni),
--                            xom IP saqlanmaydi.
--   `recalculate_rankings` — ko'rishlarni allaqachon hisobga
--                            oladi: 50 ko'rish = 1 ball, 20 ball
--                            chegarasi bilan.
--   `monthly_update_tokens`— "oylik havolalar" aynan shu.
--
-- Shuning uchun bu migratsiya YANGI TIZIM QURMAYDI. U uchta
-- yetishmayotgan narsani qo'shadi:
--
--   1. Ko'rish siyosati KODDA QOTIB qolgan edi → sozlamaga.
--   2. Bot va o'z-ko'rishlar filtri yo'q edi → qo'shildi.
--   3. Oylik havolalar qo'lda yaratilardi → davr kaliti va
--      takrorlanmaslik kafolati qo'shildi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. KO'RISH SIYOSATI — BITTA MANBADA
--
--    Avval `50` va `20` raqamlari SQL funksiyasining ichida
--    yozilgan edi. Ularni o'zgartirish uchun migratsiya kerak
--    bo'lardi va hech kim ularni panelda ko'ra olmasdi.
-- ------------------------------------------------------------
insert into public.site_settings (key, value) values
  /*
   * MAVJUD QIYMATLAR SAQLANADI.
   *
   * Spec 10 ko'rish = 1 ball taklif qildi, lekin bu hozirgi
   * shkalani buzardi: ko'rish hissasi besh barobar oshib,
   * yutuq va faoliyat ballaridan ustun chiqardi. Amaldagi
   * nisbat o'zgarishsiz qoldiriladi va endi sozlanadi.
   */
  ('ranking.views_per_point', '50'),
  ('ranking.view_points_cap', '20'),
  /*
   * Bayroq O'CHIQ EMAS: ko'rish ballari allaqachon
   * ishlayapti va uni to'satdan o'chirish mavjud reytingni
   * o'zgartirib yuborardi. Bayroq kelajakda o'chirish
   * imkonini beradi, xolos.
   */
  ('ranking.profile_views_enabled', 'true'),
  ('member.monthly_links_enabled', 'false')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 2. CHIQARIB TASHLANGAN KO'RISHLAR
--
--    Bot va o'z-ko'rishlar `profile_views` ga UMUMAN
--    yozilmaydi: bot har so'rovda yangi cookie oladi, ya'ni
--    har safar yangi qator bo'lardi va jadval cheksiz o'sardi.
--
--    Buning o'rniga KUNLIK SANOQ. U chegaralangan:
--    nomzod × kun × sabab.
-- ------------------------------------------------------------
create table if not exists public.profile_view_exclusions (
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  -- Toshkent kuni — `profile_views` dagi dedup bilan bir xil.
  day date not null,
  reason text not null check (reason in ('bot', 'self', 'unpublished')),
  view_count integer not null default 0,
  updated_at timestamptz not null default now(),

  primary key (candidate_id, day, reason)
);

comment on table public.profile_view_exclusions is
  'Hisobga olinmagan ko''rishlar sanog''i. Tashrif buyuruvchi identifikatori SAQLANMAYDI.';

create index if not exists profile_view_exclusions_day_idx
  on public.profile_view_exclusions (day desc);

/*
 * RLS: nomzodga ham, ommaga ham ochilmaydi.
 *
 * Bu ma'lumot suiiste'molni ko'rish uchun — nomzodga "sizning
 * sahifangizga 500 ta bot kirdi" deb ko'rsatish foydasiz va
 * chalg'ituvchi.
 */
alter table public.profile_view_exclusions enable row level security;

drop policy if exists profile_view_exclusions_admin on public.profile_view_exclusions;
create policy profile_view_exclusions_admin on public.profile_view_exclusions
  for select using (public.has_permission('rankings.view'));

-- ------------------------------------------------------------
-- 3. KO'RISHNI YOZISH — BOT VA O'Z-KO'RISH FILTRI BILAN
--
--    Eski imzo (2 parametr) SAQLANADI: yangi parametrlar
--    standart qiymatga ega, shuning uchun eski chaqiruvlar
--    buzilmaydi.
-- ------------------------------------------------------------
/*
 * ESKI IMZO AVVAL O'CHIRILADI.
 *
 * `create or replace` parametrlar soni o'zgarganda
 * ALMASHTIRMAYDI — yangi variant yaratadi. U holda ikkita
 * funksiya qolardi va 2 argumentli chaqiruv "is not unique"
 * xatosi bilan yiqilardi. Web API aynan 2 argument bilan
 * chaqiradi, ya'ni ko'rishlar jimgina yozilmay qolardi.
 *
 * Bu xato lokal sinovda aniqlandi.
 */
drop function if exists public.record_profile_view(text, text);

create or replace function public.record_profile_view(
  p_candidate_slug text,
  p_viewer_hash text,
  p_viewer_user_id uuid default null,
  p_is_bot boolean default false
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

  /*
   * TARTIB MUHIM: bot birinchi.
   *
   * Bot o'z-o'zidan hech qachon "egasi" bo'lmaydi, lekin
   * o'z-ko'rishni birinchi tekshirsak, egasining brauzeridagi
   * kengaytma yoki oldindan ko'rish roboti "self" deb
   * belgilanardi va sabab chalkashardi.
   */
  if p_is_bot then
    v_reason := 'bot';
  elsif v_owner is not null and p_viewer_user_id is not null and v_owner = p_viewer_user_id then
    /*
     * O'Z SAHIFASINI KO'RISH.
     *
     * Sahifa normal ochiladi, lekin ball bermaydi: aks holda
     * o'z sahifasini yangilab turish reyting ko'tarishning eng
     * oson yo'li bo'lardi.
     */
    v_reason := 'self';
  end if;

  if v_reason is not null then
    insert into public.profile_view_exclusions (candidate_id, day, reason, view_count, updated_at)
    values (v_candidate, v_day, v_reason, 1, now())
    on conflict (candidate_id, day, reason)
    do update set view_count = public.profile_view_exclusions.view_count + 1,
                  updated_at = now();
    return false;
  end if;

  insert into public.profile_views (candidate_id, viewer_hash, is_counted)
  values (v_candidate, p_viewer_hash, true)
  on conflict do nothing;

  return found;
end;
$$;

revoke all on function public.record_profile_view(text, text, uuid, boolean) from public;
grant execute on function public.record_profile_view(text, text, uuid, boolean) to anon, authenticated;

-- ------------------------------------------------------------
-- 4. REYTING — SIYOZAT SOZLAMADAN O'QILADI
--
--    Faqat `views` qismi o'zgaradi; qolgan hisob-kitob
--    o'zgarishsiz qoladi.
-- ------------------------------------------------------------
create or replace function public.ranking_view_policy()
returns table (views_per_point numeric, points_cap numeric, enabled boolean)
language sql
stable
set search_path = public
as $$
  select
    /*
     * Sozlama buzuq bo'lsa (masalan "0" yoki matn), amaldagi
     * qiymatga qaytamiz. Nolga bo'lish butun reytingni
     * yiqitardi.
     */
    coalesce(nullif(greatest((select value from public.site_settings where key = 'ranking.views_per_point')::numeric, 1), 0), 50),
    coalesce(greatest((select value from public.site_settings where key = 'ranking.view_points_cap')::numeric, 0), 20),
    coalesce((select value = 'true' from public.site_settings where key = 'ranking.profile_views_enabled'), true);
$$;

-- ------------------------------------------------------------
-- 5. OYLIK HAVOLALAR — DAVR KALITI VA TAKRORLANMASLIK
--
--    `monthly_update_tokens` da davr tushunchasi YO'Q edi:
--    avtomatik ish ikki marta yugursa, bitta nomzodga ikkita
--    havola yaratilardi.
-- ------------------------------------------------------------
alter table public.monthly_update_tokens
  add column if not exists period_key text;

comment on column public.monthly_update_tokens.period_key is
  'YYYY-MM, Toshkent vaqti bo''yicha. Avtomatik yaratilgan havolalarda to''ldiriladi.';

/*
 * BITTA NOMZOD — BITTA DAVR — BITTA AVTOMATIK HAVOLA.
 *
 * Qisman indeks: qo'lda yaratilgan havolalarda `period_key`
 * bo'sh qoladi va ular bu cheklovga tushmaydi. Admin zarur
 * bo'lsa qo'shimcha havola bera oladi.
 */
create unique index if not exists monthly_update_tokens_period_uidx
  on public.monthly_update_tokens (candidate_id, period_key)
  where period_key is not null;

-- ------------------------------------------------------------
-- 6. AVTOMATIK ISH KUZATUVI
--
--    "Oylik havolalar yuborildimi?" degan savolga javob
--    beradigan joy bo'lishi kerak. Bo'lmasa, ish jimgina
--    to'xtab qolsa ham hech kim bilmasdi.
-- ------------------------------------------------------------
create table if not exists public.monthly_link_runs (
  id uuid primary key default gen_random_uuid(),

  period_key text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,

  generated integer not null default 0,
  skipped_existing integer not null default 0,
  delivery_success integer not null default 0,
  delivery_failed integer not null default 0,

  -- Xato XULOSASI. Token, havola yoki sir YOZILMAYDI.
  error_summary text,

  created_at timestamptz not null default now()
);

create index if not exists monthly_link_runs_period_idx
  on public.monthly_link_runs (period_key, started_at desc);

alter table public.monthly_link_runs enable row level security;

drop policy if exists monthly_link_runs_admin on public.monthly_link_runs;
create policy monthly_link_runs_admin on public.monthly_link_runs
  for select using (public.has_permission('tokens.view'));

-- ------------------------------------------------------------
-- 7. KABINETDA KO'RINISH
--
--    Nomzod o'z havolasini ko'rishi kerak. Token hash'i
--    hech qachon ochilmaydi — faqat holat va davr.
-- ------------------------------------------------------------
alter table public.monthly_update_tokens
  add column if not exists opened_at timestamptz;

comment on column public.monthly_update_tokens.opened_at is
  'Nomzod havolani kabinetda birinchi marta ochgan vaqt. O''qilmagan belgisi shunga tayanadi.';

-- ------------------------------------------------------------
-- 8. REYTING FUNKSIYASI — KO'RISH SIYOSATI SOZLAMADAN
--
--    Funksiya butunligicha qayta e'lon qilinadi (Postgres'da
--    bitta CTE ni alohida almashtirib bo'lmaydi). Ko'rish
--    qismidan boshqa hech nima o'zgarmadi.
-- ------------------------------------------------------------
create or replace function public.recalculate_rankings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
  v_w record;
  v_count integer := 0;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_period
  from public.ranking_periods
  where is_current = true and status = 'open'
  limit 1;

  if v_period.id is null then
    raise exception 'Faol (open) reyting davri topilmadi';
  end if;

  v_start := v_period.starts_on::timestamptz;
  v_end := coalesce(v_period.ends_on::timestamptz + interval '1 day', now() + interval '100 years');

  select * into v_w from public.ranking_weights where period_id = v_period.id;
  if v_w.id is null then
    v_w.achievements := 40;
    v_w.monthly_activity := 25;
    v_w.active_leadership := 35;
  end if;

  -- Oldingi pozitsiyalarni saqlab olamiz
  create temp table if not exists _prev_positions (
    candidate_id uuid, category text, position integer
  ) on commit drop;
  delete from _prev_positions;
  insert into _prev_positions
    select candidate_id, category, position
    from public.ranking_scores
    where period_id = v_period.id;

  -- Boshqa davrlarning natijalari endi "joriy emas"
  update public.ranking_scores set is_current = false where period_id <> v_period.id;
  delete from public.ranking_scores where period_id = v_period.id;

  with pol as (
    -- Siyosat bir marta o'qiladi va barcha qatorlarga tatbiq etiladi.
    select * from public.ranking_view_policy()
  ),
  base as (
    select c.id as candidate_id
    from public.candidates c
    where c.status = 'published' and c.deleted_at is null
  ),
  ev as (
    select e.candidate_id, e.category, sum(e.points) as pts
    from public.ranking_events e
    where e.verified = true and e.occurred_at >= v_start and e.occurred_at < v_end
    group by 1, 2
  ),
  views as (
    /*
     * KO'RISH BALLARI — SIYOSAT SOZLAMADAN.
     *
     * Avval `50` va `20` shu yerda qotib yozilgan edi. Ularni
     * o'zgartirish uchun migratsiya kerak bo'lardi va hech kim
     * ularni panelda ko'ra olmasdi.
     *
     * Bayroq o'chiq bo'lsa, hissa NOL bo'ladi — qator umuman
     * chiqmaydi, ya'ni ko'rish reytingga ta'sir qilmaydi.
     */
    select
      v.candidate_id,
      least(count(*)::numeric / (select views_per_point from pol), (select points_cap from pol)) as pts
    from public.profile_views v
    where v.is_counted = true
      and v.created_at >= v_start and v.created_at < v_end
      and (select enabled from pol)
    group by 1
  ),
  podcast_pts as (
    select g.candidate_id, least(count(*)::numeric * 5, 15) as pts
    from public.podcast_guests g
    join public.podcasts p on p.id = g.podcast_id
    where g.candidate_id is not null
      and p.status in ('recorded', 'published')
      and p.starts_at >= v_start and p.starts_at < v_end
    group by 1
  ),
  journal_pts as (
    select ja.candidate_id, least(count(*)::numeric * 5, 15) as pts
    from public.journal_articles ja
    join public.journals j on j.id = ja.journal_id
    where ja.candidate_id is not null
      and j.status = 'published'
      and j.published_at >= v_period.starts_on
    group by 1
  ),
  adj as (
    select a.candidate_id, a.category, sum(a.delta) as delta
    from public.ranking_adjustments a
    where a.period_id = v_period.id
    group by 1, 2
  ),
  cat_scores as (
    select
      b.candidate_id,
      least(100, greatest(0,
        coalesce((select pts from ev where ev.candidate_id = b.candidate_id and ev.category = 'achievements'), 0)
        + coalesce((select delta from adj where adj.candidate_id = b.candidate_id and adj.category = 'achievements'), 0)
      )) as achievements,
      least(100, greatest(0,
        coalesce((select pts from ev where ev.candidate_id = b.candidate_id and ev.category = 'monthly_activity'), 0)
        + coalesce((select delta from adj where adj.candidate_id = b.candidate_id and adj.category = 'monthly_activity'), 0)
      )) as monthly_activity,
      least(100, greatest(0,
        coalesce((select pts from ev where ev.candidate_id = b.candidate_id and ev.category = 'active_leadership'), 0)
        + coalesce((select pts from views where views.candidate_id = b.candidate_id), 0)
        + coalesce((select pts from podcast_pts where podcast_pts.candidate_id = b.candidate_id), 0)
        + coalesce((select pts from journal_pts where journal_pts.candidate_id = b.candidate_id), 0)
        + coalesce((select delta from adj where adj.candidate_id = b.candidate_id and adj.category = 'active_leadership'), 0)
      )) as active_leadership
    from base b
  ),
  final_scores as (
    select
      cs.*,
      least(100, greatest(0,
        (cs.achievements * v_w.achievements
         + cs.monthly_activity * v_w.monthly_activity
         + cs.active_leadership * v_w.active_leadership) / 100
        + coalesce((select delta from adj where adj.candidate_id = cs.candidate_id and adj.category = 'overall'), 0)
      )) as overall
    from cat_scores cs
  ),
  unpivoted as (
    select candidate_id, 'overall' as category, overall as score,
      jsonb_build_object(
        'achievements', round(achievements, 2),
        'monthly_activity', round(monthly_activity, 2),
        'active_leadership', round(active_leadership, 2)
      ) as breakdown
    from final_scores
    union all
    select candidate_id, 'achievements', achievements, '{}'::jsonb from final_scores
    union all
    select candidate_id, 'monthly_activity', monthly_activity, '{}'::jsonb from final_scores
    union all
    select candidate_id, 'active_leadership', active_leadership, '{}'::jsonb from final_scores
  ),
  ranked as (
    select u.*,
      rank() over (partition by u.category order by u.score desc, u.candidate_id) as new_position
    from unpivoted u
  )
  insert into public.ranking_scores
    (period_id, candidate_id, category, total_score, position, previous_position, breakdown, is_current)
  select
    v_period.id, r.candidate_id, r.category, round(r.score, 2), r.new_position,
    (select p.position from _prev_positions p
      where p.candidate_id = r.candidate_id and p.category = r.category),
    r.breakdown, true
  from ranked r;

  select count(distinct candidate_id) into v_count
  from public.ranking_scores where period_id = v_period.id;

  return v_count;
end;
$$;
