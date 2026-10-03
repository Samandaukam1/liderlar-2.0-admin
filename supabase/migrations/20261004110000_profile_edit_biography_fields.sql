-- =========================================================================
-- PROFIL MUHARRIRI — BIOGRAFIYADAGI BARCHA MAYDONLAR
--
-- MUAMMO: ommaviy biografiyada ko'rinadigan bir qator maydonlarni
-- (ism, tug'ilgan yil/joy, ta'lim xulosasi, manzil, soha, teglar, tillar)
-- VIP a'zo hech qayerda boshqara olmasdi.
--
-- Ko'rik talab qiladiganlari (ism, tug'ilgan yil, tug'ilgan joy, ta'lim
-- xulosasi) shu funksiya orqali qo'llanadi. Maydonlar ro'yxati QAT'IY —
-- dinamik SQL yo'q (in'ektsiya imkonsiz). Qolgan qism
-- 20261002230000_rpc_conflict_codes.sql dagi bilan bir xil (PT409).
--
-- FORWARD-ONLY. Imzo o'zgarmaydi — `create or replace`, huquqlar saqlanadi.
-- =========================================================================

create or replace function public.apply_candidate_profile_edit(
  p_edit_id uuid,
  p_reviewer_id uuid,
  p_note text default null
)
returns public.candidate_profile_edits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edit public.candidate_profile_edits;
  v_result public.candidate_profile_edits;
begin
  select * into v_edit
  from public.candidate_profile_edits
  where id = p_edit_id
  for update;

  if not found then
    raise exception 'Tahrir topilmadi: %', p_edit_id using errcode = 'no_data_found';
  end if;

  if v_edit.state <> 'pending_review' then
    /*
     * Ikki admin bir vaqtda tasdiqlasa, ikkinchisi shu yerda to'xtaydi.
     * `PT409` — 40001 EMAS: shart deterministik va qayta urinish
     * har safar shu yerga qaytib kelardi.
     */
    raise exception 'Bu tahrir allaqachon ko''rildi: %', v_edit.state
      using errcode = 'PT409';
  end if;

  /*
   * MAYDONLAR RO'YXATI QAT'IY — dinamik SQL yo'q (in'ektsiya imkonsiz).
   * Ro'yxat koddagi `CANDIDATE_FIELDS` ning `review` siyosatidagi
   * maydonlari bilan mos.
   */
  if v_edit.field = 'birth_date' then
    update public.candidates
      set birth_date = nullif(v_edit.after_value, '')::date
      where id = v_edit.candidate_id;

  elsif v_edit.field = 'region_id' then
    update public.candidates
      set region_id = nullif(v_edit.after_value, '')::uuid
      where id = v_edit.candidate_id;

  elsif v_edit.field = 'category_id' then
    update public.candidates
      set category_id = nullif(v_edit.after_value, '')::uuid
      where id = v_edit.candidate_id;

  /*
   * BIOGRAFIYA MAYDONLARI (2026-10-04) — muharrirda ko'rikka boradiganlar.
   * Ism bo'sh bo'lishi mumkin emas: ensiklopediya yozuvining sarlavhasi.
   * Slug O'ZGARMAYDI — eski havolalar ishlayveradi.
   */
  elsif v_edit.field = 'full_name' then
    if nullif(btrim(coalesce(v_edit.after_value, '')), '') is null then
      raise exception 'Ism bo''sh bo''lishi mumkin emas' using errcode = 'invalid_parameter_value';
    end if;
    update public.candidates
      set full_name = btrim(v_edit.after_value)
      where id = v_edit.candidate_id;

  elsif v_edit.field = 'birth_year' then
    update public.candidates
      set birth_year = nullif(btrim(coalesce(v_edit.after_value, '')), '')
      where id = v_edit.candidate_id;

  elsif v_edit.field = 'birth_place' then
    update public.candidates
      set birth_place = nullif(btrim(coalesce(v_edit.after_value, '')), '')
      where id = v_edit.candidate_id;

  elsif v_edit.field = 'education_summary' then
    update public.candidates
      set education_summary = nullif(btrim(coalesce(v_edit.after_value, '')), '')
      where id = v_edit.candidate_id;

  else
    raise exception 'Bu maydon qo''llanmaydi: %', v_edit.field
      using errcode = 'invalid_parameter_value';
  end if;

  update public.candidate_profile_edits
    set state = 'applied',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        review_note = p_note
    where id = p_edit_id
    returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.apply_candidate_profile_edit(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.apply_candidate_profile_edit(uuid, uuid, text)
  to service_role;
