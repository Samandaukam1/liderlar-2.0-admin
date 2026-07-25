-- ============================================================
-- Liderlar.uz 2.0 — 0005: Monthly updates
-- 30 kunlik yangilash tokenlari va yuborilgan materiallar
-- ============================================================

-- ---------- monthly_update_tokens ----------
-- Xom token HECH QACHON saqlanmaydi — faqat SHA-256 hash.
create table if not exists public.monthly_update_tokens (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  status text not null default 'active' check (status in ('active', 'used', 'revoked')),
  expires_at timestamptz,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mut_candidate on public.monthly_update_tokens(candidate_id, status);
create index if not exists idx_mut_expires on public.monthly_update_tokens(expires_at) where status = 'active';

-- ---------- monthly_updates ----------
create table if not exists public.monthly_updates (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  token_id uuid references public.monthly_update_tokens(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'under_review', 'needs_changes', 'approved', 'merged', 'rejected')),
  free_text text,
  ai_text text,
  final_text text,
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewer_comment text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_monthly_updates_candidate on public.monthly_updates(candidate_id);
create index if not exists idx_monthly_updates_status on public.monthly_updates(status);

drop trigger if exists trg_monthly_updates_updated on public.monthly_updates;
create trigger trg_monthly_updates_updated
  before update on public.monthly_updates
  for each row execute function public.set_updated_at();

-- ---------- monthly_update_items ----------
create table if not exists public.monthly_update_items (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.monthly_updates(id) on delete cascade,
  kind text not null check (kind in (
    'book', 'achievement', 'event', 'project', 'volunteering',
    'education', 'work', 'certificate', 'other'
  )),
  title text not null check (char_length(title) between 2 and 300),
  description text,
  occurred_at date,
  link_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_mui_update on public.monthly_update_items(update_id);

-- ---------- monthly_update_media ----------
create table if not exists public.monthly_update_media (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.monthly_updates(id) on delete cascade,
  bucket text not null default 'monthly-update-media',
  path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_mum_update on public.monthly_update_media(update_id);
