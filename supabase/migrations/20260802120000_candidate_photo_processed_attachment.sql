-- ============================================================
-- Liderlar.uz 2.0 — processed photo attachment columns
-- Additive and idempotent.
--
-- completePhotoEditWithAttachment() has always written
-- candidate_intake_attachments.scan_status and
-- candidate_intake_photo_edits.processed_attachment_id, but no migration ever
-- created either column, so PostgREST rejected every generated portrait with
-- PGRST204 ("column not found in the schema cache") — a 400 on insert that the
-- route surfaced as a 502. The confirm precheck reads both columns too.
-- ============================================================

-- Existing rows predate any scanning pipeline and are already trusted, so the
-- default must be 'ready' — 'pending' would make every current photo
-- unconfirmable.
alter table public.candidate_intake_attachments
  add column if not exists scan_status text not null default 'ready';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'candidate_intake_attachments_scan_status_check'
      and conrelid = 'public.candidate_intake_attachments'::regclass
  ) then
    alter table public.candidate_intake_attachments
      add constraint candidate_intake_attachments_scan_status_check
      check (scan_status in ('pending', 'ready', 'failed'));
  end if;
end;
$$;

alter table public.candidate_intake_photo_edits
  add column if not exists processed_attachment_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'candidate_intake_photo_edits_processed_attachment_id_fkey'
      and conrelid = 'public.candidate_intake_photo_edits'::regclass
  ) then
    alter table public.candidate_intake_photo_edits
      add constraint candidate_intake_photo_edits_processed_attachment_id_fkey
      foreign key (processed_attachment_id)
      references public.candidate_intake_attachments(id) on delete set null;
  end if;
end;
$$;

create index if not exists idx_intake_photo_edits_processed_attachment
  on public.candidate_intake_photo_edits(processed_attachment_id);
