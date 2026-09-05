-- ============================================================
-- Qora ro'yxatning boshlang'ich yozuvlari
--
-- Tahririyat Telegramda yuritib kelgan ro'yxat. Bundan keyin
-- qo'shish botdagi "🚫 Bu kishi bilan shartnoma buzuldi" tugmasi
-- orqali bo'ladi — bu faqat mavjudini ko'chirish.
--
-- name_slug src/lib/intake/blacklist.ts dagi blacklistKey() bilan
-- BIR XIL hisoblangan: barcha apostrof variantlari (ʻ ʼ ‘ ’ ')
-- olib tashlanadi, keyin slugify. Shuning uchun "o‘g‘li", "oʻgʻli"
-- va "ogli" bitta kalitga tushadi va odam ismini boshqacha yozib
-- qayta anketa to'ldirsa ham tanib olinadi.
--
-- `on conflict do nothing`: qayta ishga tushirish xavfsiz, va
-- botdan keyinroq qo'shilgan aniqroq yozuvni ustidan yozmaydi.
-- ============================================================

insert into public.intake_blacklist (name_slug, full_name, reason) values
  (
    'temirqulov-husniddin-rashid-ogli',
    'Temirqulov Husniddin Rashid o‘g‘li',
    '29.12.2025 — 14 kunlik kelishuv. 20% to‘langan, 80 000 so‘m qolgan. Chiqmagan, pulini to‘lamagan.'
  ),
  (
    'nursulton-muxtoriy-anvarovich',
    'Nursulton Muxtoriy Anvarovich',
    '19.06.2026 — 14 kunlik, 0% to‘lov (@muxtorov_lv). Qayta-qayta ogohlantirishlarga qaramay badal pulini to‘lamagan.'
  ),
  (
    'sorabekova-ezoza-jasur-qizi',
    'Sorabekova E’zoza Jasur qizi',
    '14 kunlik, 0% to‘lov (@Zoza_0820). Qayta-qayta ogohlantirishlarga qaramay badal pulini to‘lamagan.'
  ),
  (
    'vohidov-jamshid-shuxrat-ogli',
    'Vohidov Jamshid Shuxrat o‘g‘li',
    '14 kunlik, 0% to‘lov (@voxxidovv). Qayta-qayta ogohlantirishlarga qaramay badal pulini to‘lamagan.'
  ),
  (
    'badirov-abduhakim-usmon-ogli',
    'Badirov Abduhakim Usmon o‘g‘li',
    '14 kunlik, 0% to‘lov (@Hakim_01_01). Qayta-qayta ogohlantirishlarga qaramay badal pulini to‘lamagan.'
  )
on conflict (name_slug) do nothing;
