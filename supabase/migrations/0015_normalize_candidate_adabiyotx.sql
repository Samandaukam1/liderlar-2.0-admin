-- ============================================================
-- Liderlar.uz 2.0 — 0015: candidate_adabiyotx_items normalizatsiyasi
-- integration_key faqat public.candidates jadvalida saqlanadi.
-- 0014 ning eski (denormalizatsiyalangan) varianti qo'llangan
-- bazalarni ham xavfsiz tozalaydi. Idempotent.
-- ============================================================

drop trigger if exists trg_candidate_adabiyotx_integration_key
  on public.candidate_adabiyotx_items;

drop function if exists public.set_candidate_adabiyotx_integration_key();

drop index if exists public.idx_candidate_adabiyotx_integration_listing;

alter table public.candidate_adabiyotx_items
  drop column if exists candidate_integration_key;
