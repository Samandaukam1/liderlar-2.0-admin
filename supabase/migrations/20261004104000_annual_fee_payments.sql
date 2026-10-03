-- =========================================================================
-- YILLIK TEXNIK BADAL (38 000 so'm) — TO'LOV QAYDLARI
--
-- Sikl nomzodning BIRINCHI nashr sanasidan (`candidates.published_at`)
-- hisoblanadi: har yili o'sha kun. Sikl hisobi ilovada (sof modul,
-- testlangan); bu jadval faqat TO'LOV FAKTINI saqlaydi.
--
-- "To'langan" FAQAT shu yerdagi yozuvdan ko'rsatiladi. Brauzer ham, sana
-- ham to'lovni "isbotlamaydi" — yozuvni admin qo'yadi. Nashr uchun
-- qilingan dastlabki to'lov (`candidate_intakes.payment_status`) yillik
-- badal deb TAXMIN QILINMAYDI.
--
-- Kartadan avtomatik yechish YO'Q.
-- FORWARD-ONLY.
-- =========================================================================

create table if not exists public.annual_fee_payments (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete restrict,

  -- Qaysi yillik sikl uchun: [cycle_start, cycle_end).
  cycle_start date not null,
  cycle_end date not null,
  check (cycle_end > cycle_start),

  amount_uzs integer not null default 38000 check (amount_uzs > 0),
  paid_at timestamptz not null default now(),

  recorded_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),

  unique (candidate_id, cycle_start)
);

create index if not exists idx_annual_fee_payments_candidate
  on public.annual_fee_payments (candidate_id, cycle_start desc);

comment on table public.annual_fee_payments is
  'Yillik texnik badal to''lovlari. Faqat admin (server) yozadi; '
  '"to''langan" holati faqat shu yozuvdan olinadi.';

alter table public.annual_fee_payments enable row level security;
revoke insert, update, delete, truncate on table public.annual_fee_payments from anon, authenticated;

drop policy if exists "member reads own annual fee" on public.annual_fee_payments;
create policy "member reads own annual fee"
  on public.annual_fee_payments for select
  to authenticated
  using (exists (
    select 1 from public.candidates c
     where c.id = annual_fee_payments.candidate_id and c.user_id = auth.uid()
  ));

drop policy if exists "admins read annual fee" on public.annual_fee_payments;
create policy "admins read annual fee"
  on public.annual_fee_payments for select
  to authenticated
  using (public.has_permission('members.view'));
