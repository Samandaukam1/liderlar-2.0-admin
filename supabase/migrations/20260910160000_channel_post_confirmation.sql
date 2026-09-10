-- ============================================================
-- "Kanalga qo'yildimi?" — tayyor post kanalga qo'yilganini tasdiqlash
--
-- MUAMMO: bot tayyor postni tahririyat chatiga yuboradi, kanalga esa
-- uni ODAM qo'l bilan qo'yadi. Bu qadam hech qayerda yozilmaydi, ya'ni
-- unutilgan post bilan qo'yilgan post bir xil ko'rinadi. Yagona
-- tekshirish usuli — kanalni ochib, ikki ming post orasidan qidirish.
--
-- Yechim: har tayyor post uchun bot davriy so'raydi va javob SAQLANADI.
--
--   • channel_confirmed_at   — qachon tasdiqlangani. NULL bo'lsa hali
--     tasdiqlanmagan; bu ustun ayni paytda "boshqa so'ralmasin"
--     kalitining o'zi.
--   • channel_confirmed_by   — kim bosgani (Telegram user id). Javob
--     kimniki ekani yo'qolmasin: keyin "men bosmaganman" degan savol
--     chiqsa, javob shu yerda.
--   • channel_reminder_last_at / _count — takroriylikni boshqaradi va
--     "necha marta so'raldi" degan haqiqiy sonni beradi.
--
-- ESLATMA: `telegram_last_sent_at` (post tahririyatga yetkazilgan payt)
-- allaqachon bor va eslatma AYNAN shunga tayanadi — yetkazilmagan post
-- haqida so'rashning ma'nosi yo'q.
--
-- QOIDA: non-destructive va idempotent. Mavjud postlar hech qanday
-- qiymatini yo'qotmaydi; yangi ustunlar NULL bo'lib boshlanadi, ya'ni
-- ular "tasdiqlanmagan" deb o'qiladi va birinchi sweep'da so'raladi.
-- ============================================================

alter table public.candidate_social_posts
  add column if not exists channel_confirmed_at timestamptz,
  add column if not exists channel_confirmed_by bigint,
  add column if not exists channel_reminder_last_at timestamptz,
  add column if not exists channel_reminder_count integer not null default 0;

comment on column public.candidate_social_posts.channel_confirmed_at is
  'Post kanalga qo''yilgani tasdiqlangan payt. NULL — hali tasdiqlanmagan; bot davriy so''rashda davom etadi.';
comment on column public.candidate_social_posts.channel_confirmed_by is
  'Tugmani bosgan Telegram foydalanuvchi id''si — javob kimniki ekani yo''qolmasin.';
comment on column public.candidate_social_posts.channel_reminder_last_at is
  'Oxirgi eslatma yuborilgan payt — takroriylik oralig''ini shu belgilaydi.';
comment on column public.candidate_social_posts.channel_reminder_count is
  'Nechta eslatma yuborilgani. Xabarda ko''rsatiladi: takrorlanish soni yashirilmaydi.';

-- Eslatma navbati: tasdiqlanmagan va tahririyatga yetkazilgan postlar,
-- eng uzoq so'ralmaganidan boshlab. Qisman indeks — tasdiqlangan
-- postlar (vaqt o'tishi bilan ularning hammasi) indeksda umuman
-- turmaydi.
create index if not exists idx_social_posts_channel_pending
  on public.candidate_social_posts(channel_reminder_last_at nulls first)
  where channel_confirmed_at is null;
