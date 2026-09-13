-- ============================================================
-- MAVJUD BILIMNI TASNIFLASH
--
-- NEGA ALOHIDA MIGRATSIYA: oldingi migratsiya `fact_kind` ustunini
-- `unclassified` standarti bilan qo'shdi. Kod esa tasniflanmagan
-- bilimni mijozga AYTMAYDI (9-band). Ya'ni sxema qo'shilgani bilan,
-- tasniflash bo'lmasa bot 31 ta tasdiqlangan javobning birortasini
-- ham ishlatolmaydi va HAMMA SAVOLGA fallback beradi.
--
-- Shuning uchun mavjud yozuvlar MAZMUNIGA QARAB tasniflanadi.
--
-- ── TASNIFLASH QOIDASI ──────────────────────────────────────────
--
-- Bu YUMSHATISH emas, aksincha: tarixiy va'da va muddatli
-- takliflar ALOHIDA ajratiladi va ular avtonom javobdan
-- CHIQADI. Faqat muddat/va'da belgisi BO'LMAGAN, odam tasdiqlagan
-- yozuvlar doimiy fakt bo'ladi.
--
-- Auditda topilgan va shu yerda karantinga olinadigan gaplar:
--   · "chegirma ... bir kun davomida amal qiladi"  -> temporary_offer
--   · "birozdan so'ng yuboramiz"                    -> task_promise
--
-- `temporary_offer` uchun `valid_until` NULL bo'lgani sabab,
-- `evaluateValidity()` uni `undated_temporary_offer` deb rad etadi.
-- Aynan shu kerak: muddati tasdiqlanmagan taklif aytilmaydi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. BAJARILADIGAN VA'DALAR — eng avval, chunki ular ichida
--    muddat so'zi ham bo'lishi mumkin va qoida bir marta ishlaydi.
-- ------------------------------------------------------------
update public.sales_knowledge
   set fact_kind = 'task_promise',
       never_expires = false
 where fact_kind = 'unclassified'
   and answer ~* 'birozdan so|hozir (yuboraman|qilaman|jo.nataman|tayyorlayman)|yuborib qo.yaman|tayyorlab beraman|ko.rib chiqaman|eslatib qo.yaman';

-- ------------------------------------------------------------
-- 2. MUDDATLI TAKLIFLAR — tugash sanasi YO'Q, shuning uchun
--    ular avtomatik javobda ISHLATILMAYDI.
--
--    `valid_until` ATAYLAB to'ldirilmaydi: hech qayerda tasdiqlangan
--    tugash sanasi yo'q va uni bu yerda o'ylab topish aynan
--    auditda qoralangan xato bo'lardi.
-- ------------------------------------------------------------
update public.sales_knowledge
   set fact_kind = 'temporary_offer',
       never_expires = false,
       valid_until = null
 where fact_kind = 'unclassified'
   and answer ~* 'faqat bugun|bugun (tugaydi|yakunlanadi)|shoshiling|oxirgi (kun|imkoniyat)|bir kun davomida|chegirma (tugaydi|amal qiladi)|ertaga (tugaydi|100)';

-- ------------------------------------------------------------
-- 3. QOLGANI — ODAM TASDIQLAGAN DOIMIY FAKT
--
--    Faqat `approved`: qoralama baribir javobda ishlatilmaydi,
--    shuning uchun uni tasniflash noto'g'ri ishonch berardi.
--
--    Bular muddat yoki va'da belgisi bo'lmagan xizmat faktlari
--    ("sertifikat beriladi", "loyiha ... MChJga qarashli").
--    Ularni doimiy deb belgilash — tasdiqlagan odamning
--    qarorini saqlash; sxema esa endi ularni qayta ko'rib
--    chiqish imkonini beradi.
-- ------------------------------------------------------------
update public.sales_knowledge
   set fact_kind = 'permanent_fact',
       never_expires = true,
       valid_from = coalesce(valid_from, reviewed_at, created_at)
 where fact_kind = 'unclassified'
   and status = 'approved'
   and archived_at is null;

-- ------------------------------------------------------------
-- 4. TIJORIY FAKTLARNING YAGONA MANBAI — to'ldirilmagan maydonlar
--
--    `offerExpiresAt` HALI HAM null. Bu ataylab: chegirma muddati
--    hech qayerda tasdiqlanmagan. Kod buni ochiq tekshiradi va
--    bot "bugun tugaydi" DEYA OLMAYDI.
--
--    Yangi maydonlar faqat SXEMA sifatida qo'shiladi — noma'lum
--    qiymat taxmin qilib to'ldirilmaydi (11-band).
-- ------------------------------------------------------------
update public.sales_settings
   set value = value
     || jsonb_build_object(
          'currency', coalesce(value->>'currency', 'UZS'),
          'billingPeriod', coalesce(value->>'billingPeriod', value->>'servicePeriod'),
          'installmentAvailable', coalesce(value->'installmentAvailable', 'null'::jsonb),
          'installmentTerms', coalesce(value->'installmentTerms', 'null'::jsonb),
          'additionalFeePolicy', coalesce(value->'additionalFeePolicy', 'null'::jsonb),
          'discountStart', coalesce(value->'discountStart', 'null'::jsonb)
        )
 where key = 'commercial';

comment on column public.sales_knowledge.valid_until is
  'Tugash sanasi. temporary_offer uchun MAJBURIY — usiz yozuv javobda ishlatilmaydi.';
