-- ============================================================
-- Ariza formasi: yangi maydonlar
--
-- Sayt formasi endi faqat quyidagilarni so'raydi:
--   F.I.Sh (lotin alifbosida, bosh harflarda), telefon raqam,
--   Telegram (ochiq raqam yoki @username), jins, yosh oralig'i
--   va ixtiyoriy promo kod.
--
-- Eski ustunlar (email, motivation, region_id, category_id)
-- o'chirilmaydi — arxivdagi arizalar va nomzodga aylantirish
-- oqimi ularga tayanadi.
-- ============================================================

alter table public.applications
  add column if not exists telegram text,
  add column if not exists gender text,
  add column if not exists age_range text,
  add column if not exists promo_code text;

alter table public.applications drop constraint if exists applications_gender_check;
alter table public.applications
  add constraint applications_gender_check
  check (gender is null or gender in ('male', 'female'));

alter table public.applications drop constraint if exists applications_age_range_check;
alter table public.applications
  add constraint applications_age_range_check
  check (age_range is null or age_range in ('14-18', '19-24', '25-28', '29-35', '35+'));

-- Promo kod bo'yicha qidiruv/hisobot uchun
create index if not exists idx_applications_promo_code
  on public.applications(promo_code)
  where promo_code is not null;

comment on column public.applications.telegram is 'Telegram: @username yoki E.164 telefon raqam';
comment on column public.applications.gender is 'male | female';
comment on column public.applications.age_range is '14-18 | 19-24 | 25-28 | 29-35 | 35+';
comment on column public.applications.promo_code is 'Ixtiyoriy promo kod (bosh harflarda, bo''shliqsiz)';
