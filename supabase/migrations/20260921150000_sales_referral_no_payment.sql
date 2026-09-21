-- =========================================================================
-- IMTIYOZLI YO'NALISH — TANISH NOMIDAN KELGAN NOMZOD
--
-- Ba'zi odamlar bizga tanish nomidan yozadi: "Diyorbek
-- Niyatullayevich nomidan", "Shohruh Kamolovdan", "O'zak
-- jamoasidanman". Bunday odamdan PUL SO'RALMAYDI va unga narx,
-- karta ma'lumoti, to'lov eslatmasi — hech biri yuborilmaydi.
-- Undan faqat ISM so'raladi, chunki anketa havolasi ismsiz
-- yaratilmaydi.
--
-- MANBA SUHBAT QATORIDA SAQLANADI, xabarda emas: odam tanish
-- nomini bir marta, birinchi xabarda aytadi. Har xabarda matndan
-- qayta qidirilsa, qoida ikkinchi xabardayoq kuchini yo'qotardi
-- va mijozga to'lov ma'lumoti ketib qolardi.
--
-- FORWARD-ONLY: hech narsa o'chirilmaydi.
-- =========================================================================

alter table public.sales_conversations
  add column if not exists referral_source text,
  add column if not exists referral_matched_at timestamptz;

comment on column public.sales_conversations.referral_source is
  'Tanish nomidan kelgan bo''lsa — manba kaliti '
  '(diyorbek_niyatullayevich, shohruh_kamolov, ozak_jamoasi). '
  'To''ldirilgan bo''lsa, bu suhbatda narx va to''lov matni yuborilmaydi.';

comment on column public.sales_conversations.referral_matched_at is
  'referral_source birinchi marta aniqlangan vaqt.';

create index if not exists sales_conversations_referral_idx
  on public.sales_conversations (referral_source)
  where referral_source is not null;

-- -------------------------------------------------------------------------
-- SHABLONLAR
--
-- Matnlar `src/lib/sales/flow/templates.ts` bilan HARFMA-HARF bir
-- xil bo'lishi shart — buni test tekshiradi.
-- -------------------------------------------------------------------------

insert into public.sales_message_templates (key, title, body, is_exact, is_active) values
  ('referral_greeting', $tpl$Imtiyozli: salomlashish$tpl$, $tpl$Assalomu alaykum. Bog'langaningiz uchun rahmat!

Yaxshi, sizga hozir maqola uchun savollar havolasini tayyorlab beraman.$tpl$, true, true),
  ('referral_no_payment_reply', $tpl$Imtiyozli: narx savoliga javob$tpl$, $tpl$Bu savol bo'yicha mas'ul hamkasbim o'zi bog'lanadi.

Siz faqat ismingizni to'liq yozib yuboring — qolganini o'zimiz hal qilamiz.$tpl$, true, true)
on conflict (key) do nothing;
