-- ============================================================
-- AI Sotuv — CHUQUR O'RGANISH
--
-- 0.1 da bitta suhbatdan alohida faktlar ajratilardi. Bu yetarli emas:
-- "narxi qancha?" savolini ko'rish mumkin edi, lekin unga QANDAY javob
-- berilgani va o'sha javob NIMA BILAN tugagani ko'rinmasdi.
--
-- Bu migratsiya uchta yangi qatlam qo'shadi:
--   1. NIYAT (sales_intents) — bir xil ma'nodagi savollar klasteri.
--   2. JAVOB SHABLONI (sales_response_patterns) — "shu savolga biz shunday
--      javob berganmiz" + chastota + natija.
--   3. NATIJA (sales_conversations.outcome) — suhbat ariza/to'lov/yakun
--      bilan tugadimi.
--
-- MAVJUD 0.1 SXEMASI BUZILMAYDI. Bitta ustun ham o'chirilmaydi va
-- o'zgartirilmaydi; `learning_status` / `learned_content_hash` 0.1
-- oqimida qanday bo'lsa shunday qoladi. Chuqur o'rganish o'zining
-- ALOHIDA holat ustunlaridan foydalanadi (deep_*), shuning uchun ikki
-- oqim bir-birini navbatga qaytarib yubormaydi.
--
-- QOIDA: non-destructive va idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Suhbat natijasi va chuqur o'rganish holati
-- ------------------------------------------------------------
alter table public.sales_conversations
  -- Natija AI'siz, faqat aniq belgilar bo'yicha aniqlanadi
  -- (src/lib/sales/outcome.ts). Belgisi yo'q suhbat 'unknown' bo'lib
  -- qoladi — taxmin qilib "muvaffaqiyatli" deb belgilanmaydi.
  add column if not exists outcome text not null default 'unknown'
    check (outcome in ('unknown', 'dropped', 'continued', 'application_sent',
                       'payment_requested', 'paid', 'completed')),
  add column if not exists outcome_detected_at timestamptz,
  -- Xulosani bergan xabar: adminda "nega shunday" savoliga javob.
  add column if not exists outcome_evidence_message_id uuid
    references public.sales_messages(id) on delete set null,
  add column if not exists outcome_signals jsonb not null default '{}'::jsonb,

  -- Chuqur o'rganishning O'Z holati. 0.1 dagi learning_status ga
  -- tegilmaydi: ikki oqim mustaqil ishlaydi.
  add column if not exists deep_learning_status text not null default 'pending'
    check (deep_learning_status in ('pending', 'learning', 'learned', 'failed', 'skipped')),
  add column if not exists deep_learned_at timestamptz,
  -- IDEMPOTENTLIK: o'rganilgan paytdagi xabarlar oralig'ining xesh'i
  -- (birinchi/oxirgi xabar + soni). O'zgarmagan suhbat qayta modelga
  -- yuborilmaydi va takroriy pattern yaratmaydi.
  add column if not exists deep_learned_hash text,
  add column if not exists deep_learned_message_count integer not null default 0,
  add column if not exists deep_learning_job_id uuid,
  -- Shu suhbatdan chiqarilgan niyat va javob kuzatuvlari.
  --
  -- NEGA SUHBAT QATORIDA SAQLANADI: yugurish yakunida statistika BARCHA
  -- tanlangan 500 suhbat bo'yicha hisoblanadi, lekin ulardan faqat
  -- o'zgarganlari modelga yuboriladi. O'zgarmagani uchun kuzatuv shu
  -- yerdan qayta o'qiladi — natijada takroriy AI chaqiruvi ham, ikki
  -- marta sanash ham bo'lmaydi.
  add column if not exists deep_observations jsonb not null default '{}'::jsonb;

create index if not exists idx_sales_conversations_outcome
  on public.sales_conversations(outcome);
create index if not exists idx_sales_conversations_deep_status
  on public.sales_conversations(deep_learning_status);

-- ------------------------------------------------------------
-- 2. O'rganish yugurishi — progress, token va resume
-- ------------------------------------------------------------
alter table public.sales_learning_jobs
  add column if not exists stage text not null default 'queued',
  -- Foiz HAQIQIY sanoqdan hisoblanadi (processed/target), taymerdan emas.
  add column if not exists progress_percent numeric(5, 2) not null default 0,
  add column if not exists target_conversations integer not null default 0,
  add column if not exists processed_messages integer not null default 0,
  add column if not exists total_messages integer not null default 0,
  add column if not exists batch_size integer not null default 15,
  add column if not exists prompt_tokens integer not null default 0,
  add column if not exists completion_tokens integer not null default 0,
  add column if not exists total_tokens integer not null default 0,
  -- Model narxi noma'lum bo'lsa NULL qoladi — 0 deb ko'rsatilmaydi.
  add column if not exists estimated_cost_usd numeric(10, 4),
  -- Uzilgan yugurishni davom ettirish uchun.
  add column if not exists resumed_from_job_id uuid references public.sales_learning_jobs(id) on delete set null,
  add column if not exists heartbeat_at timestamptz,
  -- Yakuniy yig'indi (top niyatlar, e'tirozlar, natijalar taqsimoti).
  add column if not exists aggregate jsonb not null default '{}'::jsonb;

-- 'deep' turi qo'shiladi. Eski check olib tashlanib qayta qo'yiladi —
-- mavjud qatorlarning qiymati o'zgarmaydi.
alter table public.sales_learning_jobs drop constraint if exists sales_learning_jobs_kind_check;
alter table public.sales_learning_jobs
  add constraint sales_learning_jobs_kind_check
  check (kind in ('knowledge', 'style', 'both', 'deep'));

-- ------------------------------------------------------------
-- 3. Batch checkpointlari — uzilsa davom etadi
-- ------------------------------------------------------------
create table if not exists public.sales_learning_batches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.sales_learning_jobs(id) on delete cascade,
  batch_index integer not null,

  conversation_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),

  messages_processed integer not null default 0,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  -- Batch natijasi (niyat/pattern kuzatuvlari). Yugurish uzilib qayta
  -- boshlansa, tugagan batch QAYTA ISHLANMAYDI — natija shu yerdan olinadi.
  result jsonb not null default '{}'::jsonb,
  error text,

  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- Upsert nishoni. Qisman EMAS.
create unique index if not exists uq_sales_learning_batches_job_index
  on public.sales_learning_batches(job_id, batch_index);
create index if not exists idx_sales_learning_batches_status
  on public.sales_learning_batches(job_id, status);

-- ------------------------------------------------------------
-- 4. Niyatlar (savol klasterlari)
--
--    MUHIM: bu jadval oldindan to'ldirilmaydi. src/lib/sales/intents.ts
--    dagi ro'yxat — modelga beriladigan LUG'AT, ma'lumot emas. Qator
--    faqat real suhbatda uchragan niyat uchun yaratiladi va uning
--    `occurrences` qiymati haqiqiy sanoq bo'ladi.
-- ------------------------------------------------------------
create table if not exists public.sales_intents (
  id uuid primary key default gen_random_uuid(),

  intent_key text not null,
  label text not null,
  kind text not null default 'question' check (kind in ('question', 'objection')),
  -- Lug'atdagi niyatmi yoki model topgan yangisimi.
  is_known boolean not null default true,

  occurrences integer not null default 0,
  conversation_count integer not null default 0,
  -- Barcha kuzatilgan savollar ichidagi ulush, foizda.
  share numeric(5, 2) not null default 0,
  -- Turli so'rash shakllari — klaster haqiqatan bir xilligini ko'rsatadi.
  examples text[] not null default '{}'::text[],
  conversation_ids uuid[] not null default '{}'::uuid[],

  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected')),

  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_job_id uuid references public.sales_learning_jobs(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_intents_key
  on public.sales_intents(intent_key);
create index if not exists idx_sales_intents_occurrences
  on public.sales_intents(occurrences desc);
create index if not exists idx_sales_intents_kind
  on public.sales_intents(kind, status);

-- ------------------------------------------------------------
-- 5. Javob shablonlari (response library)
--
--    Bitta niyatga bir nechta variant bo'lishi mumkin va har birining
--    o'z chastotasi va natijasi bor. `success_rate` NULL bo'lishi
--    MUMKIN — barcha natija noma'lum bo'lsa, 0% deb ko'rsatish
--    "yomon javob" degan yolg'on xulosa berardi.
-- ------------------------------------------------------------
create table if not exists public.sales_response_patterns (
  id uuid primary key default gen_random_uuid(),

  intent_id uuid references public.sales_intents(id) on delete set null,
  intent_key text not null,
  intent_label text not null,
  intent_kind text not null default 'question' check (intent_kind in ('question', 'objection')),

  -- Ikkalasi ham REDAKSIYADAN O'TGAN asl matn. Model qayta yozgan
  -- variant emas: shablon biz haqiqatan yozgan javob bo'lishi kerak.
  customer_example text not null,
  response_example text not null,

  frequency integer not null default 0,
  success_count integer not null default 0,
  unknown_count integer not null default 0,
  success_rate numeric(5, 2),

  last_seen_at timestamptz,
  recency_weight numeric(4, 2) not null default 0,

  conversation_ids uuid[] not null default '{}'::uuid[],
  source_message_ids uuid[] not null default '{}'::uuid[],

  -- 0.1 dagi bilim kabi: AI ishlatishidan oldin admin tasdiqlashi shart.
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,

  last_job_id uuid references public.sales_learning_jobs(id) on delete set null,
  dedupe_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_response_patterns_dedupe
  on public.sales_response_patterns(dedupe_key);
create index if not exists idx_sales_response_patterns_intent
  on public.sales_response_patterns(intent_key, frequency desc);
create index if not exists idx_sales_response_patterns_status
  on public.sales_response_patterns(status);

-- ------------------------------------------------------------
-- 6. Sozlamalar
-- ------------------------------------------------------------
insert into public.sales_settings (key, value) values
  ('deep_learning', '{"targetConversations": 500, "batchSize": 15, "maxMessagesPerConversation": 400}'::jsonb)
on conflict (key) do nothing;

-- Recency jadvali yetti pog'onaga o'tdi.
--
-- FAQAT TEGILMAGAN QIYMAT KO'CHIRILADI: `where value = <0.1 defaulti>`
-- sharti admin qo'lda sozlagan jadvalni ustidan yozib yuborishning
-- oldini oladi. Sozlama o'zgartirilgan bo'lsa u o'z holicha qoladi.
update public.sales_settings
   set value = '[
         {"maxAgeDays": 3,    "weight": 1.00},
         {"maxAgeDays": 7,    "weight": 0.95},
         {"maxAgeDays": 14,   "weight": 0.85},
         {"maxAgeDays": 30,   "weight": 0.70},
         {"maxAgeDays": 60,   "weight": 0.45},
         {"maxAgeDays": 90,   "weight": 0.30},
         {"maxAgeDays": null, "weight": 0.15}
       ]'::jsonb,
       updated_at = now()
 where key = 'recency_buckets'
   and value = '[
         {"maxAgeDays": 7,    "weight": 1.00},
         {"maxAgeDays": 30,   "weight": 0.80},
         {"maxAgeDays": 90,   "weight": 0.50},
         {"maxAgeDays": 180,  "weight": 0.30},
         {"maxAgeDays": null, "weight": 0.15}
       ]'::jsonb;

-- ------------------------------------------------------------
-- updated_at triggerlari + RLS (0.1 dagi konvensiya bilan bir xil)
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sales_intents', 'sales_response_patterns'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array[
    'sales_intents', 'sales_response_patterns', 'sales_learning_batches'
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

comment on table public.sales_intents is
  'Savol niyatlari klasteri. Oldindan to''ldirilmaydi — har qator real suhbatda uchragan savolga tayanadi.';
comment on table public.sales_response_patterns is
  'Javob kutubxonasi: bitta niyatga bir nechta variant, har birining chastotasi va natijasi. Matn modeldan emas, asl yozishmadan olinadi.';
comment on column public.sales_response_patterns.success_rate is
  'NULL — barcha natija noma''lum. 0 dan farq qiladi: 0 "ishlamadi", NULL "bilmaymiz".';
comment on column public.sales_conversations.deep_learned_hash is
  'Xabarlar oralig''ining xesh''i. O''zgarmagan suhbat qayta o''rganilmaydi (idempotentlik).';
