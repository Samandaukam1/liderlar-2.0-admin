-- ============================================================
-- SOTUV BOTI — KIRUVCHI SSENARIY
--
-- Hozirgacha oqim BITTA holatni nazarda tutardi: biz ariza
-- qoldirgan odamga birinchi yozamiz. Shuning uchun suhbat
-- "Siz ariza qoldirgansiz. Shunaqami?" bilan boshlanadi.
--
-- Endi nomzodlar O'ZLARI yozmoqda. Ularga o'sha savolni
-- yuborish XATO: ular hech qanday ariza qoldirmagan va savol
-- ularni chalkashtiradi.
--
-- Bu migratsiya suhbat turini SAQLAYDI. Uni har safar
-- xabarlar tarixidan hisoblash mumkin edi, lekin u holda
-- bitta savolga javob berish uchun har xabarda qo'shimcha
-- so'rov ketardi — va javob vaqt o'tib o'zgarib ham ketishi
-- mumkin edi.
-- ============================================================

alter table public.sales_conversations
  add column if not exists entry text not null default 'outbound'
    check (entry in ('inbound', 'outbound'));

comment on column public.sales_conversations.entry is
  'Suhbatni kim boshlagan: inbound — mijoz bizga yozgan, outbound — biz yozganmiz.';

/*
 * MAVJUD SUHBATLARNI BELGILAB CHIQAMIZ.
 *
 * Birinchi xabar KIRUVCHI bo'lsa — mijoz boshlagan. Bu yagona
 * ishonchli belgi: `incoming_count` kabi sanoqlar keyingi
 * yozishmalardan keyin ikkala tomonda ham noldan katta
 * bo'ladi va turni ajratmaydi.
 *
 * Standart qiymat 'outbound' — ya'ni aniqlab bo'lmagan
 * suhbatlar hozirgi xulqda qoladi. Yangi xulqni taxminga
 * asoslab yoqish, eskisini qoldirishdan xavfliroq.
 */
with first_message as (
  select distinct on (m.conversation_id)
    m.conversation_id,
    m.direction
  from public.sales_messages m
  order by m.conversation_id, m.sent_at asc, m.id asc
)
update public.sales_conversations c
set entry = 'inbound'
from first_message f
where f.conversation_id = c.id
  and f.direction = 'incoming'
  and c.entry = 'outbound';

create index if not exists sales_conversations_entry_idx
  on public.sales_conversations (entry)
  where entry = 'inbound';

-- ------------------------------------------------------------
-- GRANT / IJTIMOIY FAOLLIK SAVOLIGA JAVOB
--
--    Bu savol tez-tez so'raladi va unga NOANIQ javob berish
--    eng xavfli yo'l: odam sertifikat grant kafolatlaydi deb
--    tushunib qolsa, keyin bu bizning muammomizga aylanadi.
--
--    Javob ataylab halol: ustunlik beradi, lekin yakka o'zi
--    yetarli emas.
-- ------------------------------------------------------------
insert into public.sales_knowledge (
  category, question, answer, source_type, status, priority, dedupe_key
)
values (
  'objection',
  'Sertifikatingiz grantga o''tishga yoki ijtimoiy faollikka yordam beradimi?',
  'So''nggi yillarda juda ko''plab nomzodlar sertifikatlarimizni olib ijtimoiy faollikka biriktirishgan. Ularning ko''pchiligi 50–100 foiz grantga o''tganini eshitganmiz.

Lekin bir narsani unutmang: faqat bizning sertifikat bilan grantga shunchaki o''tib ketolmaysiz. Undan tashqari o''zingizning boshqa ko''rsatkichlaringiz, bilimingiz va davomatingiz ham bo''lishi kerak.

Agar hamma bizning sertifikat bilan grantga o''tganda yoki grant o''rnini saqlab qolganda — hamma bizdan sertifikat olar edi. Lekin albatta ustunlik beradi.',
  /*
   * 'manual' — admin yozgan fakt. Shu tufayli `source_conversation_id`
   * talab qilinmaydi va retrieval saralashida AI ajratganidan
   * ustun turadi: bilib turib yozilgan javob tasodifiy eski
   * yozishmadan ishonchliroq.
   */
  'manual',
  'approved',
  100,
  'manual:grant_value_answer'
)
on conflict (dedupe_key) do nothing;

-- ------------------------------------------------------------
-- YANGI SHABLONLAR — SEED
--
--    `templates.ts` va bu jadval AJRALIB KETMASLIGI kerak:
--    test ularni HARFMA-HARF solishtiradi. Faqat TS'ga
--    qo'shsak, test darhol yiqiladi — va aynan shunday
--    bo'ldi ham.
--
--    `on conflict do nothing`: admin panelda tahrirlangan
--    matn qayta deploy'da tiklanib ketmasin.
-- ------------------------------------------------------------
insert into public.sales_message_templates (key, title, body, is_exact, is_active) values
  ('inbound_greeting', $tpl$Kiruvchi: salomlashish$tpl$, $tpl$Assalomu alaykum. Bog'langaningiz uchun rahmat!

Yaxshi, sizga hozir batafsil ma'lumot yuboraman.$tpl$, true, true),
  ('price_offer_inbound', $tpl$Kiruvchi: narx va promo$tpl$, $tpl$Oldindan aytaman Bizda maqola joylashning yillik badali bor va u hozirda 100 000 so'mni tashkil qiladi.

Bizda homiylar yo'q tushuning — bu narx ichiga maqolani texnik jihatdan ta'minlash, sifatli yuritish va saqlash, YILLIK BARCHA TAHRIRLASHLAR va 24/7 qo'llab-quvvatlash KIRADI.

LEKIN HOZIRDA SIZ PROMO KODDAN FOYDALANGANSIZ VA MEGA CHEGIRMA AMAL QILMOQDA VA KIRISH BADALI ATIGA 38 MING SO'M.

Bunday narx hech qayerda hech qachon bo'lmagan. Shunday ekan chegirmaga ulguring.

Undan keyin esa batafsil tanishib chiqing va ayting.$tpl$, true, true),
  ('request_full_name_with_samples', $tpl$Kiruvchi: F.I.Sh. so'rash va namuna maqolalar$tpl$, $tpl$Yaxshi unda menga ismingizni to'liq yozib yuboring — men sizga maxsus savollar xabarnomasini yuboraman. Siz havolalar ichiga kirib javoblarni yozib yuborasiz, javoblaringiz asosida biografik maqolangizni shakllantiramiz.

Maqola taxminan quyidagidek bo'ladi — pastdagi nomzodlarning ismi ustiga bossangiz, maqolasiga olib boradi:

https://t.me/uzlye_rasmiy/2405
https://t.me/uzlye_rasmiy/2344$tpl$, true, true)
on conflict (key) do nothing;
