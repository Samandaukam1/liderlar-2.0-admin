-- ============================================================
-- Liderlar.uz 2.0 — 0013: candidate photo confirmation
-- Non-destructive and idempotent.
-- ============================================================

alter table public.candidate_intakes
  add column if not exists selected_photo_kind text,
  add column if not exists photo_confirmed_at timestamptz;

alter table public.candidate_intake_photo_edits
  add column if not exists clothing_type text,
  add column if not exists color text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'candidate_intakes_selected_photo_kind_check'
      and conrelid = 'public.candidate_intakes'::regclass
  ) then
    alter table public.candidate_intakes
      add constraint candidate_intakes_selected_photo_kind_check
      check (selected_photo_kind is null or selected_photo_kind in ('original', 'ai'));
  end if;
end;
$$;

-- Keep the newest already-running equivalent job before adding the concurrency
-- guard. Completed/failed jobs remain untouched and can be regenerated.
with duplicate_jobs as (
  select
    id,
    row_number() over (
      partition by intake_id, source_attachment_id, clothing_type, coalesce(color, '')
      order by created_at desc, id desc
    ) as position
  from public.candidate_intake_photo_edits
  where status in ('queued', 'processing')
)
update public.candidate_intake_photo_edits as edits
set
  status = 'failed',
  error = 'duplicate_processing_job',
  finished_at = coalesce(edits.finished_at, now())
from duplicate_jobs
where edits.id = duplicate_jobs.id
  and duplicate_jobs.position > 1;

create unique index if not exists uq_candidate_photo_processing_job
  on public.candidate_intake_photo_edits (
    intake_id,
    source_attachment_id,
    clothing_type,
    coalesce(color, '')
  )
  where status in ('queued', 'processing');

create or replace function public.confirm_candidate_intake_photo(
  p_intake uuid,
  p_kind text,
  p_edit uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake record;
  v_source uuid;
  v_valid_edit boolean;
begin
  select id, status
  into v_intake
  from public.candidate_intakes
  where id = p_intake
    and deleted_at is null
  for update;

  if v_intake.id is null then
    return jsonb_build_object('ok', false, 'error', 'Anketa topilmadi');
  end if;
  if v_intake.status not in ('draft', 'needs_clarification') then
    return jsonb_build_object('ok', false, 'error', 'Anketa tahrirlash uchun yopiq');
  end if;
  if p_kind not in ('original', 'ai') then
    return jsonb_build_object('ok', false, 'error', 'Rasm tanlovi noto''g''ri');
  end if;

  select id
  into v_source
  from public.candidate_intake_attachments
  where intake_id = p_intake
    and is_primary_photo = true
    and status = 'active'
  limit 1;

  if v_source is null then
    return jsonb_build_object('ok', false, 'error', 'Original rasm topilmadi');
  end if;

  if p_kind = 'ai' then
    select exists (
      select 1
      from public.candidate_intake_photo_edits
      where id = p_edit
        and intake_id = p_intake
        and source_attachment_id = v_source
        and status = 'completed'
        and result_path is not null
    )
    into v_valid_edit;
    if not v_valid_edit then
      return jsonb_build_object('ok', false, 'error', 'Tayyor AI rasm topilmadi');
    end if;
  end if;

  update public.candidate_intake_photo_edits
  set is_selected = false
  where intake_id = p_intake
    and is_selected = true;

  if p_kind = 'ai' then
    update public.candidate_intake_photo_edits
    set is_selected = true
    where id = p_edit
      and intake_id = p_intake;
  end if;

  update public.candidate_intakes
  set
    selected_photo_kind = p_kind,
    photo_confirmed_at = now()
  where id = p_intake;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'edit_id', p_edit);
end;
$$;

revoke all on function public.confirm_candidate_intake_photo(uuid, text, uuid) from public, anon;
grant execute on function public.confirm_candidate_intake_photo(uuid, text, uuid) to service_role;
