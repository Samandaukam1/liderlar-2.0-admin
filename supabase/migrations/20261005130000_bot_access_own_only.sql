-- =====================================================================
-- BOTLAR BOSHQARUVI: "FAQAT O'Z NOMZODLARI" REJIMI.
--
-- Rejim yoqilgan Telegram ID nomzodga bog'liq xabarlarni (tayyor post,
-- "to'lov tasdiqlandimi?", "kanalga qo'yildimi?", avto-tuzatish, qora
-- ro'yxat ogohlantirishi) va CRM ro'yxatlarini FAQAT o'zi bot orqali
-- yaratgan anketa havolalari bo'yicha oladi. Rejim o'chiq bo'lsa —
-- avvalgidek hammasi.
--
-- Buning uchun anketa kimning chatidan yaratilgani saqlanadi. Eski
-- anketalarda bu ma'lumot yo'q (hech qayerda yozilmagan edi) — ular
-- faqat umumiy rejimdagilarga boradi.
-- =====================================================================

alter table public.bot_access
  add column if not exists own_only boolean not null default false;

alter table public.candidate_intakes
  add column if not exists created_by_telegram_id bigint;

comment on column public.candidate_intakes.created_by_telegram_id is
  'Anketa havolasini bot orqali yaratgan chat (Liderlar boti yoki AI sotuv boti). Panelda yaratilganda null.';

create index if not exists candidate_intakes_created_by_telegram_idx
  on public.candidate_intakes (created_by_telegram_id)
  where created_by_telegram_id is not null;
