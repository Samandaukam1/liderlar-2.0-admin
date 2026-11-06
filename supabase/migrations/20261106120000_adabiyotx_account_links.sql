-- ============================================================
-- Liderlar.uz 2.0 — AdabiyotX hisobini bog'lash va o'qilgan kitoblar
--
-- A'zo kabinetda "AdabiyotX bilan bog'lash" ni bosadi: liderlar-web
-- bir martalik token (QR / deep link / qo'lda kiritiladigan kod)
-- chiqaradi, AdabiyotX ilovasi uni skaner qilib o'z serveri orqali
-- /api/public/adabiyotx/link ga yuboradi — shunda ikki hisob bog'lanadi.
--
-- Kitob AdabiyotX'da o'qib bo'lingach 10 savollik test topshiriladi;
-- natija /api/public/adabiyotx/book-read ga keladi va bu yerda
-- saqlanadi (har to'g'ri javob = reytingga 1 ball, qarang
-- 20261106121000_ranking_adabiyotx_reads.sql). O'qilgan kitob
-- candidate_adabiyotx_items ga `read_book` sifatida ham yoziladi,
-- shuning uchun biografiya sahifasi va admin panel uni o'zi ko'rsatadi.
--
-- Idempotent. Qo'llash: `supabase db push` yoki SQL Editor.
-- ============================================================

-- ---------- Bog'langan hisoblar ----------
create table if not exists public.adabiyotx_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  adabiyotx_user_id uuid not null,
  adabiyotx_username text,
  adabiyotx_full_name text,
  adabiyotx_avatar_url text,
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_adabiyotx_link_user unique (user_id),
  constraint uq_adabiyotx_link_external unique (adabiyotx_user_id)
);

drop trigger if exists trg_adabiyotx_account_links_updated on public.adabiyotx_account_links;
create trigger trg_adabiyotx_account_links_updated
  before update on public.adabiyotx_account_links
  for each row execute function public.set_updated_at();

-- ---------- Bog'lash tokenlari ----------
-- Token (QR / deep link) faqat sha256 hash sifatida saqlanadi (member_link_tokens
-- bilan bir xil shartnoma). Qo'lda kiritiladigan 8 belgili kod qisqa muddatli
-- va bir martalik bo'lgani uchun ochiq saqlanadi.
create table if not exists public.adabiyotx_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  code text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_adabiyotx_link_tokens_code
  on public.adabiyotx_link_tokens (code)
  where used_at is null;

create index if not exists idx_adabiyotx_link_tokens_user
  on public.adabiyotx_link_tokens (user_id, created_at desc);

-- ---------- Testdan o'tgan (o'qilgan) kitoblar ----------
create table if not exists public.adabiyotx_book_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  adabiyotx_user_id uuid not null,
  book_id uuid not null,
  title text not null,
  author_name text,
  cover_url text,
  external_url text not null,
  score integer not null check (score >= 0 and score <= 10),
  max_score integer not null default 10 check (max_score > 0),
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_adabiyotx_book_read unique (user_id, book_id)
);

create index if not exists idx_adabiyotx_book_reads_user
  on public.adabiyotx_book_reads (user_id, completed_at desc);

drop trigger if exists trg_adabiyotx_book_reads_updated on public.adabiyotx_book_reads;
create trigger trg_adabiyotx_book_reads_updated
  before update on public.adabiyotx_book_reads
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
-- Yozish FAQAT service_role (route handler'lar) orqali. A'zo o'z yozuvini
-- o'qiy oladi (kabinet); boshqa hech kim hech narsa ko'rmaydi.
alter table public.adabiyotx_account_links enable row level security;
alter table public.adabiyotx_link_tokens enable row level security;
alter table public.adabiyotx_book_reads enable row level security;

drop policy if exists "members read own adabiyotx link" on public.adabiyotx_account_links;
create policy "members read own adabiyotx link"
  on public.adabiyotx_account_links for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "members read own adabiyotx reads" on public.adabiyotx_book_reads;
create policy "members read own adabiyotx reads"
  on public.adabiyotx_book_reads for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "admins read adabiyotx links" on public.adabiyotx_account_links;
create policy "admins read adabiyotx links"
  on public.adabiyotx_account_links for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins read adabiyotx reads" on public.adabiyotx_book_reads;
create policy "admins read adabiyotx reads"
  on public.adabiyotx_book_reads for select
  to authenticated
  using (public.is_admin());
