-- ============================================================
-- Liderlar.uz 2.0 — 0002: Core schema
-- profiles, roles, user_roles, regions, categories, candidates
-- ============================================================

-- ---------- profiles (auth.users bilan 1:1) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Yangi auth user uchun profil avtomatik yaratiladi
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- roles ----------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug in ('super_admin', 'admin', 'editor', 'moderator', 'analyst', 'viewer')),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

insert into public.roles (slug, name, description) values
  ('super_admin', 'Super admin', 'Barcha vakolatlar, adminlar va sozlamalar'),
  ('admin', 'Admin', 'Kontent va operatsiyalarni to''liq boshqarish'),
  ('editor', 'Muharrir', 'Maqola yaratish, tahrirlash va AI bilan yaxshilash'),
  ('moderator', 'Moderator', 'Arizalar va oylik yangilanishlarni tekshirish'),
  ('analyst', 'Tahlilchi', 'Statistika va reytingni kuzatish'),
  ('viewer', 'Kuzatuvchi', 'Faqat ko''rish')
on conflict (slug) do nothing;

-- ---------- user_roles ----------
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, role_id)
);

create index if not exists idx_user_roles_user on public.user_roles(user_id);

-- ---------- regions ----------
create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- categories (yo'nalishlar) ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  color text,
  icon text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- candidates ----------
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  full_name text not null check (char_length(full_name) between 3 and 160),
  short_bio text check (short_bio is null or char_length(short_bio) <= 600),
  avatar_url text,
  birth_date date,
  region_id uuid references public.regions(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'published', 'archived')),
  is_top100 boolean not null default false,
  top100_position integer check (top100_position between 1 and 100),
  user_id uuid references auth.users(id) on delete set null,
  seo_title text,
  seo_description text,
  phone text,
  email text,
  last_update_requested_at timestamptz,
  last_updated_at timestamptz,
  next_update_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Slug faqat o'chirilmagan nomzodlar orasida unikal (soft delete bilan mos)
create unique index if not exists uq_candidates_slug_active
  on public.candidates(slug) where deleted_at is null;

create index if not exists idx_candidates_status on public.candidates(status) where deleted_at is null;
create index if not exists idx_candidates_region on public.candidates(region_id);
create index if not exists idx_candidates_category on public.candidates(category_id);
create index if not exists idx_candidates_due on public.candidates(next_update_due_at)
  where deleted_at is null and status = 'published';
create index if not exists idx_candidates_top100 on public.candidates(top100_position)
  where is_top100 = true;

drop trigger if exists trg_candidates_updated on public.candidates;
create trigger trg_candidates_updated
  before update on public.candidates
  for each row execute function public.set_updated_at();
