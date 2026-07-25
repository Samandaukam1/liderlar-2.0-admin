-- ============================================================
-- Liderlar.uz 2.0 — 0001: Extensions
-- Supabase SQL Editor da ishga tushiriladi. Idempotent.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- updated_at ni avtomatik yangilovchi umumiy trigger funksiyasi
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
