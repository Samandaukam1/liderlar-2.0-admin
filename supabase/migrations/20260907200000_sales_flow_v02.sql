-- ============================================================
-- AI Sotuv 0.2 — REAL SOTUV OQIMI
--
-- 0.1 da bot faqat O'QIRDI. 0.2 da u ssenariy bo'yicha JAVOB YOZADI.
-- Bu jiddiy o'zgarish, shuning uchun himoya ham shu darajada:
--
--   · `sales_stage` — har suhbat qaysi qadamda turgani. Xabar yuborish
--     faqat kutilgan bosqichda mumkin, ya'ni "tasodifan" xabar ketmaydi.
--   · `ai_enabled` — inson qo'lga olsa (human takeover) AI butunlay
--     jim bo'ladi: na javob, na follow-up.
--   · `lock_token` / `lock_expires_at` — bitta suhbatni ikki worker
--     bir vaqtda ishlamaydi. Telegram takroriy update yuborsa ham
--     ikkinchi javob ketmaydi.
--   · `sales_outbound_log` — YUBORILGAN har bir xabar yozib boriladi.
--     "Bot nima dedi?" degan savolga taxmin emas, yozuv javob beradi.
--
-- MAVJUD MA'LUMOT BUZILMAYDI: bitta ustun ham o'chirilmaydi va
-- qayta nomlanmaydi; 0.1 va chuqur o'rganish oqimlari o'z holicha
-- ishlayveradi.
--
-- QOIDA: non-destructive va idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Suhbat: bosqich, inson nazorati, anketa va to'lov
-- ------------------------------------------------------------
alter table public.sales_conversations
  add column if not exists sales_stage text not null default 'new'
    check (sales_stage in (
      'new', 'application_confirm', 'benefits_question', 'benefits_sent',
      'offer_sent', 'waiting_offer_review', 'article_decision', 'need_full_name',
      'intake_link_sent', 'waiting_intake', 'intake_submitted', 'payment_requested',
      'waiting_payment', 'payment_review', 'paid', 'declined', 'followup_later',
      'completed'
    )),
  add column if not exists stage_updated_at timestamptz,

  -- INSON NAZORATI. `false` bo'lsa AI bu suhbatda umuman gapirmaydi.
  add column if not exists ai_enabled boolean not null default true,
  add column if not exists takeover_by uuid references auth.users(id) on delete set null,
  add column if not exists takeover_at timestamptz,

  -- Mijozdan olingan to'liq F.I.Sh. va undan yaratilgan anketa.
  add column if not exists customer_full_name text,
  add column if not exists intake_id uuid references public.candidate_intakes(id) on delete set null,
  -- Xom token SAQLANMAYDI — faqat prefiks (mavjud anketa tizimidagi kabi).
  add column if not exists intake_link_prefix text,
  add column if not exists intake_link_expires_at timestamptz,

  add column if not exists payment_status text not null default 'none'
    check (payment_status in ('none', 'requested', 'evidence_received', 'paid')),
  add column if not exists paid_at timestamptz,
  add column if not exists payment_confirmed_by uuid references auth.users(id) on delete set null,

  -- POYGA HIMOYASI: bir vaqtda bitta worker.
  add column if not exists lock_token uuid,
  add column if not exists lock_expires_at timestamptz,
  add column if not exists last_outbound_at timestamptz;

create index if not exists idx_sales_conversations_stage
  on public.sales_conversations(sales_stage);
create index if not exists idx_sales_conversations_ai_enabled
  on public.sales_conversations(ai_enabled) where ai_enabled = false;
create index if not exists idx_sales_conversations_intake
  on public.sales_conversations(intake_id) where intake_id is not null;

comment on column public.sales_conversations.ai_enabled is
  'false — inson qo''lga olgan. AI na javob, na follow-up yuboradi.';
comment on column public.sales_conversations.lock_token is
  'Atomik da''vo (claim). Ikki worker bitta suhbat bosqichini bir vaqtda o''zgartira olmaydi.';

-- ------------------------------------------------------------
-- 2. Xabar shablonlari
--    Manba: src/lib/sales/flow/templates.ts. Ikkisi ajralib
--    ketmasligini test harfma-harf tekshiradi.
-- ------------------------------------------------------------
create table if not exists public.sales_message_templates (
  key text primary key,
  title text not null,
  body text not null,
  -- true — AI matnni QAYTA YOZMAYDI. Narx va huquqiy ma'lumot
  -- shu shablonlarda, model ularni "yaxshilay" olmaydi.
  is_exact boolean not null default true,
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. Rejalashtirilgan follow-up
--
--    setTimeout ISHLATILMAYDI: serverless funksiya javobdan keyin
--    o'ladi va taymer bilan qolgan xabar hech qachon yuborilmaydi.
--    Shuning uchun navbat bazada, cron esa uni tekshiradi.
-- ------------------------------------------------------------
create table if not exists public.sales_followups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sales_conversations(id) on delete cascade,

  followup_type text not null,
  template_key text not null,
  -- Rejalashtirilgan paytdagi bosqich. Yuborish oldidan solishtiriladi:
  -- suhbat oldinga ketgan bo'lsa, eskirgan follow-up yuborilmaydi.
  expected_stage text not null,

  scheduled_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'cancelled', 'failed', 'skipped')),
  sent_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  error text,
  attempts integer not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists idx_sales_followups_due
  on public.sales_followups(scheduled_at) where status = 'pending';
-- Bitta suhbatda bitta turdagi kutilayotgan follow-up — takroriy
-- rejalashtirish yangi qator yaratmaydi.
create unique index if not exists uq_sales_followups_pending
  on public.sales_followups(conversation_id, followup_type) where status = 'pending';

-- ------------------------------------------------------------
-- 4. Yuborilgan xabarlar jurnali
--    Har outbound shu yerga yoziladi — nima, qachon, qaysi shablon.
-- ------------------------------------------------------------
create table if not exists public.sales_outbound_log (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sales_conversations(id) on delete cascade,

  kind text not null check (kind in ('template', 'knowledge_reply', 'followup')),
  template_key text,
  body text not null,
  stage_before text,
  stage_after text,

  telegram_message_id bigint,
  -- Simulyatsiya rejimida yuborilgan "xabar" ham yoziladi, lekin
  -- Telegram'ga chiqmaydi. Ikkisi shu bayroq bilan farqlanadi.
  simulated boolean not null default false,

  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_outbound_conversation
  on public.sales_outbound_log(conversation_id, created_at desc);

-- ------------------------------------------------------------
-- 5. To'lov isboti (chek / skrinshot / PDF)
--    Fayl mavjud intake bucket'ida saqlanadi; bu yerda faqat havola.
-- ------------------------------------------------------------
create table if not exists public.sales_payment_evidence (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sales_conversations(id) on delete cascade,
  message_id uuid references public.sales_messages(id) on delete set null,

  file_kind text not null check (file_kind in ('photo', 'document', 'other')),
  telegram_file_id text,
  storage_path text,
  mime_type text,
  file_size integer,

  received_at timestamptz not null default now(),
  -- Tasdiqlashni ODAM qiladi. AI skrinshotga qarab "to'landi" demaydi.
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists idx_sales_payment_evidence_conversation
  on public.sales_payment_evidence(conversation_id, received_at desc);

-- ------------------------------------------------------------
-- 6. Bosqich o'zgarishlari tarixi
-- ------------------------------------------------------------
create table if not exists public.sales_stage_transitions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sales_conversations(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  reply_intent text,
  -- Qaysi xabar shu o'tishni keltirib chiqargani.
  trigger_message_id uuid references public.sales_messages(id) on delete set null,
  actor uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_stage_transitions_conversation
  on public.sales_stage_transitions(conversation_id, created_at desc);

-- ------------------------------------------------------------
-- 7. Sozlamalar
-- ------------------------------------------------------------
insert into public.sales_settings (key, value) values
  ('flow', '{"autoReplyEnabled": false, "followupOfferReviewMinutes": 7, "followupArticleDecisionMinutes": 5, "followupLaterMinutes": 60}'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- Triggerlar va RLS — 0.1 konvensiyasi bilan bir xil
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sales_message_templates'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array[
    'sales_message_templates', 'sales_followups', 'sales_outbound_log',
    'sales_payment_evidence', 'sales_stage_transitions'
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

comment on table public.sales_followups is
  'Rejalashtirilgan follow-up navbati. setTimeout emas: serverless funksiya javobdan keyin o''ladi.';
comment on table public.sales_outbound_log is
  'Botdan chiqqan har bir xabar. simulated=true — sinov rejimi, Telegram''ga chiqmagan.';

-- ------------------------------------------------------------
-- SEED: xabar shablonlari (manba: flow/templates.ts)
-- ------------------------------------------------------------
insert into public.sales_message_templates (key, title, body, is_exact, is_active) values
  ('application_confirm', $tpl$Salomlashish va ariza tasdig‘i$tpl$, $tpl$Vaalaykum assalom.
Siz “O‘zbekiston Lider Yoshlari Ensiklopediyasi”ga kirish uchun ariza qoldirgansiz. Shunaqami?$tpl$, true, true),
  ('benefits_question', $tpl$Foydalar haqida bilasizmi$tpl$, $tpl$Siz ensiklopediyamizga kirishning foydali jihatlari haqida batafsil ma’lumotga egamisiz?$tpl$, true, true),
  ('understood', $tpl$Tushunarli$tpl$, $tpl$Tushunarli.$tpl$, true, true),
  ('benefits_full', $tpl$Foydalar (to‘liq matn)$tpl$, $tpl$Ushbu xabarda sizga qo‘shimcha ma’lumotlarni taqdim etmoqdamiz.
Ensiklopediyaga istalgan sohada faoliyat yuritayotgan, o‘z ustida ishlayotgan yoshlar qabul qilinadi.
Bu loyiha yoshlarning yutuqlarini hujjatlashtirish, ularni ommaga tanitish va boshqalarga ilhom manbai bo‘lish maqsadida yaratilgan.

✅ Qidiruv tizimlarida ko‘rinish:
Siz haqingizdagi maqola Google, Yandex, Bing kabi qidiruv tizimlarida chiqadi. Bu sizni istagan odam — hamkor, ish beruvchi yoki jurnalist — osongina topishi mumkinligini anglatadi.

✅ Sun’iy intellekt platformalarida tanilish:
ChatGPT, Copilot, Gemini kabi sun’iy intellekt tizimlari endilikda siz haqingizda aniq manbalarga tayangan holda ma’lumot bera oladi. Bu sizning onlayn obro‘yingizni mustahkamlovchi kuchli vosita.

✅ Kelajakdagi Wikipedia sahifangiz uchun asos:
Bugun e’lon qilinadigan maqola — ertaga siz haqingizda yoziladigan Wikipedia sahifasi uchun tayyor ishonchli manba bo‘lishi mumkin.

✅ AdabiyotX platformasidagi eksklyuziv imkoniyatlar:
AdabiyotX platformasi orqali birinchi kitobingiz, maqolangiz yoki boshqa mualliflik materiallaringizni mutlaqo bepul nashr etishingiz mumkin. Asaringiz platformada kitobxonlarga taqdim etiladi va har bir sotuvdan mualliflik daromadi olish imkoniyatiga ega bo‘lasiz.

✅ Ijtimoiy tarmoqlarda tasdiq belgisi olish imkoniyati:
Instagram, Facebook, TikTok, YouTube kabi platformalarda ko‘k nishon olish uchun siz haqingizda onlayn nashrlar zarur. Ushbu maqola bu yo‘lda ishonchli hujjat bo‘lib xizmat qiladi.

✅ Rezumega qo‘shiladigan rasmiy havola:
Ish qidirishda, grantga hujjat topshirishda yoki xalqaro loyihalarda qatnashishda ushbu maqola — sizning shaxsiy brendingizni isbotlovchi kuchli hujjat bo‘ladi.

✅ Xorijiy universitetlar va dasturlar va stependiyalar uchun tavsiyanoma:
Xorijiy universitetlar, grant dasturlari, almashinuv loyihalari va xalqaro tanlovlar, stependiyalar uchun tashkilot yoki rahbar nomidan universal yoki maxsus tavsiyanoma (Recommendation Letter) tayyorlash xizmatidan foydalanishingiz mumkin. Har bir tavsiyanoma sizning yutuqlaringiz, faoliyatingiz va maqsadlaringiz asosida professional tarzda tayyorlanadi.

✅ Lider yoshlar online jurnalida yoritilish
Biografik maqolasi bor yoshlar Lider yoshlar online jurnalida mumtazam yoritiladi. Ularning hayotida yuz bergan muhim voqea, ularning loyihalari va tashabburlari keng targ'ib qilinadi.

✅ Ommaviy axborot vositalari e’tiboriga tushasiz:
Jurnalistlar, blogerlar, televideniye va radio uchun maqolaviy manba sifatida sizga murojaatlar ko‘payadi.

✅ Liderlar iqtibosida faollik
Har qanday jamiyat uchun kerakli va mamunli go'yangizni Liderlardan iqtiboslar ruknida e'lon qilishingiz mumkin bo'ladi

✅ Shaxsiy brendingiz uchun poydevor:
Har qanday lider, ekspert yoki jamoat faoli uchun shaxsiy brend muhim. Bu maqola — o‘zingizga bo‘lgan ishonchni va boshqalarning sizga nisbatan ishonchini mustahkamlaydi.

✅ Project Found dasturi imkoniyatlari:
Project Found dasturi orqali startap, loyiha yoki tashabbusingiz uchun mutlaqo bepul zamonaviy va professional veb-saytga ega bo‘lish imkoniyatini qo‘lga kiriting.

✅ Kelajak loyihalarda e’tibor markazida bo‘lish:
Tanlovlar, forumlar, konferensiyalar yoki grant dasturlarida qatnashishda siz haqingizdagi onlayn maqola sizni ajratib ko‘rsatadi.

✅ Ensiklopediyaga kirganlik haqida sertifikat
Tanlovlar, forumlar, konferensiyalar yoki grant dasturlarida qatnashishda, yoki talaba bo'lsangiz "kontraktddan grantaga o'tishda" ijtimoiy faollikka kiritish uchun yutuqlar jildiga munosib tashakkurnomaga ega bo'lasiz.

Ensiklopeidyamizning ommaviy ofertasi bilan quyidagi link orqali batafsil tanishishiniz mumkin !
https://liderlar.uz/ommaviy_ofertasi

Liderlar.uz | Instagram | @uzlye_rasmiy$tpl$, true, true),
  ('benefits_review_prompt', $tpl$Oferta bilan tanishishga chorlov$tpl$, $tpl$Unda xabar va linkdagi ommaviy ofertamiz bilan tanishib chiqib ayting.$tpl$, true, true),
  ('price_offer', $tpl$Narx taklifi$tpl$, $tpl$Oldindan aytaman Bizda maqola joylashning yillik badali bor va u hozirda 100 000 so’mni tashkil qiladi.

LEKIN HOZIRDA YANGI O"QUV YILI BOSHLANISHI MUNOSABATI BILAN MEGA CHEGIRMA AMAL QILMOQDA VA KIRISH BADALI ATIGA 38 MING SO'M.

Pullar saytni va maqolalarni texnik jihatdan ta’minlaydi va sifatli yuritilishiga va saqlanishiga sarflanadi Kelajakda, biror bir yangi loyiha qilsangiz, yoki o’zgrartirish kerak bo’lsa bir yil ichida bu xizmatlar bepul boʻladi Undan tashqari kelajakda turli semenar, podcastlar va reels videolar qilishni rejalayapmiz. Bu ishlarda ham albatta ensiklopediyamizga kirgan nomzodlarning virtual imidjini yaxshilash uchun harakat qilamiz jumaladan sizning ham!$tpl$, true, true),
  ('review_later', $tpl$Tanishib bo‘lgach ayting$tpl$, $tpl$Tanishib bo‘lgach ayting.$tpl$, true, true),
  ('article_decision', $tpl$Maqola yozamizmi$tpl$, $tpl$Maqulmi sizga, sizga ham biografik maqola yozamizmi?$tpl$, true, true),
  ('request_full_name', $tpl$F.I.Sh. so‘rash$tpl$, $tpl$Yaxshi unda menga isminigizni to'liq yozib yuboring men sizga maxsus savollar xabarnomasini yuboraman . siz javoblar yozib yuboraisz havolarni ichiga kirib
javoblaringiz asosida biografik maqolangizni shakillantiramiz$tpl$, true, true),
  ('request_full_name_again', $tpl$To‘liq F.I.Sh. qayta so‘rash$tpl$, $tpl$To‘liq F.I.Sh.ingizni yozib yuboring.$tpl$, true, true),
  ('intake_instructions', $tpl$Anketa havolasi ko‘rsatmasi$tpl$, $tpl$LINKni imkon qadar tezroq toldiirb javoblarni yuboring u vaqtinchalik link va tahiman bir necha soatda yaroqsiz boladi

Rasm AYNAN linkdagi birinchi sahifadagi promt bilan yaratilishi shart

promtni nusxalang va rasmingiz bilan birga ChatGPT yoki Gemini’ga bering. Tayyor natijani yuqoridagi «Rasm yuklash» tugmasi orqali joylang.

Boshqa usulda tayyorlangan yoki oddiy rasm qabul qilinmaydi — bunday holatda maqola chiqarilmaydi.$tpl$, true, true),
  ('intake_submitted_ack', $tpl$Anketa to‘ldirilgani tasdig‘i$tpl$, $tpl$Javoblarni to‘ldiribsiz.$tpl$, true, true),
  ('payment_details', $tpl$To‘lov ma’lumotlari$tpl$, $tpl$💳 To‘lov uchun karta ma’lumoti:
Uzcard: 5614686500416261

Karta egasi: JAXONGIR QURBONNAZAROV
✅ To‘lovni amalga oshirgach, iltimos, chek (skrinshot)ni bizga yuboring.

Liderlar.uz | Instagram | @uzlye_rasmiy

CHEGIRMADAGI 38 MING SO'M TO'LOVNI SHU HISOB RAQAMGA YUBORING$tpl$, true, true),
  ('payment_note', $tpl$To‘lov izohi$tpl$, $tpl$To‘lovni hozir amalga oshirsangiz, chek kelgandan so‘ng maqolangizni nashrga yuborishni tasdiqlaymiz.$tpl$, true, true),
  ('payment_received', $tpl$Chek qabul qilindi$tpl$, $tpl$Chek qabul qilindi, tekshirib chiqamiz va tasdiqlagach xabar beramiz.$tpl$, true, true),
  ('declined', $tpl$Rad javobi$tpl$, $tpl$Yaxshi, fikringiz o‘zgarsa shu yerda bo‘lamiz.$tpl$, true, true),
  ('followup_offer_review', $tpl$Follow-up: tanishib chiqdingizmi (7 daqiqa)$tpl$, $tpl$Tanishib chiqdingizmi?$tpl$, true, true),
  ('followup_article_decision', $tpl$Follow-up: maqola yozamizmi (5 daqiqa)$tpl$, $tpl$Maqulmi sizga, sizga ham biografik maqola yozamizmi?$tpl$, true, true),
  ('followup_article_decision_later', $tpl$Follow-up: nima qilamiz (1 soat)$tpl$, $tpl$Nima qilamiz, maqola yozamizmi?$tpl$, true, true)
on conflict (key) do nothing;
