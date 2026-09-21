-- =========================================================================
-- SUHBAT AQLI: "JAVOBSIZ SAVOLLAR" NI HAQIQIY BO'SHLIQLARGA QAYTARISH
--
-- MUAMMO (jonli tizimda): "Javobsiz savollar" ro'yxatiga oddiy
-- muloqot xabarlari tushib ketgan — "Hop", "Rahmat", "Tanishib
-- chiqdim", ".", "хоп", odamlarning ismlari. Ularning hech biri
-- savol emas.
--
-- ILDIZ SABAB: xabarning MULOQOT ma'nosini aniqlaydigan qatlam
-- yo'q edi va `recordKnowledgeGap` oldida hech qanday darvoza
-- turmasdi.
--
-- BU MIGRATSIYA UCH NARSA QILADI:
--   1. bo'shliq yozuviga TASNIF ustunlarini qo'shadi;
--   2. bo'shliqni GLOBAL va SHAXSIY ga ajratadi;
--   3. shaxsiy holat savollari uchun ODAM TOPSHIRIQLARI
--      jadvalini yaratadi.
--
-- FORWARD-ONLY. Hech narsa o'chirilmaydi, hech qaysi qator
-- yo'qotilmaydi. Eski holat `previous_status` da saqlanadi,
-- ya'ni arxivlash QAYTARILADI.
-- =========================================================================

/* ------------------------------------------------------------------ *
 * 1. BO'SHLIQ YOZUVI — TASNIF
 * ------------------------------------------------------------------ */

alter table public.sales_knowledge_gaps
  -- 'global' — javob hammaga bir xil; 'case' — aynan shu mijozga.
  add column if not exists kind text not null default 'global',
  -- Xabarning muloqot niyati (greeting, thanks, knowledge_question...).
  add column if not exists message_intent text,
  -- Tarixiy tozalash natijasi.
  add column if not exists classification text,
  add column if not exists classification_reason text,
  add column if not exists classified_at timestamptz,
  -- Arxivlashdan OLDINGI holat — qaytarish uchun.
  add column if not exists previous_status text;

comment on column public.sales_knowledge_gaps.kind is
  'global — qayta ishlatiladigan bilim; case — aynan shu mijozning holati. '
  'case yozuvida "Bilim bazasiga qo''shish" taklif qilinmaydi.';

comment on column public.sales_knowledge_gaps.classification is
  'Tarixiy tozalash tasnifi: real_knowledge_gap, case_specific, '
  'conversational, form_data, noise, unknown_review.';

comment on column public.sales_knowledge_gaps.previous_status is
  'Arxivlashdan oldingi status. Tozalashni qaytarish uchun saqlanadi — '
  'hech bir qator o''chirilmaydi.';

-- 'archived' holati: yozuv saqlanadi, lekin navbatda ko'rinmaydi.
alter table public.sales_knowledge_gaps
  drop constraint if exists sales_knowledge_gaps_status_check;
alter table public.sales_knowledge_gaps
  add constraint sales_knowledge_gaps_status_check
  check (status in ('open', 'answered', 'ignored', 'archived'));

alter table public.sales_knowledge_gaps
  drop constraint if exists sales_knowledge_gaps_kind_check;
alter table public.sales_knowledge_gaps
  add constraint sales_knowledge_gaps_kind_check
  check (kind in ('global', 'case'));

create index if not exists sales_knowledge_gaps_classification_idx
  on public.sales_knowledge_gaps (classification)
  where classification is not null;

create index if not exists sales_knowledge_gaps_open_kind_idx
  on public.sales_knowledge_gaps (kind, ask_count desc)
  where status = 'open';

/* ------------------------------------------------------------------ *
 * 2. ODAM TOPSHIRIQLARI (13-band)
 *
 * "Maqolam tayyormi?" degan savolning javobi bilim bazasida
 * BO'LMAYDI va bo'lishi ham kerak emas: u aynan shu mijozning
 * holatiga bog'liq. Bunday savol shu yerga tushadi.
 *
 * Bot "administratorga yo'naltiraman" deyishga FAQAT shu yerga
 * yozuv muvaffaqiyatli tushgandan keyin haqli (12-band).
 * ------------------------------------------------------------------ */

create table if not exists public.sales_case_escalations (
  id uuid primary key default gen_random_uuid(),

  conversation_id uuid not null
    references public.sales_conversations(id) on delete cascade,
  message_id uuid references public.sales_messages(id) on delete set null,

  category text not null default 'other'
    check (category in (
      'payment_check',
      'article_status',
      'application_status',
      'account_problem',
      'technical_problem',
      'content_correction',
      'unknown_business_fact',
      'other'
    )),

  -- Mijoz nima so'ragani (xom emas, kesilgan shakl).
  question text not null,
  -- Nega odam kerak bo'lgani.
  reason text not null,
  -- Qisqa kontekst. To'liq yozishma EMAS — suhbat sahifasida turibdi.
  context_summary text,

  status text not null default 'open'
    check (status in ('open', 'resolved', 'dismissed')),

  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution text
);

-- Bir suhbatda bir xil turdagi ochiq topshiriq IKKI MARTA
-- yaratilmaydi: mijoz "tayyormi?" deb uch marta so'rasa,
-- koordinator uchta bir xil topshiriq ko'rmasligi kerak.
create unique index if not exists sales_case_escalations_open_uidx
  on public.sales_case_escalations (conversation_id, category)
  where status = 'open';

create index if not exists sales_case_escalations_open_idx
  on public.sales_case_escalations (created_at desc)
  where status = 'open';

alter table public.sales_case_escalations enable row level security;
-- Siyosat ATAYLAB yo'q: jadvalga faqat service_role yozadi va
-- o'qiydi (admin panel server tomondan). Brauzerdan kirib
-- bo'lmaydi.

/* ------------------------------------------------------------------ *
 * 3. TOZALASH YURISHLARI — hisobot va qaytarish uchun
 * ------------------------------------------------------------------ */

create table if not exists public.sales_gap_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Tekshirilgan yozuvlar soni.
  scanned integer not null default 0,
  -- Tasnif bo'yicha natija.
  counts jsonb not null default '{}'::jsonb,
  -- Kim ishga tushirgani (cron bo'lsa null).
  actor_id uuid references auth.users(id) on delete set null,
  note text
);

alter table public.sales_gap_cleanup_runs enable row level security;
