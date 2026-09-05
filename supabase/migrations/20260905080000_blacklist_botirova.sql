-- ============================================================
-- Qora ro'yxatga qo'shimcha yozuv
--
-- name_slug src/lib/intake/name-key.ts dagi blacklistKey() bilan
-- bir xil hisoblangan (barcha apostrof variantlari olib tashlanadi,
-- keyin slugify), shunda ism boshqacha yozilib qayta kelsa ham
-- tanib olinadi.
--
-- `on conflict do nothing`: qayta ishga tushirish xavfsiz va
-- botdan keyinroq qo'shilgan aniqroq yozuvni ustidan yozmaydi.
-- ============================================================

insert into public.intake_blacklist (name_slug, full_name, reason) values
  (
    'botirova-dilnura-alibek-qizi',
    'Botirova Dilnura Alibek qizi',
    'Nomzod o‘z xohishi bilan voz kechdi. O‘z so‘zlari: “Yo‘q men buni bekor qilaman, rasm yuklash kk ekan, shuning uchun ro‘yxatdan o‘tolmayman.”'
  )
on conflict (name_slug) do nothing;
