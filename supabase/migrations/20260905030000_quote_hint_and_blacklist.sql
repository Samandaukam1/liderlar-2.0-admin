-- ============================================================
-- 1. 15-savol (post iqtibosi) eslatmasi kengaytirildi
-- 2. Qora ro'yxat — shartnomasi buzilgan nomzodlar
--
-- Migration NON-DESTRUCTIVE: hech qanday jadval/ustun o'chirilmaydi,
-- mavjud javoblar va statuslar o'zgarmaydi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Iqtibos savolining eslatmasi
--
-- Bu javob postga AYNAN qanday yozilgan bo'lsa shundayligicha chiqadi
-- (Jaxongir AI uni qayta yozmaydi), shuning uchun eslatma barcha
-- shartni o'zi aytishi kerak: ikkita gap, kamida 6 so'z, imlo, va
-- matn o'zgartirilmasligi.
--
-- Savol matni ATAYLAB o'zgartirilmaydi — u canonical_key ning
-- zaxira identifikatori.
-- ------------------------------------------------------------
update public.candidate_intake_questions
set help_text =
  'Ikkita gap yozing. Har bir gap kamida 6 ta so‘zdan iborat bo‘lsin va imloviy '
  || 'xatolarsiz bo‘lsin. Iltimos, avval matnni ChatGPT orqali tekshirib, '
  || 'moslashtirilgan variantini shu yerga joylashtiring — iqtibosingiz qanday '
  || 'yozilgan bo‘lsa, postga shundayligicha olinadi va o‘zgartirilmaydi.'
where canonical_key = 'post_quote';

-- ------------------------------------------------------------
-- 2. Qora ro'yxat
--
-- Kalit — ism slug'i, nomzod ID emas. Sababi: bir odam qayta anketa
-- to'ldirsa yangi qator paydo bo'ladi, ID esa boshqa bo'ladi. Sayt
-- nomzodni aynan slug bo'yicha tanigani uchun (nashr oqimi slug'ni
-- slugify(full_name) dan yasaydi va u jonli nomzodlar orasida unikal),
-- qora ro'yxat ham xuddi shu identifikatorda turadi — shunda odam
-- boshqa anketa bilan qaytib kelsa ham tanib olinadi.
-- ------------------------------------------------------------
create table if not exists public.intake_blacklist (
  id uuid primary key default gen_random_uuid(),
  name_slug text not null unique,
  full_name text not null,
  -- Qaysi anketadan belgilangani (ma'lumot uchun; o'chirilsa ham
  -- qora ro'yxat qolaveradi).
  intake_id uuid references public.candidate_intakes(id) on delete set null,
  reason text,
  created_by_chat_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_blacklist_created
  on public.intake_blacklist(created_at desc);

alter table public.intake_blacklist enable row level security;
-- Policy yozilmaydi: service role RLS'ni chetlab o'tadi, boshqa hech kim
-- (anon/authenticated) bu jadvalni ko'rmaydi.
