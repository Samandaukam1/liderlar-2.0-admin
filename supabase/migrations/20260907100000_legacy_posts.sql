-- ============================================================
-- Liderlar 1.0 (Tilda) postlarini saqlash — legacy_posts
--
-- NEGA ALOHIDA JADVAL (candidates ga qo'shilmadi):
--   `candidates` — 2.0 ensiklopediyasining ishchi yadrosi. Unga bog'langan:
--   reyting (ranking_scores/events/adjustments), anketa (candidate_intakes),
--   post studio, sertifikat, oylik yangilanish sikli, AI retrieval, sitemap,
--   qidiruv, TOP-100 va statistika. Faqat liderlar-web'da `candidates`ga 16 ta
--   alohida so'rov bor va ularning aksariyati `status = 'published'` bo'yicha
--   filtrlaydi. 1.0 ning 1912 ta "published" yozuvi u yerga tushsa — reyting,
--   qidiruv natijalari, AI javoblari, sitemap va TOP-100 tanlovi JIMGINA
--   o'zgaradi. "Legacy va 2.0 aniq farqlansin" talabining aynan buzilishi shu.
--
--   Legacy yozuv boshqa narsa: importchi Tilda feed posti. Unda anketa ham,
--   reyting ham, sertifikat ham, 30 kunlik sikl ham YO'Q — `candidates`ning
--   ~40 ustunidan deyarli hech biri unga tegishli emas. Shuning uchun bu
--   "duplicate architecture" emas, boshqa entity.
--
--   Bog'lanish kerak bo'lganda `candidate_id` bor: bir odam 2.0 da qayta
--   ro'yxatdan o'tsa, legacy yozuvi uning yangi profiliga ULANADI, lekin
--   o'rniga o'tmaydi.
--
-- QOIDA: non-destructive va idempotent.
-- ============================================================

create table if not exists public.legacy_posts (
  id uuid primary key default gen_random_uuid(),

  -- --- Manba (1.0) identifikatorlari ---
  -- Har uch ustun ham CSV'dagi HAQIQIY qiymatdan keladi; hech biri o'ylab
  -- topilmaydi.
  source_version text not null default '1.0' check (source_version = '1.0'),
  -- Tilda "Post ID" — CSV'dagi yagona barqaror, 1991/1991 unikal identifikator.
  legacy_source_id text not null,
  -- 1.0 URL'ining oxirgi bo'lagi: <post-id>-<sarlavha-slug>, yoki Tilda'da
  -- alias qo'lda berilgan bo'lsa — o'sha alias.
  legacy_slug text not null,
  -- Tilda alias ustuni (CSV'da 1991 tadan faqat 1 tasida bor). Alias qo'yilgan
  -- yozuvda eski havola IKKI shaklda ham ishlagan bo'lishi mumkin, shuning
  -- uchun ikkalasi ham saqlanadi va route ikkalasini ham taniydi.
  legacy_alias text,
  -- To'liq eski yo'l, masalan /nomzodlar/9bidsfxtk1-asomiddinov-...
  legacy_path text not null,

  -- --- Kontent ---
  title text not null,
  -- Tilda "Description" — qisqa tavsif (2.0 dagi short_bio ga o'xshash).
  summary text,
  -- Import paytida oq ro'yxat bo'yicha tozalangan HTML. Xom HTML saqlanmaydi:
  -- manba sifatida CSV qoladi va qayta import qilish uni qayta tozalaydi.
  content_html text not null default '',
  -- Teglarsiz matn — qidiruv va "N daqiqalik o'qish" uchun.
  content_text text not null default '',
  cover_image_url text,

  -- --- Metadata ---
  -- 1.0 dagi HAQIQIY sana. Import sanasi EMAS. Manbada bo'lmasa — null.
  legacy_created_at timestamptz,
  -- Tilda "Visibility": published | draft.
  legacy_status text not null default 'draft'
    check (legacy_status in ('published', 'draft')),
  -- Tilda "Category" — nuqta-vergul bilan ajratilgan ko'p qiymatli maydon.
  legacy_categories text[] not null default '{}'::text[],
  legacy_author text,
  seo_title text,
  seo_description text,
  seo_keywords text,

  -- 2.0 profiliga ULANISH (majburiy emas, o'rnini bosmaydi).
  candidate_id uuid references public.candidates(id) on delete set null,

  -- --- Import izlari ---
  -- CSV qatorining barqaror xesh'i: qiymat o'zgarmagan bo'lsa, --resume uni
  -- qayta yozmasdan o'tkazib yuboradi.
  import_checksum text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- IDEMPOTENTLIKNING ASOSI: bitta CSV ikki marta ishlatilsa ham ikkinchi yozuv
-- yaratilmaydi. Import `legacy_source_id` bo'yicha upsert qiladi, bu indeks esa
-- uni ma'lumotlar bazasi darajasida majburlaydi.
create unique index if not exists uq_legacy_posts_source_id
  on public.legacy_posts(legacy_source_id) where deleted_at is null;

-- Eski URL bo'yicha qidirish — public route shu indeksdan foydalanadi.
create unique index if not exists uq_legacy_posts_slug
  on public.legacy_posts(legacy_slug) where deleted_at is null;

create index if not exists idx_legacy_posts_alias
  on public.legacy_posts(legacy_alias) where legacy_alias is not null and deleted_at is null;
create index if not exists idx_legacy_posts_status
  on public.legacy_posts(legacy_status) where deleted_at is null;
create index if not exists idx_legacy_posts_created
  on public.legacy_posts(legacy_created_at desc) where deleted_at is null;
create index if not exists idx_legacy_posts_candidate
  on public.legacy_posts(candidate_id) where candidate_id is not null;

-- Admin ro'yxatidagi qidiruv F.I.Sh. bo'yicha `ilike` qiladi. pg_trgm bu
-- loyihada yoqilmagan va 1991 qator uchun uni yoqish ortiqcha — bu indeks
-- kichik harfli to'liq mos kelish va prefiks qidiruvini qoplaydi.
create index if not exists idx_legacy_posts_title_lower
  on public.legacy_posts(lower(title)) where deleted_at is null;

drop trigger if exists trg_legacy_posts_updated on public.legacy_posts;
create trigger trg_legacy_posts_updated
  before update on public.legacy_posts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RLS — mavjud konvensiya bilan bir xil
-- ------------------------------------------------------------
alter table public.legacy_posts enable row level security;

-- 1.0 da chop etilgan post 2.0 da ham ochiq qoladi; draft — yo'q.
drop policy if exists "published legacy posts are public" on public.legacy_posts;
create policy "published legacy posts are public"
  on public.legacy_posts for select
  using (legacy_status = 'published' and deleted_at is null);

drop policy if exists "admins read all" on public.legacy_posts;
create policy "admins read all" on public.legacy_posts for select
  to authenticated using (public.is_admin());

-- Tahrirlash 2.0 nomzodlari bilan bir xil huquq ostida.
drop policy if exists "editors manage legacy posts" on public.legacy_posts;
create policy "editors manage legacy posts" on public.legacy_posts for all
  to authenticated
  using (public.has_permission('candidates.edit'))
  with check (public.has_permission('candidates.edit'));

comment on table public.legacy_posts is
  'Liderlar 1.0 (Tilda) postlari. 2.0 candidates jadvalidan ATAYLAB alohida — reyting, qidiruv, sitemap va TOP-100 ga aralashmasligi uchun.';
comment on column public.legacy_posts.legacy_created_at is
  'Manbadagi HAQIQIY sana. Import sanasi emas; manbada bo''lmasa null.';
