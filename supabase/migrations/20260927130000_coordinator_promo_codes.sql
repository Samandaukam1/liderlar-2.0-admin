-- =========================================================================
-- KOORDINATOR PROMO KODLARI VA BIRIKTIRILGAN LIDLAR
--
-- MAQSAD: koordinator o'z promo kodini oladi. Nomzod ariza
-- topshirishda shu kodni yozsa, lid AYNAN o'sha koordinatorga
-- boradi — hududga qaramasdan.
--
-- VA ENG MUHIMI: bunday lid 10 daqiqa ichida band qilinmasa ham
-- BOSHQA koordinatorlarga O'TMAYDI. Sabab tijoriy: promo kod
-- bilan kelgan nomzod TEKINGA chiqariladi, ya'ni bu lid boshqa
-- koordinatorning ishi emas va uning hisobiga yozilmasligi kerak.
--
-- FORWARD-ONLY. Mavjud lidlar va marshrutlash o'zgarmaydi:
-- `promo_coordinator_id` bo'sh bo'lgan lid oldingi qoida bo'yicha
-- ishlaydi.
-- =========================================================================

/* ------------------------------------------------------------------ *
 * 1. KOORDINATORNING PROMO KODI
 * ------------------------------------------------------------------ */

alter table public.coordinators
  add column if not exists promo_code text;

comment on column public.coordinators.promo_code is
  'Koordinatorning shaxsiy promo kodi. Nomzod arizada shu kodni yozsa, '
  'lid to''g''ridan-to''g''ri shu koordinatorga biriktiriladi va boshqa '
  'koordinatorlarga o''tmaydi. Bosh harflarda, bo''shliqsiz.';

/*
 * BITTA KOD — BITTA FAOL KOORDINATOR.
 *
 * Registrga sezgir bo'lmagan unikal indeks: nomzod "ALI" ham,
 * "ali" ham yozishi mumkin va ikkovi bitta kod bo'lishi kerak.
 * Faolsiz koordinatorning kodi qayta ishlatilishi mumkin.
 */
create unique index if not exists uq_coordinator_promo_code_active
  on public.coordinators (upper(promo_code))
  where promo_code is not null and is_active;

/* ------------------------------------------------------------------ *
 * 2. LIDDAGI PROMO BELGISI
 * ------------------------------------------------------------------ */

alter table public.coordinator_leads
  -- Nomzod AYNAN nima yozgani. Audit uchun: kod keyin o'zgarsa ham
  -- lid qaysi kod bilan kelgani ko'rinib turadi.
  add column if not exists promo_code text,
  -- Biriktirilgan koordinator. To'ldirilgan bo'lsa: taklif faqat
  -- shu odamga, muddat tugashi bilan qayta yo'naltirish YO'Q.
  add column if not exists promo_coordinator_id uuid
    references public.coordinators(id) on delete set null;

comment on column public.coordinator_leads.promo_coordinator_id is
  'Promo kod egasi. To''ldirilgan bo''lsa lid FAQAT shu koordinatorga '
  'taklif qilinadi va muddat tugaganda boshqasiga o''tmaydi — promo '
  'nomzod tekinga chiqariladi, ya''ni boshqa koordinatorning ishi emas.';

create index if not exists idx_leads_promo_coordinator
  on public.coordinator_leads (promo_coordinator_id)
  where promo_coordinator_id is not null;

/*
 * MUDDAT INDEKSI PROMO LIDLARNI CHIQARIB TASHLAYDI.
 *
 * Muddati o'tganlarni yig'uvchi so'rov aynan shu indeksdan
 * foydalanadi. Promo lidni indeksdan chiqarish — ularning
 * qayta yo'naltirilmasligining eng past darajadagi kafolati:
 * kod xatosi ham ularni boshqa koordinatorga bera olmaydi.
 */
drop index if exists idx_leads_claim_deadline;
create index if not exists idx_leads_claim_deadline
  on public.coordinator_leads (claim_deadline)
  where state = 'offered' and promo_coordinator_id is null;
