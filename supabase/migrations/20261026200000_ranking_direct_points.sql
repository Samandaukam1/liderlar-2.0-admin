-- REYTING: to'g'ridan-to'g'ri ballar (egasi 2026-10-26 da so'radi).
--
--   ko'rish 5 ta = 1 · promo kod (to'lov + nashr) = 1 · VIP maqola = 3 ·
--   AdabiyotX o'z kitobi = 10 · AdabiyotX o'z maqolasi = 2 · tasdiqlangan yutuq = 2
--
-- Hammasi umumiy ballga og'irliksiz, 100 chegarasiz, butun tarix bo'yicha
-- qo'shiladi. Ko'rishlar "Faol liderlik" toifasidan chiqarildi.
--
-- SABAB: joriy davr 2026-10-01 da tugagan, formula esa faqat davr ichidagi
-- ko'rishlarni sanardi — oktabrdagi ko'rishlar umuman ball bermasdi.
--
-- Qo'llash: `supabase db query --linked -f <bu fayl>` (db push EMAS), so'ng
-- `select public.recalculate_rankings();`. Orqaga: views_per_point = 50 va
-- 20261022120000_ranking_recalc_prev_positions_join.sql dagi funksiya.

update public.site_settings set value = '5' where key = 'ranking.views_per_point';

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
  -- Vaqtinchalik jadvalning statistikasi yo'q; usiz rejalashtiruvchi
  -- uni bo'sh deb hisoblab, quyidagi JOIN'ni yana tsiklga aylantirishi mumkin.
  analyze _prev_positions;

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
  /*
   * TO'G'RIDAN-TO'G'RI BALLAR (egasi 2026-10-26 da belgilagan).
   *
   * Quyidagilar umumiy ballga OG'IRLIKSIZ va 100 CHEGARASIZ qo'shiladi,
   * butun tarix bo'yicha (davr sanasidan qat'i nazar):
   *   ko'rish       — har `ranking.views_per_point` (5) sanalgan ko'rish = 1
   *   promo kod     — to'lov qilgan va chop etilgan har tavsiya = 1
   *   VIP maqola    — chop etilgan har maqola (Liderlar Online) = 3
   *   AdabiyotX     — o'z kitobi = 10, o'z maqolasi = 2 (ko'rinadiganlari)
   *   yutuq         — tahririyat TASDIQLAGAN har yutuq = 2
   * Ko'rishlar "Faol liderlik" toifasidan chiqarildi — umumiy ballda ikki
   * marta sanalmasin. `ranking.view_points_cap` endi ishlatilmaydi.
   */
  views as (
    select
      v.candidate_id,
      count(*)::numeric / (select views_per_point from pol) as pts
    from public.profile_views v
    where v.is_counted = true
      and (select enabled from pol)
    group by 1
  ),
  referral_pts as (
    -- `payment_confirmed` mukofoti faqat to'lov + nashr bo'lganda yoziladi
    -- (award-service); keyin yashirilgan nomzod uchun ball qolmaydi.
    select c.id as candidate_id, count(distinct rr.attribution_id)::numeric as pts
    from public.referral_rewards rr
    join public.referral_attributions ra on ra.id = rr.attribution_id
    join public.candidates referred
      on referred.id = ra.candidate_id
     and referred.status = 'published'
     and referred.deleted_at is null
    join public.candidates c on c.user_id = rr.referrer_profile_id
    where rr.stage = 'payment_confirmed'
    group by 1
  ),
  article_pts as (
    select m.candidate_id, count(*)::numeric * 3 as pts
    from public.member_articles m
    where m.state = 'published' and m.candidate_id is not null
    group by 1
  ),
  adabiyotx_pts as (
    select
      i.candidate_id,
      (count(*) filter (where i.content_type = 'book'))::numeric * 10 as book_pts,
      (count(*) filter (where i.content_type = 'article'))::numeric * 2 as article_pts
    from public.candidate_adabiyotx_items i
    where i.relationship_type = 'own_work' and i.is_visible = true
    group by 1
  ),
  achievement_pts as (
    select a.candidate_id, count(*)::numeric * 2 as pts
    from public.achievements a
    where a.review_state = 'published'
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
        + coalesce((select pts from podcast_pts where podcast_pts.candidate_id = b.candidate_id), 0)
        + coalesce((select pts from journal_pts where journal_pts.candidate_id = b.candidate_id), 0)
        + coalesce((select delta from adj where adj.candidate_id = b.candidate_id and adj.category = 'active_leadership'), 0)
      )) as active_leadership
    from base b
  ),
  direct as (
    select
      cs.candidate_id,
      coalesce(vw.pts, 0) as view_points,
      coalesce(rp.pts, 0) as referral_points,
      coalesce(ar.pts, 0) as article_points,
      coalesce(ax.book_pts, 0) as adabiyotx_book_points,
      coalesce(ax.article_pts, 0) as adabiyotx_article_points,
      coalesce(ac.pts, 0) as achievement_points
    from cat_scores cs
    left join views vw on vw.candidate_id = cs.candidate_id
    left join referral_pts rp on rp.candidate_id = cs.candidate_id
    left join article_pts ar on ar.candidate_id = cs.candidate_id
    left join adabiyotx_pts ax on ax.candidate_id = cs.candidate_id
    left join achievement_pts ac on ac.candidate_id = cs.candidate_id
  ),
  final_scores as (
    select
      cs.*,
      d.view_points,
      d.referral_points,
      d.article_points,
      d.adabiyotx_book_points,
      d.adabiyotx_article_points,
      d.achievement_points,
      least(100, greatest(0,
        (cs.achievements * v_w.achievements
         + cs.monthly_activity * v_w.monthly_activity
         + cs.active_leadership * v_w.active_leadership) / 100
        + coalesce((select delta from adj where adj.candidate_id = cs.candidate_id and adj.category = 'overall'), 0)
      ))
      + d.view_points + d.referral_points + d.article_points
      + d.adabiyotx_book_points + d.adabiyotx_article_points + d.achievement_points as overall
    from cat_scores cs
    join direct d on d.candidate_id = cs.candidate_id
  ),
  unpivoted as (
    select candidate_id, 'overall' as category, overall as score,
      jsonb_build_object(
        'achievements', round(achievements, 2),
        'monthly_activity', round(monthly_activity, 2),
        'active_leadership', round(active_leadership, 2),
        'views', round(view_points, 2),
        'referrals', round(referral_points, 2),
        'articles', round(article_points, 2),
        'adabiyotx_books', round(adabiyotx_book_points, 2),
        'adabiyotx_articles', round(adabiyotx_article_points, 2),
        'approved_achievements', round(achievement_points, 2)
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
    p.position,
    r.breakdown, true
  from ranked r
  /*
   * JOIN — ATAYLAB, korrelyatsiyali ichki so'rov emas. Avval har yangi
   * qator uchun indekssiz _prev_positions butunlay skanerlanardi:
   * 2909 nomzod × 4 toifa = ~11 600 yangi qator × 7 860 eski qator
   * = ~10^8 taqqoslash, 12,9 s; PostgREST chegarasi esa 8 s. (candidate_id, category)
   * davr ichida unikal, ya'ni JOIN qatorlarni ko'paytirmaydi.
   */
  left join _prev_positions p
    on p.candidate_id = r.candidate_id and p.category = r.category;

  select count(distinct candidate_id) into v_count
  from public.ranking_scores where period_id = v_period.id;

  return v_count;
end;
$function$;
