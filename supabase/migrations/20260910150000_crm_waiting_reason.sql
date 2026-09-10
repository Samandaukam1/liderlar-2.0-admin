-- ============================================================
-- "Kutayotganlar" ro'yxati: nega kutayapti
--
-- MUAMMO: ro'yxat faqat ism va username ko'rsatardi. Muharrir "bu odam
-- nega hali chiqmadi?" degan savolga javob olish uchun har biri bo'yicha
-- admin panelga kirib, anketani ochib, quvur holatini qidirishi kerak
-- edi. Amalda sabablar bir nechta va ular butunlay boshqa ish talab
-- qiladi: to'lov qilinmagani (nomzodga yozish kerak) bilan render
-- bosqichida uzilgan yugurish (qayta ishga tushirish kerak) bir xil
-- ko'rinardi.
--
-- Ko'rinishga uchta MAVJUD ustun qo'shiladi, hisoblanadigan yangi
-- ma'lumot emas:
--   • payment_status        — to'lov tasdiqlanganmi;
--   • post_pipeline_status  — quvur qayerda turibdi;
--   • post_pipeline_error   — "<bosqich>: <matn>" ko'rinishida, ya'ni
--     texnik xato AYNAN qaysi bosqichda bo'lgani shu satrdan o'qiladi
--     (`fail()` uni shu shaklda yozadi).
--
-- Yana ikkitasi vaqt bo'yicha:
--   • post_pipeline_started_at    — "ishlanmoqda" bilan "bir soatdan beri
--     ishlanmoqda" ni ajratish uchun;
--   • post_pipeline_process_after — navbat vaqti kelganmi yoki o'tib
--     ketganmi (cron ishlamayotganining belgisi).
--
-- Yangi ustunlar OXIRIGA qo'shiladi: `create or replace view` mavjud
-- ustunlarning nomi, turi va tartibini o'zgartirishga ruxsat bermaydi.
--
-- QOIDA: non-destructive va idempotent. Hech qanday ma'lumot
-- o'zgartirilmaydi — bu faqat ko'rinishning kengaytirilishi.
-- ============================================================

create or replace view public.candidate_intake_crm
  with (security_invoker = true) as
select
  i.id,
  i.full_name,
  i.telegram_username,
  i.status,
  i.submitted_at,
  i.created_at,
  i.published_at,
  i.deleted_at,
  i.candidate_id,
  -- SAYTNING javobi: nomzod qatori bor, chop etilgan va o'chirilmagan.
  -- Anketa holati bu yerga umuman qatnashmaydi.
  (c.id is not null and c.status = 'published' and c.deleted_at is null) as article_live,
  -- Nega kutayapti — quyidagilar.
  i.payment_status,
  i.post_pipeline_status,
  i.post_pipeline_error,
  i.post_pipeline_started_at,
  i.post_pipeline_process_after
from public.candidate_intakes i
left join public.candidates c on c.id = i.candidate_id;

revoke all on public.candidate_intake_crm from anon, authenticated;
grant select on public.candidate_intake_crm to service_role;

comment on view public.candidate_intake_crm is
  'Bot CRM ro''yxatlari uchun. `article_live` — nomzod SAYTDA chop etilganmi; u har so''rovda jonli hisoblanadi va anketa holatidan mustaqil. Qolgan ustunlar "kutayotganlar" ro''yxatida sababni ko''rsatish uchun.';
