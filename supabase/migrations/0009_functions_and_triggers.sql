-- ============================================================
-- Liderlar.uz 2.0 — 0009: Funksiyalar va triggerlar
-- ============================================================

-- ---------- Audit yozish helperi ----------
create or replace function public.write_audit_log(
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_old jsonb default null,
  p_new jsonb default null,
  p_reason text default null,
  p_severity text default 'info'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason, severity)
  values (p_actor, p_action, p_entity_type, p_entity_id, p_old, p_new, p_reason, p_severity)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- 30 kunlik yangilash muddati kelgan nomzodlar ----------
create or replace function public.get_due_candidates(p_days_ahead integer default 5)
returns table (
  id uuid,
  full_name text,
  slug text,
  next_update_due_at timestamptz,
  last_updated_at timestamptz,
  days_left integer
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.full_name, c.slug, c.next_update_due_at, c.last_updated_at,
         extract(day from c.next_update_due_at - now())::integer as days_left
  from public.candidates c
  where c.status = 'published'
    and c.deleted_at is null
    and c.next_update_due_at is not null
    and c.next_update_due_at <= now() + make_interval(days => greatest(p_days_ahead, 0))
  order by c.next_update_due_at asc;
$$;

-- ---------- Muddati tugagan tokenlarni aniqlash va belgilash ----------
create or replace function public.expire_stale_tokens()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.monthly_update_tokens
    set status = 'revoked', revoked_at = now()
    where status = 'active'
      and expires_at is not null
      and expires_at < now() - interval '30 days'
    returning id
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

-- ---------- Profil ko'rishni xavfsiz qayd qilish ----------
-- Xom IP saqlanmaydi; viewer_hash = sha256(ip + user_agent + kun tuzi).
-- Bir viewer bir nomzodni kuniga bir marta hisoblanadigan tarzda ko'radi —
-- bot va takroriy trafik shu yerda filtrlanadi.
create or replace function public.record_profile_view(
  p_candidate_slug text,
  p_viewer_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate uuid;
begin
  if p_viewer_hash is null or char_length(p_viewer_hash) < 16 then
    return false;
  end if;

  select id into v_candidate
  from public.candidates
  where slug = p_candidate_slug and status = 'published' and deleted_at is null;

  if v_candidate is null then
    return false;
  end if;

  insert into public.profile_views (candidate_id, viewer_hash, is_counted)
  values (v_candidate, p_viewer_hash, true)
  on conflict do nothing;

  return true;
end;
$$;

grant execute on function public.record_profile_view(text, text) to anon, authenticated;

-- ---------- Token tekshirish (liderlar-web ochiq forma uchun) ----------
create or replace function public.verify_update_token(p_token_hash text)
returns table (candidate_id uuid, candidate_name text, token_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select t.candidate_id, c.full_name, t.id
  from public.monthly_update_tokens t
  join public.candidates c on c.id = t.candidate_id
  where t.token_hash = p_token_hash
    and t.status = 'active'
    and (t.expires_at is null or t.expires_at > now())
    and c.deleted_at is null;
$$;

grant execute on function public.verify_update_token(text) to anon, authenticated;

-- Token orqali yangilanish sessiyasini boshlash (tokenni "used" qiladi)
create or replace function public.start_monthly_update(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_update uuid;
begin
  select t.id, t.candidate_id into v_token
  from public.monthly_update_tokens t
  where t.token_hash = p_token_hash
    and t.status = 'active'
    and (t.expires_at is null or t.expires_at > now());

  if v_token.id is null then
    raise exception 'Token yaroqsiz yoki muddati tugagan';
  end if;

  update public.monthly_update_tokens
  set status = 'used', used_at = now()
  where id = v_token.id;

  insert into public.monthly_updates (candidate_id, token_id, status)
  values (v_token.candidate_id, v_token.id, 'draft')
  returning id into v_update;

  return v_update;
end;
$$;

grant execute on function public.start_monthly_update(text) to anon, authenticated;

-- ---------- Maqola revision yaratish ----------
create or replace function public.create_article_revision(
  p_article uuid,
  p_actor uuid default null,
  p_is_autosave boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article record;
  v_rev integer;
begin
  select * into v_article from public.articles where id = p_article;
  if v_article.id is null then
    raise exception 'Maqola topilmadi';
  end if;

  select coalesce(max(revision), 0) + 1 into v_rev
  from public.article_revisions where article_id = p_article;

  insert into public.article_revisions
    (article_id, revision, title, subtitle, content, excerpt, created_by, is_autosave)
  values
    (p_article, v_rev, v_article.title, v_article.subtitle, v_article.content,
     v_article.excerpt, p_actor, p_is_autosave);

  return v_rev;
end;
$$;

-- ---------- Yangilanishni biografiyaga birlashtirishga tayyorlash ----------
create or replace function public.prepare_update_merge(p_update uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'update_id', u.id,
    'candidate_id', u.candidate_id,
    'status', u.status,
    'items_total', (select count(*) from public.monthly_update_items i where i.update_id = u.id),
    'items_by_kind', (
      select coalesce(jsonb_object_agg(kind, cnt), '{}'::jsonb)
      from (
        select kind, count(*) as cnt
        from public.monthly_update_items i
        where i.update_id = u.id
        group by kind
      ) s
    ),
    'has_final_text', u.final_text is not null,
    'media_count', (select count(*) from public.monthly_update_media m where m.update_id = u.id)
  )
  from public.monthly_updates u
  where u.id = p_update;
$$;

-- ---------- Birlashtirilganda avtomatik reyting balli ----------
-- monthly_update merged bo'lganda oylik faollik uchun 10 ball yoziladi.
create or replace function public.on_monthly_update_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'merged' and old.status is distinct from 'merged' then
    insert into public.ranking_events
      (candidate_id, category, points, source, description, occurred_at, created_by)
    values
      (new.candidate_id, 'monthly_activity', 10, 'monthly_update',
       'Oylik yangilanish tasdiqlandi va birlashtirildi', now(), new.reviewer_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_monthly_update_merged on public.monthly_updates;
create trigger trg_monthly_update_merged
  after update on public.monthly_updates
  for each row execute function public.on_monthly_update_merged();

-- ---------- Umumiy reytingni qayta hisoblash ----------
-- Formula (0–100 shkala har bir kategoriya uchun):
--   achievements      = clamp( event ballari + tuzatishlar )
--   monthly_activity  = clamp( event ballari + tuzatishlar )
--   active_leadership = clamp( event ballari
--                              + ko'rishlar balli (50 ta hisoblangan ko'rish = 1 ball, max 20)
--                              + podcast ishtiroki (har biri 5, max 15)
--                              + jurnal maqolalari (har biri 5, max 15)
--                              + tuzatishlar )
--   overall = w1*ach + w2*monthly + w3*leadership (100 ga bo'lingan) + overall tuzatishlar
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

  with base as (
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
    select v.candidate_id, least(count(*)::numeric / 50, 20) as pts
    from public.profile_views v
    where v.is_counted = true and v.created_at >= v_start and v.created_at < v_end
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
