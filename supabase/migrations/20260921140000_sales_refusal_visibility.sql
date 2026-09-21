-- =========================================================================
-- JIM QOLISH SABABI PANELDA KO'RINADI
--
-- MUAMMO (jonli tizimda kuzatilgan): bot mijozga javob yozmadi.
-- Panelda "avto-javob yoqiq" deb turardi, suhbat sahifasida ham
-- hech qanday ogohlantirish yo'q edi. Sabab faqat server log'ida
-- bor edi:
--
--   [sales-webhook] oqim: new -> offer_sent intent=other
--                   sent=0 refused=rollout_not_allowlisted
--
-- Ya'ni chiqarish rejimi "Tanlangan chatlar" edi va mijozning
-- chat id'si ro'yxatda yo'q edi. Buni topish uchun Vercel log'ini
-- o'qish kerak bo'ldi — admin uchun bu yo'l umuman yo'q.
--
-- YECHIM: sabab suhbat qatorida saqlanadi. Faqat QAMROV sabablari
-- yoziladi (sozlama/rollout/ulanish) — "inson qo'lga oldi" yoki
-- "mijoz opt-out qildi" ogohlantirish emas, ular ongli qaror va
-- panelda allaqachon o'z belgisi bor.
--
-- FORWARD-ONLY: hech narsa o'chirilmaydi, mavjud ustunlarga
-- tegilmaydi.
-- =========================================================================

alter table public.sales_conversations
  add column if not exists last_refusal_reason text,
  add column if not exists last_refusal_at timestamptz;

comment on column public.sales_conversations.last_refusal_reason is
  'Oxirgi javob QAMROV sababli yuborilmagan bo''lsa — sababi '
  '(rollout_not_allowlisted, auto_reply_disabled, connection_disabled, ...). '
  'Javob muvaffaqiyatli ketganda null ga qaytadi.';

comment on column public.sales_conversations.last_refusal_at is
  'last_refusal_reason yozilgan vaqt.';

-- Panel "javobsiz qolgan suhbatlar" ni tez topishi uchun.
-- Qisman indeks: qatorlarning aksariyatida bu ustun null.
create index if not exists sales_conversations_last_refusal_idx
  on public.sales_conversations (last_refusal_at desc)
  where last_refusal_reason is not null;
