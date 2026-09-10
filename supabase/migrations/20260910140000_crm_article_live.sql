-- ============================================================
-- Bot CRM ro'yxatlari: "maqolasi saytda chiqqanmi?" degan savol
--
-- MUAMMO: "Kutayotganlar" ro'yxati `candidate_intakes.status` ga
-- qarardi. Bu anketa hujjatining holati, SAYTNING holati emas.
-- Ikkalasi bir-biridan ajralib qolishi mumkin: nomzod saytda chiqib
-- bo'lgan, anketa esa hamon "promoted" yoki "AI ko'rmoqda" bo'lib
-- turadi (uzilib qolgan yugurish, yoki nomzod anketadan tashqari
-- yo'l bilan chop etilgani). Natijada bot allaqachon chiqib bo'lgan
-- odamlarni "kutayapti" deb ko'rsatardi.
--
-- Yechim ikki qismli:
--   1. KO'RINISH (view): ro'yxat endi saytning o'zidan so'raydi.
--      `article_live` har so'rovda jonli hisoblanadi, ya'ni u
--      ustun kabi eskirib qola olmaydi.
--   2. Mavjud ortda qolgan qatorlar bir marta to'g'irlanadi, shunda
--      admin paneldagi boshqa ekranlar ham haqiqatni ko'rsatadi.
--
-- QOIDA: non-destructive va idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ko'rinish
-- ------------------------------------------------------------
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
  (c.id is not null and c.status = 'published' and c.deleted_at is null) as article_live
from public.candidate_intakes i
left join public.candidates c on c.id = i.candidate_id;

-- `security_invoker` bilan asosiy jadvallarning RLS'i so'rovchi rolga
-- qo'llanadi. Bot service_role bilan o'qiydi; anon va authenticated
-- uchun bu ko'rinish umuman kerak emas, shuning uchun ochiq
-- qoldirilmaydi.
revoke all on public.candidate_intake_crm from anon, authenticated;
grant select on public.candidate_intake_crm to service_role;

comment on view public.candidate_intake_crm is
  'Bot CRM ro''yxatlari uchun. `article_live` — nomzod SAYTDA chop etilganmi; u har so''rovda jonli hisoblanadi va anketa holatidan mustaqil.';

-- ------------------------------------------------------------
-- 2. Ortda qolgan anketa holatlarini to'g'irlash
--
--    Faqat nomzodi ALLAQACHON saytda bo'lgan va anketasi hamon
--    "kutish" holatlaridan birida turgan qatorlar. Boshqa hech
--    narsa o'zgarmaydi.
-- ------------------------------------------------------------
--    NASHR SANASI `articles` DAN OLINADI.
--
--    `candidates` jadvalida `published_at` ustuni YO'Q — nashr sanasi
--    maqola qatorida yashaydi. `now()` bilan to'ldirish esa o'tmish
--    haqida yolg'on yozish bo'lardi: yozuv bugun emas, o'z vaqtida
--    chop etilgan. Maqola topilmasa ustun O'Z HOLICHA qoladi (null
--    bo'lsa null), ya'ni noma'lum sana noma'lum bo'lib turaveradi.
update public.candidate_intakes i
   set status = 'published',
       published_at = coalesce(i.published_at, a.published_at)
  from public.candidates c
  left join lateral (
    select ar.published_at
      from public.articles ar
     where ar.candidate_id = c.id
       and ar.status = 'published'
       and ar.deleted_at is null
     order by ar.published_at asc nulls last
     limit 1
  ) a on true
 where c.id = i.candidate_id
   and c.status = 'published'
   and c.deleted_at is null
   and i.deleted_at is null
   and i.status in ('submitted', 'ai_reviewing', 'needs_clarification', 'approved', 'promoted');
