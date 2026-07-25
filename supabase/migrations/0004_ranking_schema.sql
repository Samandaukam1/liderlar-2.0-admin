-- ============================================================
-- Liderlar.uz 2.0 — 0004: Ranking schema
-- Davrlar, og'irliklar, ball manbalari, natijalar, tuzatishlar,
-- profil ko'rishlari
-- ============================================================

-- ---------- ranking_categories ----------
create table if not exists public.ranking_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug in ('overall', 'achievements', 'monthly_activity', 'active_leadership')),
  name text not null,
  sort_order integer not null default 0
);

insert into public.ranking_categories (slug, name, sort_order) values
  ('overall', 'Umumiy reyting', 0),
  ('achievements', 'Yutuqlar reytingi', 1),
  ('monthly_activity', 'Oylik faollik reytingi', 2),
  ('active_leadership', 'Faol liderlik reytingi', 3)
on conflict (slug) do nothing;

-- ---------- ranking_periods ----------
create table if not exists public.ranking_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date,
  status text not null default 'open' check (status in ('open', 'closed')),
  is_current boolean not null default false,
  published_at timestamptz,
  closed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Faqat bitta joriy davr bo'lishi mumkin
create unique index if not exists uq_ranking_periods_current
  on public.ranking_periods(is_current) where is_current = true;

-- ---------- ranking_weights ----------
create table if not exists public.ranking_weights (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null unique references public.ranking_periods(id) on delete cascade,
  achievements numeric not null default 40 check (achievements between 0 and 100),
  monthly_activity numeric not null default 25 check (monthly_activity between 0 and 100),
  active_leadership numeric not null default 35 check (active_leadership between 0 and 100),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (achievements + monthly_activity + active_leadership = 100)
);

drop trigger if exists trg_ranking_weights_updated on public.ranking_weights;
create trigger trg_ranking_weights_updated
  before update on public.ranking_weights
  for each row execute function public.set_updated_at();

-- ---------- ranking_events (har bir ballning manbasi) ----------
create table if not exists public.ranking_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  category text not null
    check (category in ('achievements', 'monthly_activity', 'active_leadership')),
  points numeric not null check (points between -100 and 100),
  source text not null, -- masalan: 'monthly_update', 'podcast', 'journal_article', 'editorial'
  description text,
  occurred_at timestamptz not null default now(),
  verified boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ranking_events_candidate
  on public.ranking_events(candidate_id, category, occurred_at);

-- ---------- ranking_scores (hisoblangan natijalar) ----------
create table if not exists public.ranking_scores (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.ranking_periods(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  category text not null
    check (category in ('overall', 'achievements', 'monthly_activity', 'active_leadership')),
  total_score numeric not null default 0,
  position integer,
  previous_position integer,
  breakdown jsonb not null default '{}'::jsonb,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, candidate_id, category)
);

create index if not exists idx_ranking_scores_lookup
  on public.ranking_scores(category, is_current, position);

drop trigger if exists trg_ranking_scores_updated on public.ranking_scores;
create trigger trg_ranking_scores_updated
  before update on public.ranking_scores
  for each row execute function public.set_updated_at();

-- ---------- ranking_adjustments (qo'lda tuzatishlar, sabab majburiy) ----------
create table if not exists public.ranking_adjustments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.ranking_periods(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  category text not null
    check (category in ('overall', 'achievements', 'monthly_activity', 'active_leadership')),
  delta numeric not null check (delta between -100 and 100),
  reason text not null check (char_length(reason) >= 5),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ranking_adjustments_period
  on public.ranking_adjustments(period_id, candidate_id);

-- ---------- profile_views (bot va takroriy trafikka qarshi) ----------
create table if not exists public.profile_views (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  viewer_hash text not null, -- IP+UA sha256 (xom IP saqlanmaydi)
  is_counted boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_profile_views_candidate
  on public.profile_views(candidate_id, created_at);

-- Bir viewer bir nomzodni kuniga bir marta "hisoblanadigan" ko'rishi mumkin.
-- Diqqat: timestamptz::date IMMUTABLE emas, shuning uchun indeksda to'g'ridan-to'g'ri
-- ishlatib bo'lmaydi. timezone(text, timestamptz) IMMUTABLE — Toshkent kuni bo'yicha dedup.
create unique index if not exists uq_profile_views_daily
  on public.profile_views(candidate_id, viewer_hash, ((timezone('Asia/Tashkent', created_at))::date))
  where is_counted = true;
