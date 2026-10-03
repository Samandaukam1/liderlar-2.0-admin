-- =========================================================================
-- RASM TAVSIFI (ALT MATN) — §7, §52
--
-- MUAMMO: galereya rasmining tavsifi uchun ustun yo'q edi va profil
-- muharriri uni `candidate_media.file_name` ga yozardi. Ommaviy profil
-- esa `file_name` ni rasm izohi va `alt` sifatida ko'rsatardi — ya'ni
-- tavsifsiz rasmlarda ekran o'quvchisi "3f2a9c1e….jpg" yoki
-- "telegram-gallery.jpg" deb o'qirdi, kattalashtirilgan oynada esa
-- shu nom izoh bo'lib chiqardi.
--
-- YECHIM: alohida ustun. `file_name` yana faqat fayl nomi; ko'rsatish
-- `alt_text` dan olinadi, u bo'sh bo'lsa — umumiy tavsif.
--
-- Uzunlik `image-rules.ts` dagi `ALT_MAX_LENGTH` (200) bilan bir xil.
-- FORWARD-ONLY. Mavjud qatorlar `null` bilan qoladi.
-- =========================================================================

alter table public.candidate_media
  add column if not exists alt_text text
    check (alt_text is null or char_length(btrim(alt_text)) between 1 and 200);

comment on column public.candidate_media.alt_text is
  'Rasm tavsifi (ekran o''quvchisi va izoh uchun). Fayl nomi EMAS — '
  'u `file_name` da. Bo''sh bo''lsa, sahifa umumiy tavsif ko''rsatadi.';
