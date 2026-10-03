-- =========================================================================
-- NOMZOD QACHON CHOP ETILGAN — YAGONA ISHONCHLI SANA
--
-- MUAMMO: `candidates` da nashr sanasi yo'q edi. Sana ikki joyda sochilgan:
-- anketa (`candidate_intakes.published_at`) va audit jurnali (admin qo'lda
-- chop etganlar). Kunlik Premium Challenge ("09:00 dan OLDIN chop etilgan")
-- va yillik texnik badal sikli aynan shu sanaga tayanadi — uni har safar
-- taxmin qilish yoki `created_at` bilan almashtirish noto'g'ri bo'lardi.
--
-- MANBA (production'da tekshirilgan, 2026-10-04):
--   · 1437 nomzod — anketa `published_at`;
--   · 146 nomzod — audit jurnalidagi ENG BIRINCHI nashr hodisasi
--     (`candidate.status.published` / `article.published` / `intake.publish`).
--   Hammasi qamraladi; sana o'ylab topilmaydi. Manbasi yo'q nomzodda
--   ustun `null` qoladi va ilova "sana aniqlanmagan" deydi.
--
-- KEYINGI NASHRLAR: trigger holat birinchi marta `published` bo'lganda
-- `now()` ni yozadi. Qayta nashr qilish sanani O'ZGARTIRMAYDI — yillik
-- sikl birinchi nashrdan hisoblanadi.
--
-- FORWARD-ONLY. Mavjud ustunlarga tegilmaydi.
-- =========================================================================

alter table public.candidates
  add column if not exists published_at timestamptz;

comment on column public.candidates.published_at is
  'Birinchi marta chop etilgan lahza. Yillik badal sikli va kunlik challenge '
  'sharti shunga tayanadi. Trigger yozadi; qayta nashrda o''zgarmaydi.';

-- 1. Anketa sanasi.
update public.candidates c
   set published_at = i.published_at
  from public.candidate_intakes i
 where c.published_at is null
   and c.status = 'published'
   and i.id = c.source_intake_id
   and i.published_at is not null;

-- 2. Audit jurnalidagi eng birinchi nashr hodisasi (qo'lda chop etilganlar).
update public.candidates c
   set published_at = a.first_at
  from (
    select entity_id, min(created_at) as first_at
      from public.audit_logs
     where action in ('candidate.status.published', 'article.published', 'intake.publish')
     group by entity_id
  ) a
 where c.published_at is null
   and c.status = 'published'
   and a.entity_id = c.id::text;

create or replace function public.candidates_set_published_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_candidates_published_at on public.candidates;
create trigger trg_candidates_published_at
  before insert or update of status on public.candidates
  for each row execute function public.candidates_set_published_at();

create index if not exists idx_candidates_published_at
  on public.candidates (published_at)
  where status = 'published' and deleted_at is null;

do $$
declare
  v_total integer;
  v_dated integer;
begin
  select count(*), count(published_at) into v_total, v_dated
    from public.candidates where status = 'published' and deleted_at is null;
  raise notice 'Chop etilgan: %, sanasi aniq: %', v_total, v_dated;
end;
$$;
