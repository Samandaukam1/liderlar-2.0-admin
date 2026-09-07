-- ============================================================
-- AI Sotuv boti 0.1 — Telegram Business chatlarini yig'ish va o'rganish
--
-- NEGA BUTUNLAY ALOHIDA JADVAL OILASI (telegram_post_* ga qo'shilmadi):
--   `telegram_post_subscribers` / `telegram_post_deliveries` — bu POST
--   YETKAZIB BERISH tizimi: kanal obunachisi, yuborilgan post, yetkazish
--   statusi. Uning yozuvi "bitta post -> ko'p obunachi" shaklida.
--   Sotuv boti esa teskari: "bitta mijoz -> uzoq davom etadigan suhbat".
--   Unda thread, yo'nalish (kim yozdi), tahrir/o'chirish tarixi va
--   o'rganish holati bor — birortasi ham post yetkazishga tegishli emas.
--
--   Eng muhimi: ikkalasi IKKI XIL BOT. Post boti TELEGRAM_BOT_TOKEN bilan,
--   sotuv boti SALES_TELEGRAM_BOT_TOKEN bilan ishlaydi. Bir jadvalga
--   qo'shilsa, bitta noto'g'ri so'rov sotuv suhbatini post obunachisiga
--   aylantirib qo'yishi mumkin edi. Ular hech qayerda kesishmaydi.
--
-- 0.1 DOIRASI: bot O'QIYDI, SAQLAYDI, TAHLIL QILADI, O'RGANADI.
--   Mijozga avtomatik javob YO'Q. Shuning uchun bu yerda javob navbati,
--   draft javob yoki yuborish statusi jadvali ATAYLAB yo'q — 0.2 da
--   qo'shiladi.
--
-- QOIDA: non-destructive va idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Business ulanishlari
--    Telegram "Chatlarni avtomatlashtirish" orqali bot biznes akkauntga
--    ulanganda keladigan `business_connection` update'i.
-- ------------------------------------------------------------
create table if not exists public.sales_business_connections (
  id uuid primary key default gen_random_uuid(),

  -- Telegram bergan ulanish identifikatori. Har business_message shu
  -- qiymat bilan keladi va suhbatni ulanishga bog'laydigan yagona kalit.
  telegram_connection_id text not null,

  -- Biznes akkaunt EGASI (bizning sotuvchimiz). Yo'nalishni aniqlashda
  -- eng ishonchli manba: from.id == owner => outgoing.
  owner_telegram_user_id bigint,
  owner_username text,

  -- Telegram ulanishni o'chirsa (is_enabled=false) yozuv qolaveradi:
  -- eski suhbatlar unga bog'langan va ular yo'qolmasligi kerak.
  is_enabled boolean not null default true,
  -- Bot javob yozish huquqiga ega yoki yo'qligi. 0.1 da BIZ BARIBIR
  -- yozmaymiz — bu faqat Telegram nima berganini qayd etadi.
  can_reply boolean not null default false,

  connected_at timestamptz,
  disconnected_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upsert nishoni. Qisman (partial) EMAS: `on conflict` qisman indeksni
-- nishon qilib ololmaydi va importchi aynan shunda sinadi.
create unique index if not exists uq_sales_business_connections_tg
  on public.sales_business_connections(telegram_connection_id);

-- ------------------------------------------------------------
-- 2. Mijozlar
--    Shaxsiy chatda mijoz = chat egasi. Yozuv `chat` dan olinadi,
--    `from` dan emas: outgoing xabarda `from` — bizning sotuvchimiz.
-- ------------------------------------------------------------
create table if not exists public.sales_contacts (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  username text,
  first_name text,
  last_name text,
  language_code text,
  is_bot boolean not null default false,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_contacts_tg_user
  on public.sales_contacts(telegram_user_id);

-- ------------------------------------------------------------
-- 3. Suhbatlar
--    O'rganish progressining MAXRAJI aynan shu jadval (real saqlangan
--    yoki import qilingan suhbatlar). Telegram'dagi "barcha eski chatlar"
--    emas — Bot API o'tmishdagi yozishmalarni bermaydi va biz uni
--    bilgandek ko'rsatmaymiz.
-- ------------------------------------------------------------
create table if not exists public.sales_conversations (
  id uuid primary key default gen_random_uuid(),

  business_connection_id text not null,
  connection_id uuid references public.sales_business_connections(id) on delete set null,
  contact_id uuid references public.sales_contacts(id) on delete set null,
  chat_id bigint not null,
  chat_title text,

  -- 'telegram_business' — webhook orqali jonli keldi.
  -- 'import'           — qo'lda/eksportdan yuklandi.
  source text not null default 'telegram_business'
    check (source in ('telegram_business', 'import')),

  message_count integer not null default 0,
  incoming_count integer not null default 0,
  outgoing_count integer not null default 0,

  first_message_at timestamptz,
  last_message_at timestamptz,

  -- O'rganish holati. 'skipped' — suhbat juda qisqa yoki mazmunsiz.
  learning_status text not null default 'pending'
    check (learning_status in ('pending', 'learning', 'learned', 'failed', 'skipped')),
  learned_at timestamptz,
  learning_error text,
  last_learning_job_id uuid,

  -- O'rganilgan paytdagi transkript xesh'i. Suhbatga yangi xabar
  -- qo'shilsa xesh o'zgaradi va suhbat qayta o'rganishga tushadi —
  -- o'zgarmagani esa AI'ga ikkinchi marta yuborilmaydi.
  learned_content_hash text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_conversations_chat
  on public.sales_conversations(business_connection_id, chat_id);
create index if not exists idx_sales_conversations_learning
  on public.sales_conversations(learning_status);
create index if not exists idx_sales_conversations_last_message
  on public.sales_conversations(last_message_at desc nulls last);
create index if not exists idx_sales_conversations_contact
  on public.sales_conversations(contact_id);

-- ------------------------------------------------------------
-- 4. Xabarlar
--    XOM SUHBAT SHU YERDA. Faqat admin ko'radi (RLS pastda).
--    Bilim bazasiga chiqishdan oldin matn redaksiyadan o'tadi.
-- ------------------------------------------------------------
create table if not exists public.sales_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sales_conversations(id) on delete cascade,

  telegram_message_id bigint not null,
  business_connection_id text not null,
  chat_id bigint not null,

  -- Xabarni YOZGAN odam. Outgoing'da bu bizning sotuvchimiz, shuning
  -- uchun u suhbat mijozi bilan bir xil bo'lishi shart emas.
  telegram_user_id bigint,
  username text,

  direction text not null check (direction in ('incoming', 'outgoing')),
  message_type text not null default 'text',
  text text,

  sent_at timestamptz not null,
  edited_at timestamptz,
  -- Telegram'da o'chirilgan xabar. Yozuv O'CHIRILMAYDI: o'rganilgan
  -- bilim qaysi xabardan kelganini ko'rsatib turishi kerak.
  deleted_at timestamptz,

  -- MINIMAL metadata. Bu yerga fayl id'lari, telefon, token yoki
  -- to'lov rekviziti YOZILMAYDI — faqat xabarning shakli haqidagi
  -- faktlar (javobmi, forwardmi, media bormi).
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- TAKRORLANISHDAN HIMOYA. Telegram bitta update'ni bir necha marta
-- yetkazishi odatiy hol (webhook 200 ni ko'rmasa qayta uradi). Shu
-- indeks tufayli ikkinchi yetkazish yangi qator yaratmaydi.
create unique index if not exists uq_sales_messages_tg
  on public.sales_messages(business_connection_id, chat_id, telegram_message_id);
create index if not exists idx_sales_messages_conversation
  on public.sales_messages(conversation_id, sent_at);
create index if not exists idx_sales_messages_direction
  on public.sales_messages(direction, sent_at desc);

-- ------------------------------------------------------------
-- 5. O'rganish yugurishlari
-- ------------------------------------------------------------
create table if not exists public.sales_learning_jobs (
  id uuid primary key default gen_random_uuid(),

  kind text not null default 'knowledge'
    check (kind in ('knowledge', 'style', 'both')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'partial')),

  -- Yugurish boshlanganda maxraj (o'sha ondagi jami suhbatlar) qayd
  -- etiladi: keyin yangi suhbat kelsa ham tarixiy foiz o'zgarmaydi.
  total_conversations integer not null default 0,
  selected_conversations integer not null default 0,
  processed_conversations integer not null default 0,
  failed_conversations integer not null default 0,
  knowledge_created integer not null default 0,
  messages_analyzed integer not null default 0,

  model text,
  error text,

  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_learning_jobs_created
  on public.sales_learning_jobs(created_at desc);

-- ------------------------------------------------------------
-- 6. Bilim bazasi (FAKT)
--    Uslub bu yerda EMAS (7-jadvalga qarang). Ajratishning sababi:
--    fakt eskiradi va tasdiqlanadi, uslub esa o'lchanadi va o'rtachalanadi.
--    Bir jadvalda turса, "narx 500 000" faktini tasdiqlash sotuvchining
--    gap uslubini ham tasdiqlangan qilib qo'yardi.
-- ------------------------------------------------------------
create table if not exists public.sales_knowledge (
  id uuid primary key default gen_random_uuid(),

  category text not null check (category in (
    'question', 'answer', 'service_fact', 'price', 'faq', 'objection',
    'sales_argument', 'cta', 'follow_up', 'application', 'payment', 'post_article'
  )),

  -- Savol / sarlavha va javob / mazmun. Ikkalasi ham REDAKSIYADAN
  -- O'TGAN matn: telefon, karta, chek, token va shaxsiy hujjat raqami
  -- bu yerga hech qachon tushmaydi.
  question text,
  answer text not null,

  tags text[] not null default '{}'::text[],
  confidence numeric(3, 2) not null default 0.50
    check (confidence >= 0 and confidence <= 1),

  -- 0.1 da AI chiqargan hamma narsa QORALAMA. Admin tasdiqlamaguncha
  -- hech qayerda ishlatilmaydi.
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected')),

  -- IZLANUVCHANLIK: har bir bilim qaysi suhbat va qaysi xabardan
  -- kelganini ko'rsatadi. `source_conversation_id` majburiy — manbasiz
  -- bilim "AI o'ylab topgan" degani va u bu jadvalga kirmaydi.
  source_conversation_id uuid not null references public.sales_conversations(id) on delete cascade,
  source_message_id uuid references public.sales_messages(id) on delete set null,
  source_excerpt text,

  job_id uuid references public.sales_learning_jobs(id) on delete set null,

  -- Bir xil savol-javob ikkinchi suhbatda ham chiqsa yangi qator
  -- yaratilmaydi: shu kalit bo'yicha upsert qilinadi.
  dedupe_key text not null,

  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_knowledge_dedupe
  on public.sales_knowledge(dedupe_key);
create index if not exists idx_sales_knowledge_status
  on public.sales_knowledge(status, category);
create index if not exists idx_sales_knowledge_source
  on public.sales_knowledge(source_conversation_id);

-- ------------------------------------------------------------
-- 7. Yozuv uslubi profillari (USLUB)
--    Faqat O'LCHOV saqlanadi: gap uzunligi, emoji chastotasi, siz/sen,
--    ohang, tinish belgilari, yozuv (lotin/kirill) va RAQAMSIZ shablon
--    (masalan "Narxi {NARX} so'm"). Fakt shu yerga tushmasligi uchun
--    barcha son maskalanadi.
-- ------------------------------------------------------------
create table if not exists public.sales_style_profiles (
  id uuid primary key default gen_random_uuid(),

  name text not null default 'Asosiy uslub',
  -- Bir vaqtda bitta aktiv profil (pastdagi qisman unikal indeks).
  is_active boolean not null default false,

  -- Tahlil qamrovi — "nechta xabar asosida" degan savolga halol javob.
  sample_conversation_count integer not null default 0,
  sample_message_count integer not null default 0,
  -- Recency og'irliklari qo'llangandan keyingi yig'indi.
  weighted_sample numeric(10, 2) not null default 0,

  -- O'lchovlar. Sxema src/lib/sales/style.ts dagi StyleProfile bilan bir xil.
  profile jsonb not null default '{}'::jsonb,
  -- Tahlil paytida qo'llangan recency og'irliklari — natijani qayta
  -- tiklab bo'lishi uchun.
  recency_buckets jsonb not null default '[]'::jsonb,

  job_id uuid references public.sales_learning_jobs(id) on delete set null,
  computed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_style_profiles_active
  on public.sales_style_profiles(is_active) where is_active = true;
create index if not exists idx_sales_style_profiles_computed
  on public.sales_style_profiles(computed_at desc);

-- ------------------------------------------------------------
-- 8. Sozlamalar
--    Recency og'irliklari va o'rganish parametrlari kod ichida QOTIB
--    qolmasin — talab shuni aytadi.
-- ------------------------------------------------------------
create table if not exists public.sales_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.sales_settings (key, value) values
  ('recency_buckets', '[
     {"maxAgeDays": 7,    "weight": 1.00},
     {"maxAgeDays": 30,   "weight": 0.80},
     {"maxAgeDays": 90,   "weight": 0.50},
     {"maxAgeDays": 180,  "weight": 0.30},
     {"maxAgeDays": null, "weight": 0.15}
   ]'::jsonb),
  ('learning', '{"batchSize": 25, "minMessagesPerConversation": 4}'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- updated_at triggerlari
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sales_business_connections', 'sales_contacts', 'sales_conversations',
    'sales_knowledge', 'sales_style_profiles'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Ruxsatlar — src/lib/permissions.ts matritsasining SQL nusxasi
-- ------------------------------------------------------------
insert into public.role_permissions (role_slug, permission) values
  ('admin', 'sales.view'),
  ('admin', 'sales.manage'),
  ('admin', 'sales.learn'),
  ('moderator', 'sales.view'),
  ('analyst', 'sales.view'),
  ('viewer', 'sales.view')
on conflict do nothing;

-- ------------------------------------------------------------
-- RLS
--    Bu jadvallarning BIRORTASIDA public policy yo'q. Xom suhbat —
--    mijozning shaxsiy yozishmasi; u anon rolga hech qanday shaklda
--    ochilmaydi.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sales_business_connections', 'sales_contacts', 'sales_conversations',
    'sales_messages', 'sales_learning_jobs', 'sales_knowledge',
    'sales_style_profiles', 'sales_settings'
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

comment on table public.sales_messages is
  'AI Sotuv botining XOM suhbati. Faqat sales.view ruxsatiga ega admin ko''radi; public policy ataylab yo''q.';
comment on table public.sales_knowledge is
  'Fakt bilimi. Uslub bu yerda emas — sales_style_profiles da. Har yozuv manba suhbatga bog''langan va redaksiyadan o''tgan.';
comment on table public.sales_style_profiles is
  'Yozuv uslubi o''lchovlari. Fakt saqlamaydi: barcha son maskalangan shablon sifatida yoziladi.';
comment on column public.sales_conversations.learned_content_hash is
  'O''rganilgan paytdagi transkript xesh''i. O''zgarmagan suhbat AI''ga qayta yuborilmaydi.';
