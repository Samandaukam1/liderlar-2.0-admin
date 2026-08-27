-- ============================================================
-- Post captionidagi maqola havolasi uchun aniq manba.
--
-- liderlar.uz domeni hozircha ESKI saytga ulangan, shuning uchun
-- maqola linkini u yerdan generatsiya qilish mumkin emas. Public
-- Web'ning amaldagi manzili shu sozlamada saqlanadi va u
-- to'ldirilmaguncha post caption yaratmaydi — noto'g'ri havola
-- yuborgandan ko'ra needs_review'da turgani afzal.
-- ============================================================

-- Admin tasdiqlagan (yoki qo'lda kiritgan) canonical maqola URL'i.
alter table public.candidate_social_posts
  add column if not exists article_url text;

-- Bo'sh qiymat ataylab: "sozlanmagan" holatini aniq ifodalaydi.
-- Hech qanday domen taxmin qilinmaydi.
insert into public.site_settings (key, value) values
  ('public_web.base_url', '')
on conflict (key) do nothing;
