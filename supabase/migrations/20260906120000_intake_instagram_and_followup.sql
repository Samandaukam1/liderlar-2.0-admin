-- ============================================================
-- Liderlar.uz 2.0 — Instagram username + post follow-up marker
--
-- 1. candidate_intakes.instagram_username
--    Anketaning yakuniy bosqichida IXTIYORIY to'ldiriladi. Kanonik shakl —
--    faqat username (@ ham, to'liq havola ham saqlanmaydi). Promote paytida
--    nomzodning social_links yozuviga ham ko'chiriladi.
--
-- 2. candidate_social_posts.instagram_followup_sent_at
--    Post Telegramga yuborilgandan KEYIN yuboriladigan Instagram xabari bir
--    marta ketishini kafolatlaydi. Retry, cron va batch bir xil postni qayta
--    ishlaganda ham ikkinchi xabar chiqmaydi: yozuv shu ustunni shartli
--    UPDATE bilan "band qiladi" (post_pipeline claim bilan bir xil uslub).
--
-- QOIDA: non-destructive va idempotent.
-- ============================================================

alter table public.candidate_intakes
  add column if not exists instagram_username text;

comment on column public.candidate_intakes.instagram_username is
  'Ixtiyoriy Instagram username (kanonik: @ va havolasiz, kichik harflarda).';

alter table public.candidate_social_posts
  add column if not exists instagram_followup_sent_at timestamptz;

comment on column public.candidate_social_posts.instagram_followup_sent_at is
  'Instagram collaboration xabari yuborilgan payt — takroriy yuborishni to''xtatadi.';
