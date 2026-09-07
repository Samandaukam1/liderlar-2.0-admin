-- ============================================================
-- AI Sotuv — CHEGIRMADAGI NARX bilimi
--
-- MUAMMO: ssenariyda mijoz oferta bosqichida "hammasi 38 mingmi?",
-- "38 ming yetadimi?" deb so'rashi kutiladi (texnik topshiriq 6-band).
-- Bu savol holat mashinasida alohida qadam emas — u BILIM orqali
-- javob beriladi. Tasdiqlangan bilim bo'lmasa esa bot MISSING_KNOWLEDGE
-- holatiga tushib JIM QOLADI, ya'ni mijoz savoliga javob olmaydi.
--
-- NEGA ALOHIDA MIGRATSIYA: oldingi seed migratsiyasi allaqachon
-- qo'llangan bo'lishi mumkin va o'sha faylni tahrirlash qayta
-- ishlamasdi. Bu fayl mustaqil va idempotent.
--
-- NEGA "38 000" VA "38 ming" IKKALASI YOZILGAN: javob yaratilgandan
-- keyin undagi har bir son manba matnida borligi tekshiriladi
-- (gallyutsinatsiya to'sig'i). Faqat "38 000" yozilsa, model tabiiy
-- ravishda "38 ming" deb javob berganda son manbada topilmay qolardi
-- va javob YUBORILMASDI. Ikkala shakl ham haqiqiy matn, ikkalasi ham
-- ishlatiladi.
-- ============================================================

insert into public.sales_knowledge
  (category, question, answer, tags, confidence, status, source_type, priority,
   source_conversation_id, dedupe_key)
values
  (
    'price',
    'Hammasi 38 mingmi? 38 ming to‘laymanmi? 38 ming yetadimi? Narxi qancha? Boshqa to‘lov bormi?',
    $txt$Hozirda chegirmadagi narx 38 000 so‘m (38 ming). Bu chegirma taklifi faqat bugun amal qiladi.$txt$,
    array['narx', 'chegirma', 'to‘lov'],
    1.00,
    'approved',
    'manual',
    100,
    null,
    'manual:price:discount-38k'
  )
on conflict (dedupe_key) do nothing;
