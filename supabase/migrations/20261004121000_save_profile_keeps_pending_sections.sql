-- =========================================================================
-- PANEL SAQLASHI A'ZONING KUTAYOTGAN BO'LIMINI O'CHIRMASIN
--
-- `save_candidate_profile_v2` oxirida payloadda bo'lmagan BARCHA
-- bo'limni o'chirardi. 20261004120000 bilan `candidate_sections` da
-- ko'rik holati paydo bo'ldi va panel muharriri faqat `published`
-- bo'limlarni yuklaydi — ya'ni a'zoning `pending_review` matni
-- payloadga tushmaydi va eski o'chirish uni yo'q qilardi.
--
-- Funksiya matni production'dagi ta'rifdan AYNAN olingan; faqat
-- o'chirish shartiga `review_state = 'published'` qo'shilgan.
-- `create or replace` huquqlarni saqlaydi.
--
-- FORWARD-ONLY. Ma'lumotga tegilmaydi.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.save_candidate_profile_v2(p_candidate uuid, p_payload jsonb, p_sections jsonb, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_candidate uuid := p_candidate;
  v_full_name text := trim(coalesce(p_payload ->> 'fullName', ''));
  v_slug text := trim(coalesce(p_payload ->> 'slug', ''));
  v_section jsonb;
  v_section_id uuid;
  v_keep_ids uuid[] := '{}'::uuid[];
begin
  if char_length(v_full_name) < 3 then
    raise exception 'Ism-familiya kamida 3 ta belgidan iborat bo''lishi kerak';
  end if;

  if v_slug = '' then
    v_slug := trim(both '-' from regexp_replace(lower(v_full_name), '[^a-z0-9]+', '-', 'g'));
  end if;
  if v_slug = '' then
    v_slug := 'nomzod-' || substr(md5(v_full_name || now()::text), 1, 8);
  end if;

  if exists (
    select 1 from public.candidates
    where slug = v_slug and deleted_at is null and id is distinct from v_candidate
  ) then
    raise exception '“%” slug allaqachon band', v_slug;
  end if;

  if v_candidate is null then
    insert into public.candidates (
      slug, full_name, short_bio, avatar_url, status,
      description_items, birth_year, birth_place, current_location,
      education_summary, activity_field, languages,
      raw_content, formatted_content, unparsed_content
    ) values (
      v_slug,
      v_full_name,
      nullif(left(array_to_string(array(select jsonb_array_elements_text(coalesce(p_payload -> 'descriptionItems', '[]'::jsonb))), ' | '), 600), ''),
      nullif(trim(coalesce(p_payload ->> 'profilePhoto', '')), ''),
      'draft',
      array(select jsonb_array_elements_text(coalesce(p_payload -> 'descriptionItems', '[]'::jsonb))),
      nullif(trim(coalesce(p_payload ->> 'birthYear', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'birthPlace', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'currentLocation', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'education', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'activityField', '')), ''),
      array(select jsonb_array_elements_text(coalesce(p_payload -> 'languages', '[]'::jsonb))),
      nullif(coalesce(p_payload ->> 'rawContent', ''), ''),
      nullif(coalesce(p_payload ->> 'formattedContent', ''), ''),
      nullif(coalesce(p_payload ->> 'unparsedContent', ''), '')
    ) returning id into v_candidate;
  else
    if not exists (select 1 from public.candidates where id = v_candidate and deleted_at is null) then
      raise exception 'Nomzod topilmadi';
    end if;

    update public.candidates set
      slug = v_slug,
      full_name = v_full_name,
      short_bio = nullif(left(array_to_string(array(select jsonb_array_elements_text(coalesce(p_payload -> 'descriptionItems', '[]'::jsonb))), ' | '), 600), ''),
      avatar_url = nullif(trim(coalesce(p_payload ->> 'profilePhoto', '')), ''),
      description_items = array(select jsonb_array_elements_text(coalesce(p_payload -> 'descriptionItems', '[]'::jsonb))),
      birth_year = nullif(trim(coalesce(p_payload ->> 'birthYear', '')), ''),
      birth_place = nullif(trim(coalesce(p_payload ->> 'birthPlace', '')), ''),
      current_location = nullif(trim(coalesce(p_payload ->> 'currentLocation', '')), ''),
      education_summary = nullif(trim(coalesce(p_payload ->> 'education', '')), ''),
      activity_field = nullif(trim(coalesce(p_payload ->> 'activityField', '')), ''),
      languages = array(select jsonb_array_elements_text(coalesce(p_payload -> 'languages', '[]'::jsonb))),
      raw_content = nullif(coalesce(p_payload ->> 'rawContent', ''), ''),
      formatted_content = nullif(coalesce(p_payload ->> 'formattedContent', ''), ''),
      unparsed_content = nullif(coalesce(p_payload ->> 'unparsedContent', ''), '')
    where id = v_candidate;
  end if;

  for v_section in
    select value from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb))
  loop
    v_section_id := coalesce(nullif(v_section ->> 'id', '')::uuid, gen_random_uuid());
    if exists (
      select 1 from public.candidate_sections
      where id = v_section_id and candidate_id <> v_candidate
    ) then
      raise exception 'Bo''lim boshqa nomzodga tegishli';
    end if;

    insert into public.candidate_sections (id, candidate_id, title, content, sort_order)
    values (
      v_section_id,
      v_candidate,
      left(trim(coalesce(v_section ->> 'title', '')), 240),
      left(trim(coalesce(v_section ->> 'content', '')), 50000),
      greatest(0, coalesce((v_section ->> 'order')::integer, 0))
    )
    on conflict (id) do update set
      title = excluded.title,
      content = excluded.content,
      sort_order = excluded.sort_order
    where candidate_sections.candidate_id = v_candidate;

    v_keep_ids := array_append(v_keep_ids, v_section_id);
  end loop;

  /*
   * O'CHIRISH FAQAT NASHR BO'LGAN BO'LIMLARGA.
   *
   * Panel muharriri a'zoning KUTAYOTGAN matnini ko'rsatmaydi, ya'ni u
   * payloadga ham tushmaydi. Shart qo'shilmasa, admin profilni har
   * saqlaganda a'zo yuborgan va hali ko'rilmagan matn JIMGINA
   * o'chib ketardi — ko'rik navbati esa bo'shab qolardi.
   */
  delete from public.candidate_sections
  where candidate_id = v_candidate
    and review_state = 'published'
    and not (id = any(v_keep_ids));

  perform public.write_audit_log(
    p_actor,
    case when p_candidate is null then 'candidate.create.v2' else 'candidate.update.v2' end,
    'candidate',
    v_candidate::text,
    null,
    jsonb_build_object('slug', v_slug, 'sections', jsonb_array_length(coalesce(p_sections, '[]'::jsonb))),
    null,
    'info'
  );

  return jsonb_build_object('candidate_id', v_candidate, 'slug', v_slug);
end;
$function$
;
