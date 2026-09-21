-- =========================================================================
-- O'LCHOV: XABAR NIYATI VA BO'SHLIQ QARORI (31-band)
--
-- "Javobsiz savollar tozalandimi?" degan savolga TAXMIN bilan
-- javob berib bo'lmaydi. Eng muhim ko'rsatkich — YOLG'ON
-- JAVOBSIZLIK ULUSHI: oddiy muloqot xabarlari qanchasi
-- bo'shliqqa tushyapti.
--
-- Buni o'lchash uchun har kiruvchi xabarning tasnifi saqlanadi.
-- MATN EMAS, faqat tasnif — yozishma allaqachon o'z jadvalida
-- turibdi va uni takrorlash shart emas (37-band).
--
-- FORWARD-ONLY.
-- =========================================================================

alter table public.sales_messages
  add column if not exists message_intent text,
  add column if not exists gap_decision text;

comment on column public.sales_messages.message_intent is
  'Muloqot niyati: greeting, thanks, acknowledgement, knowledge_question... '
  'Faqat kiruvchi xabarlarda to''ladi.';

comment on column public.sales_messages.gap_decision is
  'Bo''shliq darvozasining qarori: knowledge_gap, case_escalation, none.';

-- Ko'rsatkichlar so'rovi uchun: oxirgi davr bo'yicha guruhlash.
create index if not exists sales_messages_intent_idx
  on public.sales_messages (sent_at desc)
  where message_intent is not null;
