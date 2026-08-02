-- ============================================================
-- Liderlar.uz 2.0 — fact preservation + structured short bio / article
-- Additive and idempotent. No existing column, constraint or policy is
-- dropped, and no table is duplicated: the answer AI columns,
-- candidates.description_items and candidate_sections already exist and are
-- reused as-is.
-- ============================================================

-- ---------- per-answer fact preservation ----------
-- plain_text (original) and ai_improved_text (improved) already exist; these
-- record WHICH anchors were found and which the model dropped, so the admin
-- sees why an answer fell back to the raw text.
alter table public.candidate_intake_answers
  add column if not exists ai_preserved_facts jsonb not null default '[]'::jsonb,
  add column if not exists ai_fact_preservation jsonb not null default '{}'::jsonb;

-- ---------- structured short bio on the intake ----------
-- short_bio stays the canonical " | "-joined string that the promote RPC and
-- candidates.description_items backfill already read; this keeps the item list
-- losslessly alongside it.
alter table public.candidate_intakes
  add column if not exists short_bio_items text[] not null default '{}'::text[];

-- ---------- article quality metadata on the candidate ----------
-- The article body itself lives in candidate_sections (unchanged); these
-- columns carry the facts card and the QA report shown in the admin preview.
alter table public.candidates
  add column if not exists key_facts jsonb not null default '[]'::jsonb,
  add column if not exists article_word_count integer,
  add column if not exists fact_preservation_report jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'candidates_article_word_count_check'
      and conrelid = 'public.candidates'::regclass
  ) then
    alter table public.candidates
      add constraint candidates_article_word_count_check
      check (article_word_count is null or article_word_count >= 0);
  end if;
end;
$$;

-- Backfill the intake item list from the existing " | " short bios so already
-- reviewed intakes render as badges immediately.
update public.candidate_intakes
set short_bio_items = array(
  select trim(item)
  from unnest(string_to_array(short_bio, '|')) as item
  where trim(item) <> ''
)
where coalesce(array_length(short_bio_items, 1), 0) = 0
  and nullif(trim(coalesce(short_bio, '')), '') is not null;
