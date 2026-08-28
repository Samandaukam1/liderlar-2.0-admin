-- ============================================================
-- Canonical intake quote for Post Studio (additive/idempotent)
-- ============================================================

-- A semantic key survives question reordering and template version changes.
alter table public.candidate_intake_questions
  add column if not exists canonical_key text;

create unique index if not exists uq_intake_question_canonical_key
  on public.candidate_intake_questions(template_id, canonical_key)
  where canonical_key is not null;

-- Backfill exactly one quote question per template. The known prompt is the
-- primary match; question_no=15 is only the compatibility path for old copies
-- of the Liderlar V2 template whose wording was edited by an admin.
with ranked as (
  select
    question.id,
    row_number() over (
      partition by question.template_id
      order by
        case
          when lower(regexp_replace(question.prompt, '\s+', ' ', 'g')) =
               lower('Boshqa yoshlar uchun qanday maslahat yoki motivatsion fikr bildirasiz?')
            then 0
          else 1
        end,
        question.question_no,
        question.id
    ) as position
  from public.candidate_intake_questions question
  join public.candidate_intake_templates template on template.id = question.template_id
  where
    lower(regexp_replace(question.prompt, '\s+', ' ', 'g')) =
      lower('Boshqa yoshlar uchun qanday maslahat yoki motivatsion fikr bildirasiz?')
    or (template.slug = 'liderlar-v2' and question.question_no = 15)
)
update public.candidate_intake_questions question
set canonical_key = 'post_quote'
from ranked
where question.id = ranked.id
  and ranked.position = 1
  and question.canonical_key is distinct from 'post_quote';

-- The main question wording is intentionally not changed.
update public.candidate_intake_questions
set help_text =
  'Bitta gap bilan yozing, chunki bu iqtibos postga qo‘shiladi. Ortiqcha so‘zlarsiz yozing.'
where canonical_key = 'post_quote'
  and help_text is distinct from
    'Bitta gap bilan yozing, chunki bu iqtibos postga qo‘shiladi. Ortiqcha so‘zlarsiz yozing.';

-- Record the real provenance instead of pretending an intake answer came from
-- a featured quote, article excerpt, or life-motto row.
alter table public.candidate_social_posts
  drop constraint if exists candidate_social_posts_quote_source_check;

alter table public.candidate_social_posts
  add constraint candidate_social_posts_quote_source_check
  check (quote_source in (
    'intake_quote', 'featured_quote', 'article_quote', 'life_motto', 'manual', 'none'
  ));

-- Existing unpublished automatic drafts used legacy quote sources. Repoint
-- them to the raw canonical answer and require one fresh render; rendered
-- files are not deleted and already-published history is left untouched.
with canonical_answers as (
  select
    post.id as post_id,
    intake.id as intake_id,
    question.id as question_id,
    answer.id as answer_id,
    case
      when answer.answer_state = 'answered'
        then trim(regexp_replace(coalesce(answer.plain_text, ''), '\s+', ' ', 'g'))
      else ''
    end as quote_text
  from public.candidate_social_posts post
  join public.candidates candidate on candidate.id = post.candidate_id
  join lateral (
    select candidate_intake.id, candidate_intake.template_id
    from public.candidate_intakes candidate_intake
    where candidate_intake.id = candidate.source_intake_id
       or candidate_intake.candidate_id = candidate.id
    order by
      case when candidate_intake.id = candidate.source_intake_id then 0 else 1 end,
      candidate_intake.created_at desc
    limit 1
  ) intake on true
  join public.candidate_intake_questions question
    on question.template_id = intake.template_id
   and question.canonical_key = 'post_quote'
  left join public.candidate_intake_answers answer
    on answer.intake_id = intake.id
   and answer.question_id = question.id
  where post.quote_source is distinct from 'manual'
    and post.status <> 'published'
)
update public.candidate_social_posts post
set
  quote = canonical.quote_text,
  quote_source = case when canonical.quote_text = '' then 'none' else 'intake_quote' end,
  status = 'needs_review',
  error = case
    when canonical.quote_text = ''
      then '15-savol iqtibosi bo''sh. Iqtibosni qo''lda kiriting.'
    else 'Canonical 15-savol iqtibosi ulandi. Postni qayta render qiling.'
  end,
  metadata = jsonb_set(
    coalesce(post.metadata, '{}'::jsonb),
    '{quote_provenance}',
    jsonb_build_object(
      'canonical_key', 'post_quote',
      'intake_id', canonical.intake_id,
      'question_id', canonical.question_id,
      'answer_id', canonical.answer_id,
      'original_preserved', true
    ),
    true
  )
from canonical_answers canonical
where post.id = canonical.post_id
  and (
    post.quote is distinct from canonical.quote_text
    or post.quote_source is distinct from
      case when canonical.quote_text = '' then 'none' else 'intake_quote' end
  );
