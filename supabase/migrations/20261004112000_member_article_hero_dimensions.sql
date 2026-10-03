-- =========================================================================
-- LIDERLAR ONLINE — BANNER O'LCHAMLARI (masonry lenta uchun)
--
-- Lenta rasm-birinchi masonry ko'rinishida: kartochka balandligi rasmning
-- tabiiy nisbatidan. O'lcham oldindan ma'lum bo'lsa, sahifa rasm
-- yuklanganda "sakramaydi" (layout shift yo'q) va brauzer to'g'ri
-- o'lchamdagi variantni so'raydi.
--
-- Eski maqolalarda `null` — ilova 16:9 deb oladi (maqola sahifasidagi
-- banner nisbati). FORWARD-ONLY.
-- =========================================================================

alter table public.member_articles
  add column if not exists hero_width integer check (hero_width is null or hero_width between 1 and 20000),
  add column if not exists hero_height integer check (hero_height is null or hero_height between 1 and 20000);

-- Lenta kursori: (published_at, id) — bir xil vaqtli maqolalar tushib qolmasin.
create index if not exists idx_member_articles_feed
  on public.member_articles (published_at desc, id desc)
  where state = 'published';
