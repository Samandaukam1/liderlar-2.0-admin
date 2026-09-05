-- ============================================================
-- Post iqtibosi: sayqallangan/yaratilgan variant
--
-- Nomzod eslatmani o'qiydi, lekin baribir bitta gap, imlo xatosi
-- yoki umuman javobsiz yuborishi mumkin. Iqtibos posterga AYNAN
-- shu holicha chiqqani uchun u avtomatik ravishda talabga
-- keltiriladi, bo'sh bo'lsa esa nomzod nomidan yoziladi.
--
-- MUHIM: nomzodning XOM javobi (candidate_intake_answers.plain_text)
-- HECH QACHON o'zgartirilmaydi. Sayqallangan variant shu yerda
-- alohida turadi, ya'ni asl matn har doim qaytarib olinadi va
-- muharrir ikkalasini yonma-yon ko'radi.
-- ============================================================

alter table public.candidate_intakes
  add column if not exists post_quote text,
  add column if not exists post_quote_generated boolean not null default false,
  add column if not exists post_quote_at timestamptz;

comment on column public.candidate_intakes.post_quote is
  'Posterga chiqadigan iqtibos: nomzod javobidan moslashtirilgan yoki (bo''sh bo''lsa) uning nomidan yozilgan';
comment on column public.candidate_intakes.post_quote_generated is
  'true — nomzod iqtibos yozmagan, matn uning nomidan yaratilgan';

-- Takrorlanmaslik tekshiruvi shu ustundan o'qiydi.
create index if not exists idx_intakes_post_quote
  on public.candidate_intakes(post_quote)
  where post_quote is not null;

-- ------------------------------------------------------------
-- Eslatmaga qo'shimcha
--
-- Nomzod iqtibos yozmasa nima bo'lishini oldindan bilishi kerak:
-- matn uning nomidan yoziladi va o'zgartirilmaydi.
-- ------------------------------------------------------------
update public.candidate_intake_questions
set help_text =
  'Ikkita gap yozing. Har bir gap kamida 6 ta so‘zdan iborat bo‘lsin va imloviy '
  || 'xatolarsiz bo‘lsin. Iltimos, avval matnni ChatGPT orqali tekshirib, '
  || 'moslashtirilgan variantini shu yerga joylashtiring — iqtibosingiz qanday '
  || 'yozilgan bo‘lsa, postga shundayligicha olinadi va o‘zgartirilmaydi. '
  || 'Agar iqtibos yozmasangiz, biz uni sizning nomingizdan o‘zimiz yozamiz: '
  || 'bu yerda Jaxongir AI ishlaydi, matn 1 oy tahrirsiz qoladi va iqtibos '
  || 'o‘zgartirilmaydi.'
where canonical_key = 'post_quote';
