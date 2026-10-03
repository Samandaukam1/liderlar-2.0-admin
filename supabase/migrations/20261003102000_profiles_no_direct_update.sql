-- =========================================================================
-- PROFILNI TO'G'RIDAN-TO'G'RI O'ZGARTIRISH YOPILADI
-- =========================================================================
--
-- MUAMMO
--
-- 0008 dagi "update own profile" siyosati kirgan foydalanuvchiga O'Z
-- `profiles` qatorining ISTALGAN ustunini PostgREST orqali o'zgartirishga
-- ruxsat berardi (`PATCH /rest/v1/profiles?id=eq.<o'zi>`). Ilovadagi
-- tekshiruvlar shunda chetlab o'tiladi:
--
--   is_active  — admin bloklagan odam o'zini qayta faollashtiradi;
--   username   — band qilingan login ("admin", "liderlar") va shakl
--                qoidasi faqat ilovada tekshiriladi;
--   full_name  — ism VIP kodlari ro'yxatida OMMAVIY ko'rinadi
--                (`vip_referral_code_suggestions`): odam o'zini
--                "Liderlar.uz ma'muriyati" deb atashi mumkin edi.
--
-- Ilgari kiradiganlar faqat xodimlar edi. VIP bilan har bir a'zo
-- akkauntga ega — siyosat endi hamma uchun ochiq eshik.
--
-- KOD BUNGA TAYANMAYDI
--
-- Ikkala repoda ham `profiles` ga yozish faqat service_role mijozi
-- orqali (`username-service.ts`, admin panel amallari). Foydalanuvchi
-- sessiyasi faqat O'Z qatorini O'QIYDI — bu siyosat ("own profile")
-- tegilmaydi.
--
-- Jadval darajasidagi yozish huquqi ham olinadi: siyosat qayta
-- qo'shilib qolsa ham (masalan, Dashboard orqali), rol huquqi baribir
-- to'sadi. Profilni yaratish `handle_new_user` triggeri (SECURITY
-- DEFINER) orqali — unga ta'sir qilmaydi.
-- =========================================================================

drop policy if exists "update own profile" on public.profiles;

revoke insert, update, delete, truncate on table public.profiles from anon, authenticated;
