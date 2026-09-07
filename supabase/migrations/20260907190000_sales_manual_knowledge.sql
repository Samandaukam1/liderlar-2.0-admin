-- ============================================================
-- AI Sotuv — QO'LDA KIRITILGAN BILIM
--
-- MUAMMO: 0.1 da har bir bilim yozuvi majburiy ravishda manba suhbatga
-- bog'langan edi (`source_conversation_id not null`). Bu AI ajratgan
-- bilim uchun to'g'ri — manbasiz fakt "AI o'ylab topgan" degani. Lekin
-- admin O'ZI yozgan bilim uchun manba suhbat YO'Q va bo'lishi ham shart
-- emas: uning manbasi — adminning o'zi.
--
-- YECHIM: `source_type` ustuni ikki oqimni ajratadi va NOT NULL sharti
-- faqat AI oqimiga qoladi (pastdagi CHECK). Shu tarzda 0.1 dagi
-- izlanuvchanlik kafolati BUZILMAYDI.
--
-- USTUVORLIK: qo'lda kiritilgan bilim AI o'rgangan eski javobdan ustun
-- turishi kerak — admin bilib turib yozgan fakt tasodifiy eski
-- yozishmadan ishonchliroq. `priority` shuni ta'minlaydi.
--
-- QOIDA: non-destructive va idempotent.
-- ============================================================

alter table public.sales_knowledge
  -- 'ai_extracted' — suhbatdan ajratilgan; 'manual' — admin yozgan.
  add column if not exists source_type text not null default 'ai_extracted'
    check (source_type in ('ai_extracted', 'manual')),
  -- Retrieval saralashida qo'shimcha vazn. Qo'lda kiritilgan bilim
  -- standart 100 oladi, AI ajratgani 0.
  add column if not exists priority integer not null default 0,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  -- Arxivlangan yozuv o'chirilmaydi: u qaysi javobga asos bo'lganini
  -- keyin ham tekshirish kerak bo'lishi mumkin.
  add column if not exists archived_at timestamptz;

-- Manba suhbat endi FAQAT AI oqimida majburiy.
alter table public.sales_knowledge
  alter column source_conversation_id drop not null;

-- IZLANUVCHANLIK SHARTI: AI ajratgan bilim manbasiz bo'la olmaydi.
-- Qo'lda kiritilgani esa bo'la oladi.
alter table public.sales_knowledge
  drop constraint if exists sales_knowledge_source_required;
alter table public.sales_knowledge
  add constraint sales_knowledge_source_required check (
    source_type = 'manual' or source_conversation_id is not null
  );

create index if not exists idx_sales_knowledge_source_type
  on public.sales_knowledge(source_type, status) where archived_at is null;
create index if not exists idx_sales_knowledge_priority
  on public.sales_knowledge(priority desc) where archived_at is null;

comment on column public.sales_knowledge.source_type is
  'manual — admin yozgan (manba suhbat shart emas); ai_extracted — suhbatdan ajratilgan (manba MAJBURIY).';
comment on column public.sales_knowledge.priority is
  'Retrieval vazni. Qo''lda kiritilgan bilim AI ajratganidan ustun turishi uchun.';

-- ------------------------------------------------------------
-- SEED: adminlar tomonidan tasdiqlangan uchta bilim
--
-- `dedupe_key` o'qiladigan va BARQAROR: migratsiya qayta ishlatilsa
-- ikkinchi nusxa yaratilmaydi. AI ajratgan bilimning kaliti xesh
-- bo'lgani uchun bular bilan hech qachon to'qnashmaydi.
-- ------------------------------------------------------------

insert into public.sales_knowledge
  (category, question, answer, tags, confidence, status, source_type, priority,
   source_conversation_id, dedupe_key)
values
  -- A) Post/maqola e'lon qilingandan keyingi Telegram matni.
  --
  -- MUHIM: bundagi ism va iqtibos UNIVERSAL FAKT EMAS. Ular aynan bitta
  -- nomzodning namunasi, ya'ni shablonning to'ldirilgan ko'rinishi.
  -- Javob matni buni AI uchun ochiq aytadi, aks holda model
  -- "Ravshanova Maryam Rasulovna" ni har kimga yozib yuborardi.
  (
    'post_article',
    'Maqola yoki post e’lon qilingandan keyin nomzodga yuboriladigan post matni',
    $txt$SHABLON — har nomzod uchun IQTIBOS va F.I.Sh. o‘sha nomzodnikiga almashtiriladi.
Quyida to‘ldirilgan namuna (Ravshanova Maryam Rasulovna misolida):

"Men har kuni o‘zimning kechagi holatimdan yaxshiroq bo‘lishga intilaman. Hayotda katta natijalarga aynan intizom, sabr va davomiylik orqali erishiladi.

Ravshanova Maryam Rasulovna

LIDERLAR.UZ ensiklopediyasiga kirish uchun quyidagi havolani bosish orqali ariza qoldiring!

Liderlar.uz | Instagram | @uzlye_rasmiy"

DIQQAT: iqtibos va ism universal fakt emas — ular har nomzodda boshqacha bo‘ladi.$txt$,
    array['post', 'maqola', 'shablon', 'e’lon'],
    1.00,
    'approved',
    'manual',
    100,
    null,
    'manual:post-article:announcement-template'
  ),

  -- B) Sertifikat.
  (
    'service_fact',
    'Nomzod sertifikat haqida so‘rasa yoki maqola chiqqandan keyin sertifikat hali yuborilmagan bo‘lsa',
    $txt$Sertifikatni birozdan so‘ng yuboramiz.$txt$,
    array['sertifikat'],
    1.00,
    'approved',
    'manual',
    100,
    null,
    'manual:certificate:sent-shortly'
  ),

  -- D) Indekslanish muddati.
  --
  -- "3–7 kun" qiymati ATAYLAB qo'lda tasdiqlangan bilim sifatida
  -- saqlanadi: AI o'zi boshqa muddat o'ylab topmasligi kerak, va
  -- sinov chatdagi son tekshiruvi ham aynan shu manbaga tayanadi.
  (
    'faq',
    'Maqolam Google’da nega chiqmayapti? Yandexda ko‘rinmayapti. AI bazalarida topilmayapti. Maqola qachon qidiruvda chiqadi? Indekslanish qancha vaqt oladi?',
    $txt$Eslatib o‘tamiz! Maqola hali Google va Yandexda, shu jumladan sun’iy intellekt bazalarida ko‘rinmayotgan bo‘lishi mumkin. Odatda bu jarayon 3–7 kun oladi. Bu holatni tezlashtirish uchun maqolangizni kanalimizdan do‘stlaringizga ulashing. Ular postingizni ko‘rib, ismingiz ustiga bosib sahifangizga tashrif buyurishsin. Shunda indekslanish jarayoni ancha tezlashishi mumkin.$txt$,
    array['indekslanish', 'google', 'yandex', 'qidiruv', 'muddat'],
    1.00,
    'approved',
    'manual',
    100,
    null,
    'manual:indexing:3-7-days'
  )
on conflict (dedupe_key) do nothing;

-- ESLATMA: "хуш" bu yerga ATAYLAB kiritilmadi.
--
-- U bilim emas — yozishmadagi imlo xatosi, ma'nosi "xo‘p". Uni xizmat
-- fakti sifatida saqlash bilim bazasini axlat bilan to'ldirardi va AI
-- "хуш" degan xizmat bor deb o'ylab qolishi mumkin edi. Buning o'rniga
-- u src/lib/sales/text-normalize.ts da variant sifatida normallashtiriladi
-- va faqat NIYAT ANIQLASHDA ishlatiladi; xom xabar o'zgarmaydi.
