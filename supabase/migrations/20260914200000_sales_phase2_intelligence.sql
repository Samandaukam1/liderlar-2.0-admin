-- ============================================================
-- AI SOTUV — 2-FAZA: REAL SOTUV AQLI VA O'RGANISH
--
-- Bu migratsiya 2026-09-14 auditining ochiq qolgan bandlarini
-- sxema darajasida yopadi. QOIDA O'ZGARMAYDI: hammasi QO'SHIMCHA.
-- Hech bir jadval tashlanmaydi, hech bir ustun o'chirilmaydi, xom
-- suhbat tarixiga (`sales_messages`, `sales_outbound_log`) tegilmaydi —
-- ular o'zgarmas o'rganish manbai.
--
-- Nega bir migratsiya: quyidagi oltita bo'lim bir-biriga bog'liq.
-- Bilimning amal qilish muddati bo'lmasa, ziddiyatni aniqlab
-- bo'lmaydi; ziddiyatsiz FAQ tasdiqlab bo'lmaydi; qamrovsiz FAQ
-- chastotasi yolg'on bo'ladi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. BILIMNING AMAL QILISH MUDDATI (9-band)
--
--    MUAMMO: `status = 'approved'` hozircha "bu gap HAR DOIM
--    to'g'ri" degani edi. Tarixda esa "chegirma faqat bugun",
--    "maqola yarim soatda chiqadi", "sertifikatni birozdan so'ng
--    yuboramiz" kabi BIR MARTALIK gaplar ham tasdiqlangan bilim
--    bo'lib qolgan. Bot ularni bugun ham aytishi mumkin edi.
--
--    Yechim: har bilimning TURI bo'ladi. Doimiy fakt bilan
--    muddatli taklif va tarixiy misol bir xil ishlatilmaydi.
-- ------------------------------------------------------------
alter table public.sales_knowledge
  -- Bilim qanday turdagi da'vo. Standart `permanent_fact` EMAS:
  -- mavjud 248 yozuvning turi hali tekshirilmagan, shuning uchun
  -- `unclassified` — ular tasniflanmaguncha "doimiy haqiqat" deb
  -- ko'rsatilmaydi.
  add column if not exists fact_kind text not null default 'unclassified'
    check (fact_kind in (
      'unclassified',
      'permanent_fact',
      'temporary_offer',
      'customer_specific_offer',
      'task_promise',
      'historical_example',
      'style_example'
    )),

  -- Amal qilish oynasi. `never_expires` ATAYLAB `false` standart:
  -- "muddatsiz" degan da'vo ham tasdiqlanishi kerak.
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists never_expires boolean not null default false,

  -- Kimga tegishli: hamma, bitta suhbat, bitta kampaniya.
  add column if not exists scope text not null default 'all'
    check (scope in ('all', 'conversation', 'campaign', 'region')),
  add column if not exists scope_ref text,

  -- Qanday shartda amal qiladi (["yangi mijoz", "bir martalik to'lov"]).
  add column if not exists conditions jsonb not null default '[]'::jsonb,

  -- Versiyalash: yangi javob eskisini ALMASHTIRADI, o'chirmaydi.
  add column if not exists version integer not null default 1,
  add column if not exists supersedes_id uuid references public.sales_knowledge(id) on delete set null,
  add column if not exists superseded_at timestamptz,

  -- Ziddiyat holati. `conflicted` bo'lgan yozuv mijozga AVTONOM
  -- javobda ISHLATILMAYDI (10-band) — u adminda hal qilinadi.
  add column if not exists conflict_status text not null default 'none'
    check (conflict_status in ('none', 'suspected', 'conflicted', 'resolved')),
  add column if not exists conflict_group text;

create index if not exists idx_sales_knowledge_validity
  on public.sales_knowledge(fact_kind, conflict_status)
  where status = 'approved';
create index if not exists idx_sales_knowledge_conflict_group
  on public.sales_knowledge(conflict_group)
  where conflict_group is not null;

comment on column public.sales_knowledge.fact_kind is
  'Da''vo turi. historical_example va style_example JORIY HAQIQAT EMAS — ular faqat uslub namunasi.';
comment on column public.sales_knowledge.never_expires is
  'Standart false: "muddatsiz" ham tasdiqlanishi kerak bo''lgan da''vo.';
comment on column public.sales_knowledge.conflict_status is
  'conflicted — bir mavzuda qarama-qarshi tasdiqlangan yozuv bor. Avtonom javobda ishlatilmaydi.';

-- ------------------------------------------------------------
-- 2. BILIM ZIDDIYATLARI (10-band)
--
--    "Bo'lib to'lash mumkin" va "bo'lib to'lash mumkin emas" —
--    ikkalasi ham tasdiqlangan bo'lsa, retrieval TASODIFAN
--    bittasini tanlardi va mijoz javobi kun sayin o'zgarardi.
--    Endi bunday juftlik qayd etiladi va ODAM hal qiladi.
-- ------------------------------------------------------------
create table if not exists public.sales_knowledge_conflicts (
  id uuid primary key default gen_random_uuid(),

  -- Ziddiyat qaysi mavzuda (normallashtirilgan mavzu kaliti).
  topic_key text not null,
  topic_label text not null,

  -- Qarama-qarshi yozuvlar: [{"id":"...","stance":"yes","excerpt":"..."}]
  members jsonb not null default '[]'::jsonb,
  member_count integer not null default 0,

  detection_reason text not null,

  status text not null default 'open'
    check (status in ('open', 'resolved', 'dismissed')),

  -- Qaysi yozuv to'g'ri deb tanlangani.
  winner_knowledge_id uuid references public.sales_knowledge(id) on delete set null,
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,

  run_id uuid,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_conflict_topic
  on public.sales_knowledge_conflicts(topic_key);
create index if not exists idx_sales_conflict_open
  on public.sales_knowledge_conflicts(status, last_detected_at desc);

drop trigger if exists trg_sales_conflicts_updated on public.sales_knowledge_conflicts;
create trigger trg_sales_conflicts_updated
  before update on public.sales_knowledge_conflicts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. FAQ HAYOT SIKLI VA HALOL CHASTOTA (12–15-band)
--
--    `sales_faq` da `approved boolean` bor edi, lekin QORALAMA
--    holati yo'q edi va chastota bitta son edi. Bitta mijoz bir
--    savolni 10 marta so'rasa, u 10 ta mijozdek ko'rinardi.
--    Shuning uchun xabar soni va SUHBAT soni ALOHIDA saqlanadi.
-- ------------------------------------------------------------
alter table public.sales_faq
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'needs_answer')),

  -- Klaster kaliti: payment_method, certificate_availability, ...
  add column if not exists intent_key text,
  add column if not exists intent_kind text not null default 'question'
    check (intent_kind in (
      'question', 'implied', 'objection', 'confusion',
      'technical_problem', 'trust', 'service', 'post_sale'
    )),

  -- HALOL O'LCHOV: ikkisi boshqacha son.
  add column if not exists message_count integer not null default 0,
  add column if not exists conversation_count integer not null default 0,

  -- Redaksiyadan o'tgan asl yozilishlar.
  add column if not exists examples jsonb not null default '[]'::jsonb,

  add column if not exists answer_status text not null default 'unanswered'
    check (answer_status in ('unanswered', 'draft_answer', 'approved_answer')),
  add column if not exists knowledge_id uuid references public.sales_knowledge(id) on delete set null,

  add column if not exists run_id uuid,
  add column if not exists last_run_id uuid;

create index if not exists idx_sales_faq_status
  on public.sales_faq(status, conversation_count desc);
create index if not exists idx_sales_faq_intent
  on public.sales_faq(intent_key);

comment on column public.sales_faq.status is
  'AI qazib olgan FAQ HAR DOIM draft. Avtomatik tasdiqlash yo''q — faktni odam tasdiqlaydi.';
comment on column public.sales_faq.conversation_count is
  'Nechta BOSHQA suhbatda so''ralgan. message_count bilan tenglashtirilmasin.';

-- ------------------------------------------------------------
-- 4. E'TIROZLAR (17–18-band)
--
--    Bitta xabarda bir nechta e'tiroz bo'lishi mumkin ("qimmat,
--    oilam bilan maslahatlashaman"), shuning uchun har e'tiroz
--    alohida qator emas, alohida TOIFA va uning chastotasi.
--
--    STRATEGIYA fakt bilan bir joyda saqlanmaydi: strategiya
--    "nima qilish" (tan ol, qiymatni tushuntir, bitta qadam
--    so'ra), fakt esa tasdiqlangan bilimdan keladi.
-- ------------------------------------------------------------
create table if not exists public.sales_objections (
  id uuid primary key default gen_random_uuid(),

  objection_kind text not null,
  label text not null,

  message_count integer not null default 0,
  conversation_count integer not null default 0,

  -- Redaksiyalangan namunalar.
  examples jsonb not null default '[]'::jsonb,

  -- Faqat "qanday javob berish" — fakt EMAS.
  strategy jsonb not null default '[]'::jsonb,

  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected')),

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  run_id uuid,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_objection_kind
  on public.sales_objections(objection_kind);
create index if not exists idx_sales_objection_freq
  on public.sales_objections(conversation_count desc);

drop trigger if exists trg_sales_objections_updated on public.sales_objections;
create trigger trg_sales_objections_updated
  before update on public.sales_objections
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. QAZISH YUGURISHLARI — HALOL QAMROV (6–7, 43, 45-band)
--
--    ENG MUHIM JADVAL. Ilgari o'rganish "oxirgi 500 suhbat"
--    degan QAT'IY LIMIT bilan ishlardi va natija "hammasi
--    o'rganildi" deb ko'rsatilardi. Bu yolg'on qamrov edi.
--
--    Endi har yugurish O'ZI TOPGAN va O'ZI ISHLAGAN sonni
--    alohida saqlaydi. Ikkisi teng bo'lmasa — `partial`.
--    ETA kuzatilgan tezlikdan hisoblanadi, o'ylab topilmaydi.
-- ------------------------------------------------------------
create table if not exists public.sales_mining_runs (
  id uuid primary key default gen_random_uuid(),

  kind text not null default 'incremental'
    check (kind in ('incremental', 'full_rebuild')),

  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),

  -- --- topilgan (discovered) va ishlangan (processed) ALOHIDA ---
  conversations_discovered integer not null default 0,
  conversations_processed integer not null default 0,
  messages_discovered integer not null default 0,
  messages_processed integer not null default 0,

  -- --- xabarlarning kelib chiqishi bo'yicha taqsimot ---
  incoming_count integer not null default 0,
  human_outbound_count integer not null default 0,
  ai_outbound_count integer not null default 0,
  system_count integer not null default 0,
  media_only_count integer not null default 0,
  deleted_count integer not null default 0,
  skipped_count integer not null default 0,

  earliest_message_at timestamptz,
  latest_message_at timestamptz,

  -- --- sahifalash holati ---
  current_batch integer not null default 0,
  total_batches integer not null default 0,
  batch_size integer not null default 50,
  failed_batches jsonb not null default '[]'::jsonb,

  -- Kursor: (last_message_at, id) juftligi — barqaror keyset.
  cursor_last_message_at timestamptz,
  cursor_conversation_id uuid,
  -- Inkremental yugurish shu vaqtdan keyingi xabarlarni oladi.
  watermark_at timestamptz,

  -- `full` FAQAT discovered == processed VA failed_batches bo'sh bo'lsa.
  coverage_status text not null default 'unknown'
    check (coverage_status in ('unknown', 'partial', 'full')),
  coverage_note text,

  -- --- o'lchangan tezlik; ETA shundan chiqadi ---
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms bigint,
  measured_rate_per_sec numeric(10, 3),
  eta_seconds integer,

  -- --- natija ---
  faq_clusters integer not null default 0,
  objection_clusters integer not null default 0,
  questions_found integer not null default 0,
  style_profile_id uuid references public.sales_style_profiles(id) on delete set null,

  -- TO'LIQ QAYTA QURISH NATIJASI O'ZI FAOLLASHMAYDI (43-band).
  activated boolean not null default false,
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,

  error text,
  notes jsonb not null default '[]'::jsonb,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_mining_runs_status
  on public.sales_mining_runs(status, created_at desc);
-- Bir vaqtda bitta yugurish: ikkita parallel qazish bir xil
-- klasterni ikki marta yozardi.
-- `((1))` ataylab: indeks kaliti DOIMIY, ya'ni predikatga tushgan
-- BARCHA qatorlar bitta kalitga uriladi. Natija — bir vaqtda faqat
-- BITTA faol yugurish. `(status)` bo'yicha unikal bo'lsa, bitta
-- `queued` va bitta `running` yonma-yon yashab qolardi.
create unique index if not exists uq_sales_mining_run_active
  on public.sales_mining_runs((1))
  where status in ('queued', 'running');

drop trigger if exists trg_sales_mining_runs_updated on public.sales_mining_runs;
create trigger trg_sales_mining_runs_updated
  before update on public.sales_mining_runs
  for each row execute function public.set_updated_at();

comment on table public.sales_mining_runs is
  'Qazish yugurishi. discovered != processed bo''lsa qamrov `partial` — "hammasi o''rganildi" deb ko''rsatilmaydi.';
comment on column public.sales_mining_runs.measured_rate_per_sec is
  'KUZATILGAN tezlik (suhbat/sekund). ETA faqat shundan hisoblanadi.';

-- Qazilgan xom savollar — klasterlashdan OLDINGI bosqich.
-- Nega alohida jadval: klasterlash qoidasi o'zgarsa, savollarni
-- qaytadan qazimasdan qayta klasterlash mumkin bo'lsin.
create table if not exists public.sales_mined_questions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.sales_mining_runs(id) on delete cascade,
  conversation_id uuid references public.sales_conversations(id) on delete cascade,
  message_id uuid references public.sales_messages(id) on delete set null,

  -- REDAKSIYADAN O'TGAN matn. Xom mijoz matni bu jadvalga tushmaydi.
  redacted_text text not null,
  normalized_text text not null,
  intent_key text,
  intent_kind text not null default 'question',
  asked_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists idx_sales_mined_q_run
  on public.sales_mined_questions(run_id);
create index if not exists idx_sales_mined_q_intent
  on public.sales_mined_questions(intent_key);
create unique index if not exists uq_sales_mined_q_message
  on public.sales_mined_questions(run_id, message_id)
  where message_id is not null;

-- ------------------------------------------------------------
-- 6. USLUB PROFILI — VERSIYALANGAN QORALAMA (19–22-band)
--
--    Ilgari qayta hisoblash FAOL profilni ustidan yozardi.
--    Natijada auditda ko'rilgan "hi" li profil jonli botga
--    to'g'ridan-to'g'ri tushgan edi. Endi hisoblash QORALAMA
--    yaratadi; faollashtirish alohida, odam qiladigan qadam.
-- ------------------------------------------------------------
alter table public.sales_style_profiles
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),

  add column if not exists dataset_start_at timestamptz,
  add column if not exists dataset_end_at timestamptz,

  -- FAQAT INSON yozgan xabarlar (19-band).
  add column if not exists human_message_count integer not null default 0,
  add column if not exists excluded_message_count integer not null default 0,
  -- Nega chiqarib tashlangani: {"ai": 12, "deleted": 3, "failed": 1}
  add column if not exists excluded_reasons jsonb not null default '{}'::jsonb,

  -- Har sinf uchun alohida o'lchov: uzun shablon qisqa javobning
  -- medianasini buzmasin (20-band).
  add column if not exists class_metrics jsonb not null default '{}'::jsonb,

  add column if not exists previous_profile_id uuid references public.sales_style_profiles(id) on delete set null,
  add column if not exists diff_summary jsonb not null default '{}'::jsonb,
  add column if not exists coverage_note text,
  add column if not exists redacted_examples jsonb not null default '[]'::jsonb,
  add column if not exists run_id uuid references public.sales_mining_runs(id) on delete set null,

  add column if not exists activated_by uuid references auth.users(id) on delete set null,
  add column if not exists activated_at timestamptz;

-- Mavjud faol profil yangi ustunda ham faol ko'rinsin.
update public.sales_style_profiles
   set status = 'active'
 where is_active = true and status = 'draft';

create index if not exists idx_sales_style_status
  on public.sales_style_profiles(status, computed_at desc);

-- ------------------------------------------------------------
-- 7. SUHBAT XOTIRASI VA SALOMLASHISH SESSIYASI (23–26-band)
--
--    Bot oxirgi 10 xabarga tayanardi. Undan oldingi hamma narsa —
--    to'lov holati, berilgan va'da, javobsiz savol — yo'qolardi.
--    Shuning uchun tuzilmali xotira: u xabar oynasidan QAT'IY
--    NAZAR saqlanadi.
-- ------------------------------------------------------------
alter table public.sales_conversations
  -- Tuzilmali xotira (customer_goal, answered_topics, pending_questions,
  -- unresolved_objections, seller_promises, ...). Sxema kodda:
  -- src/lib/sales/memory/conversation-memory.ts
  add column if not exists memory jsonb not null default '{}'::jsonb,
  add column if not exists memory_updated_at timestamptz,

  -- SALOMLASHISH SESSIYASI (23-band): uzluksiz suhbatda qayta
  -- salomlashilmaydi. Uzoq tanaffusdan keyin sessiya yangilanadi.
  add column if not exists greeted_at timestamptz,
  add column if not exists greeting_session_started_at timestamptz;

create index if not exists idx_sales_conv_memory_updated
  on public.sales_conversations(memory_updated_at desc nulls last);

comment on column public.sales_conversations.memory is
  'Tuzilmali suhbat xotirasi. Xabar oynasi siljiganda ham yo''qolmaydi.';
comment on column public.sales_conversations.greeted_at is
  'Joriy sessiyada salomlashilgan vaqt. NULL — hali salomlashilmagan.';

-- ------------------------------------------------------------
-- 8. BARDOSHLI NAVBAT (27-band)
--
--    Qulf band bo'lsa engine `null` qaytarardi va webhook 200
--    berardi: xabar JIMGINA yo'qolardi. Tez ketma-ket yozilgan
--    savollarning ayrimi hech qachon javob olmasdi.
--
--    Statuslar kengaytiriladi (mavjudlari saqlanadi — bu
--    KENGAYTIRISH, tor qilish emas: eski qatorlar buzilmaydi).
-- ------------------------------------------------------------
alter table public.sales_ai_jobs
  drop constraint if exists sales_ai_jobs_status_check;
alter table public.sales_ai_jobs
  add constraint sales_ai_jobs_status_check check (status in (
    -- mavjud
    'pending', 'generating', 'generated', 'sending', 'sent',
    'failed_retryable', 'failed_final', 'human_required', 'skipped',
    -- 2-faza: bardoshli navbat
    'queued', 'claimed', 'waiting', 'succeeded', 'dead_letter'
  ));

alter table public.sales_ai_jobs
  -- LEASE/CLAIM semantikasi: worker ishni EGALLAYDI, muddat bilan.
  -- Worker o'lsa lease tugaydi va ish qaytadan olinadi.
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists lease_expires_at timestamptz,

  -- Qachondan boshlab olish mumkin (retry backoff).
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists max_attempts integer not null default 5,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists last_error_at timestamptz,

  -- SUHBAT ICHIDA TARTIB: bitta suhbatning ishlari navbat bilan
  -- bajariladi, aks holda ikkinchi javob birinchisidan oldin
  -- ketib qolishi mumkin.
  add column if not exists enqueued_at timestamptz not null default now(),
  add column if not exists priority integer not null default 100;

create index if not exists idx_sales_ai_job_claimable
  on public.sales_ai_jobs(available_at, priority, enqueued_at)
  where status in ('queued', 'waiting', 'failed_retryable');
create index if not exists idx_sales_ai_job_lease
  on public.sales_ai_jobs(lease_expires_at)
  where status = 'claimed';

comment on column public.sales_ai_jobs.lease_expires_at is
  'Lease muddati. O''tgan bo''lsa ish boshqa workerga o''tadi — o''lgan worker navbatni bloklamaydi.';

-- ------------------------------------------------------------
-- 9. FOLLOW-UP ATOMIK CLAIM (28-band)
--
--    Runner `pending` ni o'qib, yuborib, keyin `sent` qilardi.
--    Ikki parallel cron orasida bu oyna bor: ikkalasi ham bir
--    yozuvni o'qib, IKKI MARTA yuborishi mumkin edi.
-- ------------------------------------------------------------
alter table public.sales_followups
  drop constraint if exists sales_followups_status_check;
alter table public.sales_followups
  add constraint sales_followups_status_check check (status in (
    'pending', 'claimed', 'sent', 'cancelled', 'failed', 'skipped', 'unknown'
  ));

alter table public.sales_followups
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists lease_expires_at timestamptz,
  -- Telegram javobi noaniq bo'lsa (timeout): ko'r-ko'rona qayta
  -- yuborilmaydi, `unknown` bo'lib odam ko'rishi uchun qoladi.
  add column if not exists delivery_state text not null default 'pending'
    check (delivery_state in ('pending', 'delivered', 'failed', 'unknown'));

create index if not exists idx_sales_followup_claimable
  on public.sales_followups(scheduled_at)
  where status = 'pending';
create index if not exists idx_sales_followup_lease
  on public.sales_followups(lease_expires_at)
  where status = 'claimed';

-- ------------------------------------------------------------
-- 10. JAVOB NAMUNALARI — NAMUNA HAJMI KO'RINSIN (37-band)
--
--     `success_rate` bor edi, lekin u NECHTA holatdan chiqqani
--     ko'rinmasdi. 1/1 = 100% va 340/400 = 85% bir xil ko'rinardi.
-- ------------------------------------------------------------
alter table public.sales_response_patterns
  add column if not exists sample_n integer not null default 0,
  add column if not exists positive_followup_n integer not null default 0,
  add column if not exists intake_submitted_n integer not null default 0,
  add column if not exists payment_confirmed_n integer not null default 0,
  add column if not exists dropoff_n integer not null default 0,
  add column if not exists observation_window_days integer,
  -- "Strategiya" (tan olish, qiymat, bitta qadam) FAKTdan alohida.
  add column if not exists strategy_key text,
  add column if not exists confidence_note text,
  add column if not exists run_id uuid references public.sales_mining_runs(id) on delete set null;

comment on column public.sales_response_patterns.sample_n is
  'Kuzatilgan holatlar soni. Foiz HECH QACHON namuna hajmisiz ko''rsatilmaydi.';

-- ------------------------------------------------------------
-- 11. RLS — mavjud konvensiya bo'yicha
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sales_knowledge_conflicts', 'sales_objections',
    'sales_mining_runs', 'sales_mined_questions'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "sales viewers read" on public.%I', t);
    execute format(
      'create policy "sales viewers read" on public.%I for select
         to authenticated using (public.has_permission(''sales.view''))', t);

    execute format('drop policy if exists "sales managers write" on public.%I', t);
    execute format(
      'create policy "sales managers write" on public.%I for all
         to authenticated
         using (public.has_permission(''sales.manage''))
         with check (public.has_permission(''sales.manage''))', t);
  end loop;
end $$;

comment on table public.sales_mined_questions is
  'Qazilgan mijoz savollari — REDAKSIYADAN O''TGAN holda. Xom matn bu yerga tushmaydi.';
