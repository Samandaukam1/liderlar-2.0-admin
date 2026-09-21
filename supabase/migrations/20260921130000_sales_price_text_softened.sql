-- ============================================================
-- NARX MATNINI YUMSHATISH
--
-- Avvalgi matn chegirmaga "shoshiling" deb turtki berardi.
-- Buyurtmachi uni o'zgartirishni so'radi: muddat e'lon
-- qilinmasin, chegirma esa shaxsiy iltimos sifatida
-- taqdim etilsin.
--
-- NEGA MUHIM: "faqat bugun" degan da'vo har kuni yuborilsa,
-- ikkinchi marta yozgan odam ziddiyatni ko'radi. Yangi matn
-- hech qanday sana va muddat aytmaydi, shuning uchun u
-- ertaga ham to'g'ri bo'lib qoladi.
-- ============================================================

/*
 * SHARTLI UPDATE — ADMIN TAHRIRINI BOSIB KETMAYDI.
 *
 * Shablonlar admin panelidan tahrirlanishi mumkin. Shartsiz
 * yangilasak, o'sha tahrirlar jimgina yo'qolardi. Shuning
 * uchun faqat matn AYNAN avvalgi ko'rinishda qolgan bo'lsa
 * almashtiriladi.
 */
update public.sales_message_templates
set body = $tpl$Oldindan aytaman Bizda maqola joylashning yillik badali bor va u hozirda 100 000 so'mni tashkil qiladi.

Bizda homiylar yo'q tushuning — bu narx ichiga maqolani texnik jihatdan ta'minlash, sifatli yuritish va saqlash, YILLIK BARCHA TAHRIRLASHLAR va 24/7 qo'llab-quvvatlash KIRADI.

LEKIN HOZIRDA SIZ PROMO KODDAN FOYDALANGANSIZ VA MEGA CHEGIRMA AMAL QILMOQDA VA KIRISH BADALI ATIGA 38 MING SO'M.

Bunday narx hech qayerda hech qachon bo'lmagan.

Men siz uchun chegirmani alohida so'rab beraman — iloji bo'lsa va ruxsat berishsa, shu chegirma siz uchun amal qiladi.

Undan keyin esa batafsil tanishib chiqing va ayting.$tpl$,
    updated_at = now()
where key = 'price_offer_inbound'
  and body = $tpl$Oldindan aytaman Bizda maqola joylashning yillik badali bor va u hozirda 100 000 so'mni tashkil qiladi.

Bizda homiylar yo'q tushuning — bu narx ichiga maqolani texnik jihatdan ta'minlash, sifatli yuritish va saqlash, YILLIK BARCHA TAHRIRLASHLAR va 24/7 qo'llab-quvvatlash KIRADI.

LEKIN HOZIRDA SIZ PROMO KODDAN FOYDALANGANSIZ VA MEGA CHEGIRMA AMAL QILMOQDA VA KIRISH BADALI ATIGA 38 MING SO'M.

Bunday narx hech qayerda hech qachon bo'lmagan. Shunday ekan chegirmaga ulguring.

Undan keyin esa batafsil tanishib chiqing va ayting.$tpl$;
