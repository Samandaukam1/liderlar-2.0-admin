-- ============================================================
-- Liderlar.uz 2.0 — 0003: Content schema
-- Nomzod bo'limlari, media, maqolalar, podcastlar, jurnal,
-- iqtiboslar, arizalar, huquqiy sahifalar, sayt sozlamalari
-- ============================================================

-- ---------- Nomzod bo'limlari (yagona shakl) ----------
-- education, work_experiences, achievements, events, books_read, social_links
do $$
declare
  t text;
begin
  foreach t in array array[
    'education', 'work_experiences', 'achievements', 'events', 'books_read', 'social_links'
  ]
  loop
    execute format($f$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        candidate_id uuid not null references public.candidates(id) on delete cascade,
        title text not null check (char_length(title) between 2 and 300),
        subtitle text,
        description text,
        date_from date,
        date_to date,
        url text,
        sort_order integer not null default 0,
        created_at timestamptz not null default now()
      );
    $f$, t);
    execute format(
      'create index if not exists idx_%s_candidate on public.%I(candidate_id);', t, t
    );
  end loop;
end;
$$;

-- ---------- candidate_media (umumiy media reyestri) ----------
create table if not exists public.candidate_media (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  candidate_id uuid references public.candidates(id) on delete set null,
  kind text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bucket, path)
);

create index if not exists idx_candidate_media_candidate on public.candidate_media(candidate_id);
create index if not exists idx_candidate_media_bucket on public.candidate_media(bucket) where deleted_at is null;

-- ---------- articles ----------
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete set null,
  title text not null check (char_length(title) between 3 and 300),
  subtitle text,
  slug text not null,
  excerpt text,
  content text not null default '',
  cover_url text,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'scheduled', 'published', 'archived')),
  scheduled_at timestamptz,
  published_at timestamptz,
  seo_title text,
  seo_description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists uq_articles_slug_active
  on public.articles(slug) where deleted_at is null;
create index if not exists idx_articles_candidate on public.articles(candidate_id);
create index if not exists idx_articles_status on public.articles(status) where deleted_at is null;

drop trigger if exists trg_articles_updated on public.articles;
create trigger trg_articles_updated
  before update on public.articles
  for each row execute function public.set_updated_at();

-- ---------- article_revisions ----------
create table if not exists public.article_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  revision integer not null check (revision > 0),
  title text not null,
  subtitle text,
  content text not null default '',
  excerpt text,
  created_by uuid references auth.users(id) on delete set null,
  is_autosave boolean not null default false,
  created_at timestamptz not null default now(),
  unique (article_id, revision)
);

create index if not exists idx_article_revisions_article on public.article_revisions(article_id);

-- ---------- podcasts ----------
create table if not exists public.podcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 300),
  description text,
  starts_at timestamptz,
  location text,
  online_url text,
  host_name text,
  banner_url text,
  media_url text,
  status text not null default 'planned'
    check (status in ('planned', 'announced', 'live', 'recorded', 'published', 'cancelled')),
  cancel_reason text,
  registration_limit integer check (registration_limit is null or registration_limit > 0),
  candidate_id uuid references public.candidates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_podcasts_starts on public.podcasts(starts_at);

drop trigger if exists trg_podcasts_updated on public.podcasts;
create trigger trg_podcasts_updated
  before update on public.podcasts
  for each row execute function public.set_updated_at();

create table if not exists public.podcast_guests (
  id uuid primary key default gen_random_uuid(),
  podcast_id uuid not null references public.podcasts(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  guest_name text,
  role text,
  created_at timestamptz not null default now()
);

create index if not exists idx_podcast_guests_podcast on public.podcast_guests(podcast_id);

-- ---------- journals (Liderlar Online) ----------
create table if not exists public.journals (
  id uuid primary key default gen_random_uuid(),
  issue_number integer not null unique check (issue_number > 0),
  title text not null,
  description text,
  cover_url text,
  pdf_url text,
  published_at date,
  status text not null default 'draft' check (status in ('draft', 'published')),
  is_featured boolean not null default false,
  downloads_count integer not null default 0 check (downloads_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.journal_articles (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.journals(id) on delete cascade,
  article_id uuid references public.articles(id) on delete set null,
  candidate_id uuid references public.candidates(id) on delete set null,
  title text not null,
  author_name text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_journal_articles_journal on public.journal_articles(journal_id);

-- ---------- quotes ----------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete set null,
  author_name text,
  text text not null check (char_length(text) between 5 and 1000),
  is_featured boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published')),
  accent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_quotes_candidate on public.quotes(candidate_id);

-- ---------- applications ----------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 3 and 160),
  email text,
  phone text,
  region_id uuid references public.regions(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  motivation text,
  status text not null default 'new'
    check (status in ('new', 'in_review', 'needs_info', 'accepted', 'rejected', 'converted')),
  assignee_id uuid references auth.users(id) on delete set null,
  duplicate_of uuid references public.applications(id) on delete set null,
  candidate_id uuid references public.candidates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_applications_status on public.applications(status);

drop trigger if exists trg_applications_updated on public.applications;
create trigger trg_applications_updated
  before update on public.applications
  for each row execute function public.set_updated_at();

create table if not exists public.application_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  bucket text not null default 'application-files',
  path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_application_files_app on public.application_files(application_id);

create table if not exists public.application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_application_notes_app on public.application_notes(application_id);

-- ---------- legal_pages ----------
create table if not exists public.legal_pages (
  slug text primary key check (slug in ('oferta', 'privacy', 'terms')),
  title text not null,
  content text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------- site_settings ----------
create table if not exists public.site_settings (
  key text primary key,
  value text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
