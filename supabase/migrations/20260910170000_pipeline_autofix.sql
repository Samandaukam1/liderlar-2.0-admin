-- ============================================================
-- To'xtab qolgan yugurishni bot O'ZI tuzatadi
--
-- MUAMMO: `needs_review` "odam qarab chiqsin" degani edi, amalda esa
-- O'LIK NUQTA bo'lib qoldi. Navbat so'rovi faqat `pending` va `failed`
-- ni oladi, ya'ni bunday anketa hech qachon o'zi qayta ishlanmasdi —
-- kimdir panelga kirib qo'lda bosmaguncha turaverardi. Ro'yxatda esa
-- ular "texnik xato" bo'lib to'planib borardi.
--
-- To'xtashlarning aksariyati o'tkinchi (model javob bermadi, render
-- uzildi, Telegram qabul qilmadi) va hammasi idempotent. Bot ularni
-- o'zi qaytaradi.
--
-- Bu ustun "bu yugurish avtomatik tuzatilgan" faktini olib yuradi:
-- yugurish MUVAFFAQIYATLI tugagach, tahririyatga alohida xabar
-- yuboriladi ("falonchining xatosi tuzatilib, post yuborildi") va
-- ustun tozalanadi. Ustunsiz bu xabarni yuborib bo'lmasdi — tugagan
-- yugurish o'zining qanday boshlanganini bilmaydi.
--
-- MUHIM: ismdosh va qora ro'yxat to'xtashlari BU YERGA UMUMAN
-- KIRMAYDI. Ular xato emas, ODAM QARORI, va kod tomonida ataylab
-- avtomatik qaytarishdan chiqarilgan.
--
-- QOIDA: non-destructive va idempotent. Mavjud qatorlar
-- o'zgartirilmaydi; ustun NULL bo'lib boshlanadi.
-- ============================================================

alter table public.candidate_intakes
  add column if not exists post_pipeline_autofix_from text;

comment on column public.candidate_intakes.post_pipeline_autofix_from is
  'Bot avtomatik qaytarganda — oldingi to''xtash matni. Yugurish muvaffaqiyatli tugagach xabar yuboriladi va ustun tozalanadi.';
