-- ============================================================
-- Liderlar.uz 2.0 — anketa: "Yo'q" deb belgilanadigan savollar
-- yuborishni to'smasin
--
-- Har bir savolda allow_no_answer = true, ya'ni nomzodda javob
-- bo'lmasa "Yo'q" tugmasini bosib o'tib ketishi mumkin. Lekin
-- intake_progress required_* ustunlari faqat is_required ga
-- qarardi, shuning uchun umuman tegilmagan (yozuvi yo'q) savol
-- ham "javobsiz majburiy" deb hisoblanib, submit_candidate_intake
-- ni to'sib qo'yardi — nomzod hamma savolni to'ldirmaguncha
-- "Anketani yuborish" ishlamasdi.
--
-- Endi savol faqat haqiqatan majburiy bo'lsa — ya'ni is_required
-- va allow_no_answer = false bo'lsa — yuborishni to'sadi.
-- total/answered ustunlari o'zgarmaydi: ular progress ko'rsatkichi
-- uchun ishlatiladi (masalan "10/15").
-- ============================================================

create or replace function public.intake_progress(p_intake uuid)
returns table (total integer, answered integer, required_total integer, required_answered integer)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select
      cq.id,
      -- Faqat "Yo'q" bilan o'tib bo'lmaydigan majburiy savol yuborishni to'sadi.
      (cq.is_required and not coalesce(cq.allow_no_answer, false)) as must_answer
    from public.candidate_intakes i
    join public.candidate_intake_questions cq on cq.template_id = i.template_id
    where i.id = p_intake
  ),
  a as (
    select question_id, answer_state, plain_text
    from public.candidate_intake_answers
    where intake_id = p_intake
  )
  select
    count(*)::int as total,
    count(*) filter (
      where exists (
        select 1 from a where a.question_id = q.id
          and (a.answer_state = 'no_answer'
               or (a.answer_state = 'answered' and char_length(trim(a.plain_text)) > 0))
      )
    )::int as answered,
    count(*) filter (where q.must_answer)::int as required_total,
    count(*) filter (
      where q.must_answer and exists (
        select 1 from a where a.question_id = q.id
          and (a.answer_state = 'no_answer'
               or (a.answer_state = 'answered' and char_length(trim(a.plain_text)) > 0))
      )
    )::int as required_answered
  from q;
$$;

grant execute on function public.intake_progress(uuid) to authenticated, service_role;
