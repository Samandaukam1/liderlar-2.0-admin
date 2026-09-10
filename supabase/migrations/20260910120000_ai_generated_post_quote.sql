-- ============================================================
-- Post iqtibosi: `ai_generated` manbasi
--
-- MUAMMO: nomzod anketaning 15-savoliga (post iqtibosi) javob
-- bermasa, post `needs_review` ga tushib "iqtibosni qo'lda kiriting"
-- deb turib qolardi. Amalda bu post umuman chiqmasligini anglatardi.
--
-- Endi bunday holatda iqtibos nomzodning O'Z materialidan, uning
-- nomidan yoziladi. U ALOHIDA manba sifatida belgilanadi — admin
-- qaysi iqtibos nomzod yozgani, qaysi biri avtomatik chiqqanini bir
-- qarashda ajratishi kerak.
--
-- Mavjud qatorlarga TEGILMAYDI: check qayta qo'yiladi, qiymatlar
-- o'zgarmaydi.
-- ============================================================

alter table public.candidate_social_posts
  drop constraint if exists candidate_social_posts_quote_source_check;

alter table public.candidate_social_posts
  add constraint candidate_social_posts_quote_source_check
  check (quote_source in (
    'intake_quote', 'ai_generated', 'featured_quote', 'article_quote',
    'life_motto', 'manual', 'none'
  ));

comment on column public.candidate_social_posts.quote_source is
  'intake_quote — nomzod o''zi yozgan; ai_generated — 15-savol bo''sh bo''lgani uchun uning materialidan yozilgan; manual — admin kiritgan.';
