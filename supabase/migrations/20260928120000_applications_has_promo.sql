-- =========================================================================
-- ARIZADA PROMO KOD BORMI — HISOBLANADIGAN USTUN
--
-- MAQSAD: arizalar ro'yxatida promo kodsizlarni TEPAGA chiqarish.
--
-- NEGA ALOHIDA USTUN, `order by promo_code nulls first` EMAS:
-- "promo kod yo'q" ikki xil ko'rinishda yozilgan — `null` va bo'sh
-- satr. Eski arizalarda bo'sh satr ham uchraydi. `nulls first`
-- faqat birinchisini tepaga chiqarardi va bo'sh satrli arizalar
-- promo kodlilar orasida qolib ketardi — ya'ni tugma jimgina
-- yarim ishlardi.
--
-- Hisoblanadigan ustun ikkalasini ham bitta savolga aylantiradi:
-- "bormi yoki yo'qmi". U `stored`, ya'ni saralash indeksdan
-- foydalanadi va har so'rovda qayta hisoblanmaydi.
--
-- FORWARD-ONLY. Mavjud ustunlar va ma'lumot o'zgarmaydi.
-- =========================================================================

alter table public.applications
  add column if not exists has_promo boolean
  generated always as (promo_code is not null and btrim(promo_code) <> '') stored;

comment on column public.applications.has_promo is
  'Arizada haqiqiy promo kod bormi. `null` ham, bo''sh satr ham '
  '"yo''q" deb hisoblanadi. Faqat saralash va sanoq uchun.';

/*
 * SARALASH INDEKSI.
 *
 * Ro'yxat "avval promo kodsizlar, keyin sana bo'yicha yangisi"
 * tartibida chiqadi — indeks aynan shu tartibda.
 */
create index if not exists idx_applications_has_promo_created
  on public.applications (has_promo, created_at desc);
