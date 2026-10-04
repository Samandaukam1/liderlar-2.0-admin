-- =========================================================================
-- A'ZO MAQOLASI PROFILDA KO'RINADIMI
--
-- Egasining talabi (2026-10-04): a'zo yozgan va NASHR QILINGAN maqola
-- uning biografik sahifasida AVTOMATIK chiqsin, lekin kabinetda har bir
-- maqola uchun "ko'rsatmaslik" tugmasi bo'lsin.
--
-- DEFAULT `true` — ATAYLAB: talab "avtomatik ko'rsatsin". Mavjud nashr
-- qilingan maqolalar ham migratsiya bilan darhol profilda chiqadi.
--
-- Bu NASHR EMAS: ustun faqat biografik sahifadagi ro'yxatni boshqaradi.
-- Maqola Liderlar Online va AdabiyotX'da avvalgidek qoladi — yashirish
-- uni o'chirish yoki nashrdan olish degani emas.
--
-- YOZISH SIYOSATI QO'SHILMAYDI: `member_articles` ga a'zo to'g'ridan-
-- to'g'ri yozmaydi (20261002200000, "YOZISH SIYOSATI HECH QAYERDA YO'Q").
-- O'zgarish server amalidan o'tadi va u yerda egalik tekshiriladi.
--
-- FORWARD-ONLY.
-- =========================================================================

alter table public.member_articles
  add column if not exists show_on_profile boolean not null default true;

/*
 * PROFIL SO'ROVI INDEKSI.
 *
 * Biografik sahifa `candidate_id` bo'yicha faqat nashr qilingan va
 * ko'rsatiladigan maqolalarni oladi.
 */
create index if not exists idx_member_articles_profile
  on public.member_articles (candidate_id, published_at desc)
  where state = 'published' and show_on_profile;

comment on column public.member_articles.show_on_profile is
  'Maqola muallifning biografik sahifasida ko''rinadimi. Faqat ro''yxatga '
  'ta''sir qiladi — Liderlar Online va AdabiyotX''dagi nashrga tegmaydi.';
