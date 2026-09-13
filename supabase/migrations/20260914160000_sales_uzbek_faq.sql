-- ============================================================
-- AI SOTUV — o'zbekcha javoblar, tijoriy faktlarning yagona manbasi
-- va real savollardan yig'iladigan FAQ
--
-- QOIDA: hammasi qo'shimcha. Jadval tashlanmaydi, ustun o'chirilmaydi,
-- o'rganish tarixiga tegilmaydi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TIJORIY FAKTLAR — BITTA JOY
--
--    Narx shablonlarda, bilim bazasida va kodda alohida-alohida
--    yozilgan edi. Narx o'zgarganda hammasini topib tuzatish kerak
--    bo'lardi va bittasi qolib ketishi muqarrar — o'shanda bot bir
--    mijozga 38 ming, boshqasiga 100 ming deb aytardi.
--
--    `offerExpiresAt` ATAYLAB NULL: chegirma muddati hech qayerda
--    tasdiqlanmagan. Uni to'ldirmasdan turib AI "bugun tugaydi" deb
--    AYTA OLMAYDI — kod buni ochiq taqiqlaydi (13-band).
-- ------------------------------------------------------------
insert into public.sales_settings (key, value) values
  ('commercial', jsonb_build_object(
    'regularPrice', 100000,
    'activePrice', 38000,
    'discountEnabled', true,
    'offerExpiresAt', null,
    'paymentDetails', null,
    'servicePeriod', '1 yil'
  ))
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 2. REAL SAVOLLARDAN YIG'ILADIGAN FAQ
--
--    `sales_knowledge` bilan FARQI: u AI o'rgangan yoki qo'lda
--    kiritilgan BILIM. Bu esa mijozlar AYNAN QANDAY so'raganini va
--    har savol NECHA MARTA kelganini saqlaydi — ya'ni bu bilim emas,
--    TALAB o'lchovi. Ikkisi bir jadvalga sig'maydi: bilimning
--    chastotasi bo'lmaydi, savolning javobi esa bir nechta bo'lishi
--    mumkin.
-- ------------------------------------------------------------
create table if not exists public.sales_faq (
  id uuid primary key default gen_random_uuid(),

  -- Savolning me'yorlashtirilgan shakli — takrorlarni birlashtiradi.
  normalized_question text not null,
  canonical_question text not null,
  -- Mijozlar aynan qanday yozgan: ["narxi qancha", "qancha turadi", ...]
  alternative_phrasings jsonb not null default '[]'::jsonb,

  canonical_answer text,
  category text not null default 'faq',

  -- Necha marta so'ralgan — ro'yxat shu bo'yicha tartiblanadi.
  frequency integer not null default 1,

  -- Shu savolga qanday javob berilganda sotuvga o'tilgan.
  successful_response_patterns jsonb not null default '[]'::jsonb,

  priority integer not null default 50 check (priority between 0 and 100),
  confidence numeric(4, 3) not null default 0.5,

  source_type text not null default 'mined'
    check (source_type in ('mined', 'manual')),

  approved boolean not null default false,

  -- Javob AYNAN shu holida yuborilishi kerakmi (oferta matni kabi).
  exact_template boolean not null default false,

  -- Javob berish uchun tasdiqlangan holat kerakmi (to'lov, anketa).
  requires_verified_state boolean not null default false,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_faq_question
  on public.sales_faq(normalized_question);
create index if not exists idx_sales_faq_frequency
  on public.sales_faq(frequency desc);
create index if not exists idx_sales_faq_approved
  on public.sales_faq(approved, frequency desc);

drop trigger if exists trg_sales_faq_updated on public.sales_faq;
create trigger trg_sales_faq_updated
  before update on public.sales_faq
  for each row execute function public.set_updated_at();

alter table public.sales_faq enable row level security;

do $$
begin
  execute format('drop policy if exists "sales faq read" on public.sales_faq');
  execute format(
    'create policy "sales faq read" on public.sales_faq for select using (public.has_permission(%L))',
    'sales.view'
  );
end $$;

-- ------------------------------------------------------------
-- 3. TASDIQLANGAN BILIMLAR
--
--    Bular texnik topshiriqda AYNAN berilgan javoblar (14–19-band).
--    Hammasi `manual` va `approved`: ular AI taxmini emas, tahririyat
--    qarori. `priority` yuqori — bu savollar eng ko'p beriladi va
--    javobi aniq.
--
--    `on conflict (dedupe_key) do nothing` — migratsiya qayta
--    ishlaganda nusxa yaratmaydi va mavjud javobni ustidan yozmaydi.
-- ------------------------------------------------------------
insert into public.sales_knowledge
  (category, question, answer, tags, confidence, status, source_type, priority,
   source_conversation_id, dedupe_key)
values
  (
    'service_fact',
    'Rasmiy tashkilotmisiz? Loyiha kimga qarashli? Asoschisi kim?',
    'Loyiha “Mukammal Media Group” MChJga qarashli. Loyiha asoschisi — Qurbonnazarov Jaxongir Xudoynazarovich.',
    array['rasmiy', 'tashkilot', 'asoschi', 'kompaniya'],
    1.0, 'approved', 'manual', 95, null, 'seed:official_org'
  ),
  (
    'service_fact',
    'Sen kimsan? Adminmisiz? Telefon raqamingizni bering.',
    'Men Liderlar.uz murojaatlari bilan ishlovchi virtual administrator yordamchisiman. Xodimlarning shaxsiy ma’lumotlari va shaxsiy telefon raqamlari taqdim etilmaydi. Menga Admin deb murojaat qilishingiz mumkin.',
    array['kimsan', 'admin', 'telefon', 'raqam', 'shaxsiy'],
    1.0, 'approved', 'manual', 95, null, 'seed:who_are_you'
  ),
  (
    'price',
    'Sizlarga nima foyda? Nimaga pul olasiz? Pul qayerga ketadi?',
    'Texnik badal loyiha faoliyatini yuritish, sayt va maqolalarni texnik jihatdan saqlash, platforma infratuzilmasi va xizmatlarni rivojlantirish xarajatlarini qoplashga xizmat qiladi. Biz uchun asosiy natija — ensiklopediyaga kirgan yoshlarning sifatli va uzoq muddatli onlayn portfolioga ega bo‘lishi.',
    array['foyda', 'pul', 'nimaga', 'badal', 'xarajat'],
    1.0, 'approved', 'manual', 90, null, 'seed:why_payment'
  ),
  (
    'price',
    'Bepul emasmi? Men bepul deb o‘ylagandim. Nega pullik?',
    'Yo‘q, bizda yillik texnik badal mavjud. Narx barcha nomzodlar uchun xizmatni yuritish va bir yillik texnik qo‘llab-quvvatlashni hisobga olgan holda belgilangan.',
    array['bepul', 'pullik', 'tekin', 'badal'],
    1.0, 'approved', 'manual', 90, null, 'seed:not_free'
  ),
  (
    'service_fact',
    'Sertifikat ham beriladimi?',
    'Ha, ensiklopediyaga kiritilganlik bo‘yicha sertifikat ham taqdim etiladi.',
    array['sertifikat', 'guvohnoma'],
    1.0, 'approved', 'manual', 88, null, 'seed:certificate'
  ),
  (
    'service_fact',
    'Sertifikat grantga o‘tishga yordam beradimi? Kontraktdan grantga o‘tsam bo‘ladimi?',
    'Sertifikatni portfolio yoki ijtimoiy faollikni ko‘rsatuvchi materiallardan biri sifatida yutuqlar jildiga qo‘shishingiz mumkin. Lekin kontraktdan grantga o‘tish yoki grantni saqlab qolish bo‘yicha yakuniy qaror tegishli OTM va amaldagi tartiblarga bog‘liq; sertifikatning o‘zi buni kafolatlamaydi.',
    array['grant', 'kontrakt', 'sertifikat', 'otm', 'stipendiya'],
    1.0, 'approved', 'manual', 88, null, 'seed:certificate_grant'
  ),
  (
    'price',
    'Chegirma qachon tugaydi? Ertaga ham shu narxmi?',
    'Chegirma sizga taklif qilingan kundan boshlab bir kun davomida amal qiladi. Agar taklif bugun berilgan bo‘lsa, bugun yakunlanadi. Keyin amaldagi narx 100 ming so‘mga qaytadi. Foydalanmoqchi bo‘lsangiz, chegirma muddati tugamasidan rasmiylashtirib qo‘yganingiz ma’qul.',
    array['chegirma', 'aksiya', 'muddat', 'qachon', 'tugaydi'],
    1.0, 'approved', 'manual', 85, null, 'seed:discount_expiry'
  )
on conflict (dedupe_key) do nothing;
