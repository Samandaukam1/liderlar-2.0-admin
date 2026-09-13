-- ============================================================
-- AI SOTUV — REAL MIJOZGA JAVOB BERISH (production activation)
--
-- 0.2 gacha tizim O'RGANISH va SINOV uchun edi: bot mijozga yozmasdi,
-- yozish yo'li esa ataylab muhrlangan edi. Bu migratsiya o'sha
-- himoyalarni OLIB TASHLAMAYDI — ular ustiga real mijoz bilan
-- ishlash uchun kerak bo'lgan holatni qo'shadi.
--
-- QOIDA: hammasi qo'shimcha. Hech bir jadval tashlanmaydi, hech bir
-- ustun o'chirilmaydi, mavjud o'rganish tarixiga tegilmaydi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Suhbat: sotuv aqli uchun kerak bo'lgan holat
-- ------------------------------------------------------------
alter table public.sales_conversations
  -- E'TIROZLAR. Bitta xabarda bir nechtasi bo'lishi mumkin, shuning
  -- uchun massiv: ["PRICE","TRUST"]. Javob shularga qarab quriladi.
  add column if not exists objections jsonb not null default '[]'::jsonb,

  -- LEAD HARORATI. Mutlaq haqiqat emas — shuning uchun SABABLARI ham
  -- saqlanadi. Sonning o'zi mijozga hech qachon ko'rsatilmaydi.
  add column if not exists lead_temperature text not null default 'cold'
    check (lead_temperature in ('cold', 'warm', 'hot', 'payment_ready')),
  add column if not exists lead_score integer not null default 0,
  add column if not exists lead_score_reasons jsonb not null default '[]'::jsonb,

  -- OPT-OUT. "Boshqa yozmang" — avtomatik aloqa shu yerda tugaydi.
  -- Qayta ishontirishga urinish YO'Q.
  add column if not exists opted_out_at timestamptz,
  add column if not exists opt_out_reason text,

  -- INSON TALAB QILINADI. `ai_enabled = false` bilan birga yuradi,
  -- lekin alohida: "nega" degan savolga javob kerak.
  add column if not exists human_required_at timestamptz,
  add column if not exists human_required_reason text,
  add column if not exists handoff_summary text,

  -- ROLLING SUMMARY. Uzun suhbatni har safar to'liq modelga yuborish
  -- ham qimmat, ham kontekstni to'ldiradi. Eski qism shu yerda
  -- siqilgan holda turadi.
  add column if not exists context_summary text,
  add column if not exists summary_updated_at timestamptz,
  add column if not exists summarized_message_count integer not null default 0,

  -- YOSH. 18 dan kichik bo'lsa bosim o'tkazilmaydi (16-band).
  add column if not exists is_minor boolean not null default false,
  add column if not exists minor_signal text,

  -- KELAJAKDAGI HUDUDIY TIZIM (26-band). Hozir to'ldirilmaydi, lekin
  -- sxema tayyor: keyin ustun qo'shish jonli jadvalda qimmatroq.
  add column if not exists region_id uuid,
  add column if not exists assigned_coordinator_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists handoff_reason text,
  add column if not exists conversion_source text,

  -- JAVOB TEZLIGI — konversiyaning eng kuchli bashoratchisi.
  add column if not exists first_response_at timestamptz,
  add column if not exists human_first_response_at timestamptz,

  -- ROLLOUT. Foiz bo'yicha chiqarishda BARQAROR taqsimot kerak:
  -- har xabarda tasodif olinsa, bitta mijoz bir xabarga javob olib,
  -- keyingisiga olmay qolardi. Bu son bir marta yoziladi.
  add column if not exists rollout_bucket smallint;

create index if not exists idx_sales_conv_temperature
  on public.sales_conversations(lead_temperature)
  where opted_out_at is null;
create index if not exists idx_sales_conv_human_required
  on public.sales_conversations(human_required_at)
  where human_required_at is not null;

comment on column public.sales_conversations.lead_score is
  'Ichki ball. Mijozga HECH QACHON ko''rsatilmaydi; sabablari lead_score_reasons da.';
comment on column public.sales_conversations.rollout_bucket is
  'Foizli rollout uchun barqaror 0–99 raqam. Bir marta yoziladi va o''zgarmaydi.';

-- ------------------------------------------------------------
-- 2. Bilim bo'shliqlari — javobsiz qolgan savollar (25-band)
--
--    MISSING_KNOWLEDGE endi shunchaki log emas: har savol shu yerga
--    tushadi va necha marta so'ralgani sanaladi. Admin javobni yozib
--    tasdiqlaganda u bilim bazasiga o'tadi.
--
--    MODEL TAXMINI AVTOMATIK TASDIQLANMAYDI — `status` faqat odam
--    qo'li bilan 'answered' bo'ladi.
-- ------------------------------------------------------------
create table if not exists public.sales_knowledge_gaps (
  id uuid primary key default gen_random_uuid(),

  -- Takrorlarni birlashtirish uchun normallashtirilgan shakl.
  normalized_question text not null,
  question text not null,

  ask_count integer not null default 1,
  first_asked_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),

  -- Qaysi suhbatlarda so'ralgani (eng oxirgi bir nechtasi).
  example_contexts jsonb not null default '[]'::jsonb,
  last_conversation_id uuid references public.sales_conversations(id) on delete set null,

  -- AI o'sha paytda nima degani — admin fallback sifatini ko'rishi uchun.
  ai_fallback text,

  status text not null default 'open'
    check (status in ('open', 'answered', 'ignored')),
  answer text,
  answered_by uuid references auth.users(id) on delete set null,
  answered_at timestamptz,
  knowledge_id uuid references public.sales_knowledge(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bir savol bir qator: takror kelganda ask_count oshadi.
create unique index if not exists uq_sales_gap_question
  on public.sales_knowledge_gaps(normalized_question);
create index if not exists idx_sales_gap_open
  on public.sales_knowledge_gaps(status, ask_count desc);

drop trigger if exists trg_sales_gaps_updated on public.sales_knowledge_gaps;
create trigger trg_sales_gaps_updated
  before update on public.sales_knowledge_gaps
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. AI javob ishlari — yaratish hayot sikli (3-band)
--
--    Kiruvchi xabar YO'QOLMASLIGI kerak. Model yiqilsa ish
--    'failed_retryable' bo'lib qoladi va keyingi tikda qaytariladi;
--    bu jadvalsiz bunday xabar jimgina g'oyib bo'lardi.
--
--    IDEMPOTENTLIK: bitta kiruvchi xabarga bitta ish. Telegram
--    update'ni ikki marta yetkazsa, ikkinchisi unikal indeksga
--    urilib to'xtaydi va mijoz ikkita javob olmaydi.
-- ------------------------------------------------------------
create table if not exists public.sales_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sales_conversations(id) on delete cascade,
  message_id uuid references public.sales_messages(id) on delete set null,

  status text not null default 'pending'
    check (status in (
      'pending', 'generating', 'generated', 'sending', 'sent',
      'failed_retryable', 'failed_final', 'human_required', 'skipped'
    )),

  attempts integer not null default 0,
  next_attempt_at timestamptz,

  generation_type text not null default 'reply'
    check (generation_type in ('reply', 'followup', 'fallback', 'objection')),

  request_intent text,
  objections jsonb not null default '[]'::jsonb,
  reply_body text,
  refusal_reason text,
  error text,

  model text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  estimated_cost_usd numeric(12, 6),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bitta kiruvchi xabar — bitta ish. Qisman emas: upsert maqsadi
-- bo'lishi uchun indeks to'liq bo'lishi shart.
create unique index if not exists uq_sales_ai_job_message
  on public.sales_ai_jobs(message_id);
create index if not exists idx_sales_ai_job_retry
  on public.sales_ai_jobs(status, next_attempt_at)
  where status = 'failed_retryable';
create index if not exists idx_sales_ai_job_conversation
  on public.sales_ai_jobs(conversation_id, created_at desc);

drop trigger if exists trg_sales_ai_jobs_updated on public.sales_ai_jobs;
create trigger trg_sales_ai_jobs_updated
  before update on public.sales_ai_jobs
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 4. RLS — mavjud konvensiya bo'yicha
-- ------------------------------------------------------------
alter table public.sales_knowledge_gaps enable row level security;
alter table public.sales_ai_jobs enable row level security;

do $$
begin
  execute format(
    'drop policy if exists "sales gaps read" on public.sales_knowledge_gaps'
  );
  execute format(
    'create policy "sales gaps read" on public.sales_knowledge_gaps for select using (public.has_permission(%L))',
    'sales.view'
  );
  execute format(
    'drop policy if exists "sales ai jobs read" on public.sales_ai_jobs'
  );
  execute format(
    'create policy "sales ai jobs read" on public.sales_ai_jobs for select using (public.has_permission(%L))',
    'sales.view'
  );
end $$;

-- ------------------------------------------------------------
-- 5. Rollout sozlamasi
--
--    OFF dan to'g'ridan-to'g'ri hamma mijozga o'tilmaydi (28-band).
--    Standart — OFF: kod deploy bo'lgani bilan bot jim qoladi.
-- ------------------------------------------------------------
insert into public.sales_settings (key, value) values
  ('rollout', jsonb_build_object(
    'mode', 'off',
    'allowlistChatIds', '[]'::jsonb,
    'percentage', 0
  ))
on conflict (key) do nothing;
