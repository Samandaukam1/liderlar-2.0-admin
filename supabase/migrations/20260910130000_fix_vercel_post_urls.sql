-- ============================================================
-- Postlardagi deploy manzilini haqiqiy domenga almashtirish
--
-- MUAMMO: `site_settings.public_web.base_url` da deploy manzili
-- (`liderlar-2-0.vercel.app`) qolib ketgan edi va u boshqa hamma
-- manbadan ustun turardi. Natijada tayyorlangan postlarda, Telegram
-- sarlavhalarida va sertifikat QR kodlarida obunachilarga o'sha
-- havola ketardi — vaholanki sayt liderlar.uz da.
--
-- Kod tomonida bu endi to'silgan (site-origin.ts): sozlamadagi
-- `*.vercel.app` qiymati ham e'tiborsiz qoldiriladi. Bu migratsiya
-- esa ALLAQACHON YOZILGAN ma'lumotni tozalaydi.
--
-- FAQAT HOST ALMASHADI: yo'l, slug va so'rov qismi tegilmaydi.
-- Nashr etilgan postlar tarixi ham o'zgarmaydi — ular o'sha
-- sahifaga ishora qiladi, faqat to'g'ri domen bilan.
-- ============================================================

-- 1. Sozlamaning o'zi. Qiymat bo'shatiladi (qator o'chirilmaydi):
--    bo'sh sozlama kanonik domenga tushadi.
update public.site_settings
   set value = '',
       updated_at = now()
 where key = 'public_web.base_url'
   and value ~* '^https?://[^/]*\.vercel\.app';

-- 2. Postlarda saqlangan havolalar.
update public.candidate_social_posts
   set article_url = regexp_replace(
         article_url,
         '^https?://[^/]*\.vercel\.app',
         'https://liderlar.uz'
       )
 where article_url ~* '^https?://[^/]*\.vercel\.app';

-- 3. Telegram sarlavhasi ichidagi havolalar.
update public.candidate_social_posts
   set telegram_caption = regexp_replace(
         telegram_caption,
         'https?://[^/[:space:]]*\.vercel\.app',
         'https://liderlar.uz',
         'g'
       )
 where telegram_caption ~* 'https?://[^/[:space:]]*\.vercel\.app';
