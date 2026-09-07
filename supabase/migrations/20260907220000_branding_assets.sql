-- ============================================================
-- Brending: logo va favicon
--
-- Admin paneldan yuklangan logotip va undan hosil qilingan ikonkalar
-- shu bucket'da yashaydi. Bucket OCHIQ: favicon brauzer tomonidan
-- sessiyasiz so'raladi, shuning uchun u imzolangan havola orqali
-- berilishi mumkin emas.
--
-- Fayllar VERSIYALANGAN yo'lda saqlanadi (`<versiya>/icon-32.png`).
-- Sababi — CDN va brauzer favicon'ni juda uzoq keshlaydi; bir xil yo'lga
-- qayta yozilsa, yangi logo haftalab ko'rinmay qolishi mumkin edi.
-- Yangi yo'l esa yangi URL degani.
--
-- Sozlamalar `site_settings` da (branding_* kalitlari). Ular alohida
-- jadvalga chiqarilmadi: bu bir nechta oddiy qiymat, va `site_settings`
-- ni public sayt ham o'qiydi — kelajakda saytning logotipini ham shu
-- paneldan boshqarish mumkin bo'ladi.
--
-- QOIDA: non-destructive va idempotent.
-- ============================================================

insert into storage.buckets (id, name, public) values
  ('branding', 'branding', true)
on conflict (id) do update set public = excluded.public;

-- Yozish huquqi: mavjud konvensiya bo'yicha storage policy'lar
-- 0008_storage_and_rls.sql da bucket ro'yxati bilan emas, `public`
-- bayrog'i va `has_permission` orqali beriladi. Shu sababli bu yerda
-- faqat bucket yaratiladi; yuklashni server service_role bilan qiladi.

comment on table storage.buckets is
  'Fayl bucketlari. "branding" — panel logotipi va favicon (ochiq, versiyalangan yo''l).';
