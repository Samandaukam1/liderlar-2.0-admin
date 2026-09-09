-- ============================================================
-- ai_jobs: token sarfi va taxminiy narx
--
-- MUAMMO: jadval `input_chars` va `output_chars` ni yozardi, lekin
-- TOKEN yozmasdi. Belgilar soni bilan hisobni bog'lab bo'lmaydi —
-- narx tokenga bog'liq va u modelga qarab o'n barobar farq qiladi.
-- Natijada "maqolalar qimmatga tushyapti" degan savolga javob berish
-- uchun o'lchov umuman yo'q edi: qaysi ish, qaysi model va qancha
-- token yeganini hech kim ko'ra olmasdi.
--
-- Endi har yugurish o'z sarfini yozadi. `estimated_cost_usd` NULL
-- bo'lishi MUMKIN — narxi noma'lum model uchun taxmin qilinmaydi.
--
-- QOIDA: non-destructive va idempotent.
-- ============================================================

alter table public.ai_jobs
  add column if not exists prompt_tokens integer
    check (prompt_tokens is null or prompt_tokens >= 0),
  add column if not exists completion_tokens integer
    check (completion_tokens is null or completion_tokens >= 0),
  add column if not exists total_tokens integer
    check (total_tokens is null or total_tokens >= 0),
  -- Narxi noma'lum modelda NULL qoladi, 0 emas: nol "bepul" degani.
  add column if not exists estimated_cost_usd numeric(10, 4),
  -- Maqola uchun nechta urinish ketgani — eng qimmat takror shu.
  add column if not exists attempts integer not null default 1;

create index if not exists idx_ai_jobs_model_created
  on public.ai_jobs(model, created_at desc);

comment on column public.ai_jobs.estimated_cost_usd is
  'Taxminiy narx. NULL — model narxi jadvalda yo''q, taxmin qilinmagan.';
comment on column public.ai_jobs.attempts is
  'Nechta model chaqiruvi ketgan. Maqolada 1-3 bo''lishi mumkin.';
