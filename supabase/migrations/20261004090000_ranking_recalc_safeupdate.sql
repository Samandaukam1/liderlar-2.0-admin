-- =========================================================================
-- REYTING HISOBI CRON ORQALI ISHLAMASDI — TUZATISH
--
-- MUAMMO: `recalculate_rankings()` ichidagi `delete from _prev_positions;`
-- (WHERE siz). Supabase PostgREST ulanishlarida `safeupdate` kengaytmasi
-- yoqilgan va u bunday DELETE ni rad etadi:
--     HTTP 400 · 21000 · "DELETE requires a WHERE clause"
-- Admin panel va /api/cron/rankings funksiyani service_role orqali
-- (PostgREST) chaqiradi — natijada reyting HECH QACHON yozilmagan:
-- production'da `ranking_scores` 0 qator, 1582 chop etilgan nomzod
-- biografiyasida "0 ball", o'rin yo'q. SQL Editor (postgres) da esa
-- funksiya ishlardi, shuning uchun xato ko'rinmay qolgan.
--
-- YECHIM: o'sha bitta qator `where true` bilan. Funksiyaning qolgan
-- matni production'dagi ta'rifdan AYNAN olingan — formula, og'irliklar,
-- tartiblash (ball kamayishi bo'yicha, teng ballda candidate_id) o'zgarmaydi.
-- `create or replace` huquqlarni saqlaydi (faqat service_role).
--
-- FORWARD-ONLY. Ma'lumotga tegilmaydi.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.recalculate_rankings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  /*
   * `where true` — ATAYLAB. PostgREST ulanishlarida `safeupdate` yoqilgan
   * va u WHERE siz DELETE ni to'xtatadi ("DELETE requires a WHERE
   * clause", 21000). Shu bitta qator tufayli har soatlik cron hech
   * qachon muvaffaqiyatli tugamagan va `ranking_scores` bo'sh qolgan.
   */
  delete from _prev_positions where true;
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
$function$;
