-- ============================================================
-- Liderlar.uz — structured candidate profile V2
-- NON-DESTRUCTIVE / IDEMPOTENT:
--   * mavjud candidates/articles/intake ma'lumotlarini o'chirmaydi;
--   * mavjud ustunlarni takrorlamaydi;
--   * eski short_bio, birth_date, region/category qiymatlarini backfill qiladi;
--   * draft/review ma'lumotlari anon foydalanuvchiga ochilmaydi.
-- ============================================================

alter table public.candidates
  add column if not exists description_items text[] not null default '{}'::text[],
  add column if not exists birth_year text,
  add column if not exists birth_place text,
  add column if not exists current_location text,
  add column if not exists education_summary text,
  add column if not exists activity_field text,
  add column if not exists languages text[] not null default '{}'::text[],
  add column if not exists raw_content text,
  add column if not exists formatted_content text,
  add column if not exists unparsed_content text,
  add column if not exists ai_generated_at timestamptz,
  add column if not exists ai_model text,
  add column if not exists ai_status text,
  add column if not exists ai_raw_response jsonb,
  add column if not exists manually_reviewed boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

-- V2 lifecycle statuslari. Mavjud to'rtta status yangi ro'yxatning ichida qoladi.
alter table public.candidates drop constraint if exists candidates_status_check;
alter table public.candidates
  add constraint candidates_status_check
  check (status in (
    'intake', 'ai_processing', 'draft', 'review',
    'published', 'rejected', 'archived'
  )) not valid;
alter table public.candidates validate constraint candidates_status_check;

alter table public.candidates drop constraint if exists candidates_ai_status_check;
alter table public.candidates
  add constraint candidates_ai_status_check
  check (ai_status is null or ai_status in ('idle', 'processing', 'succeeded', 'failed')) not valid;
alter table public.candidates validate constraint candidates_ai_status_check;

-- Eski profillarni yangi maydonlarda ham ishlatish uchun xavfsiz backfill.
update public.candidates
set description_items = array(
  select trim(item)
  from unnest(string_to_array(short_bio, '|')) as item
  where trim(item) <> ''
)
where coalesce(array_length(description_items, 1), 0) = 0
  and nullif(trim(coalesce(short_bio, '')), '') is not null;

update public.candidates
set birth_year = to_char(birth_date, 'YYYY-MM-DD')
where nullif(trim(coalesce(birth_year, '')), '') is null
  and birth_date is not null;

update public.candidates as c
set current_location = r.name
from public.regions as r
where c.region_id = r.id
  and nullif(trim(coalesce(c.current_location, '')), '') is null;

update public.candidates as c
set activity_field = cat.name
from public.categories as cat
where c.category_id = cat.id
  and nullif(trim(coalesce(c.activity_field, '')), '') is null;

create table if not exists public.candidate_sections (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(title) <= 240),
  check (char_length(content) <= 50000),
  check (char_length(trim(title)) > 0 or char_length(trim(content)) > 0)
);

create index if not exists idx_candidate_sections_candidate_order
  on public.candidate_sections(candidate_id, sort_order, created_at);

create index if not exists idx_candidates_public_catalog_v2
  on public.candidates(status, created_at desc)
  where deleted_at is null;

create index if not exists idx_candidates_public_slug_v2
  on public.candidates(slug)
  where status = 'published' and deleted_at is null;

create index if not exists idx_candidates_full_name_trgm_v2
  on public.candidates using gin (full_name gin_trgm_ops)
  where deleted_at is null;

-- Public katalog uchun bitta paginated query: katta matnlar olinmaydi,
-- reyting/view sanog'i N+1 so'rovsiz server tomonda hisoblanadi.
create or replace function public.list_published_candidates_v2(
  p_query text default null,
  p_region_slug text default null,
  p_category_slug text default null,
  p_birth_year integer default null,
  p_sort text default 'reyting',
  p_limit integer default 12,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  full_name text,
  short_bio text,
  description_items text[],
  avatar_url text,
  is_top100 boolean,
  top100_position integer,
  region jsonb,
  category jsonb,
  total_score numeric,
  position integer,
  previous_position integer,
  view_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.slug,
    c.full_name,
    c.short_bio,
    c.description_items,
    c.avatar_url,
    c.is_top100,
    c.top100_position,
    case when r.id is null then null else jsonb_build_object('name', r.name, 'slug', r.slug) end as region,
    case when cat.id is null then null else jsonb_build_object('name', cat.name, 'slug', cat.slug, 'color', cat.color) end as category,
    coalesce(score.total_score, 0) as total_score,
    score.position,
    score.previous_position,
    coalesce(views.view_count, 0) as view_count,
    count(*) over() as total_count
  from public.candidates c
  left join public.regions r on r.id = c.region_id
  left join public.categories cat on cat.id = c.category_id
  left join lateral (
    select rs.total_score, rs.position, rs.previous_position
    from public.ranking_scores rs
    where rs.candidate_id = c.id
      and rs.category = 'overall'
      and rs.is_current = true
    order by rs.created_at desc
    limit 1
  ) score on true
  left join lateral (
    select count(*)::bigint as view_count
    from public.profile_views pv
    where pv.candidate_id = c.id and pv.is_counted = true
  ) views on true
  where c.status = 'published'
    and c.deleted_at is null
    and (nullif(trim(coalesce(p_query, '')), '') is null or c.full_name ilike '%' || trim(p_query) || '%')
    and (nullif(trim(coalesce(p_region_slug, '')), '') is null or r.slug = p_region_slug)
    and (nullif(trim(coalesce(p_category_slug, '')), '') is null or cat.slug = p_category_slug)
    and (
      p_birth_year is null
      or extract(year from c.birth_date)::integer = p_birth_year
      or c.birth_year ~ ('(^|[^0-9])' || p_birth_year::text || '([^0-9]|$)')
    )
  order by
    case when p_sort = 'reyting' then score.position end asc nulls last,
    case when p_sort = 'reyting' then score.total_score end desc nulls last,
    case when p_sort = 'eng-kop-oqilgan' then views.view_count end desc nulls last,
    case when p_sort = 'alifbo' then c.full_name end asc,
    case when p_sort = 'eng-yangi' then c.created_at end desc,
    c.created_at desc,
    c.id
  limit least(greatest(coalesce(p_limit, 12), 1), 48)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_published_candidates_v2(text, text, text, integer, text, integer, integer) from public;
grant execute on function public.list_published_candidates_v2(text, text, text, integer, text, integer, integer) to anon, authenticated, service_role;

drop trigger if exists trg_candidate_sections_updated on public.candidate_sections;
create trigger trg_candidate_sections_updated
  before update on public.candidate_sections
  for each row execute function public.set_updated_at();

alter table public.candidate_sections enable row level security;

drop policy if exists "published candidate sections are public" on public.candidate_sections;
create policy "published candidate sections are public"
  on public.candidate_sections for select
  using (
    exists (
      select 1 from public.candidates c
      where c.id = candidate_sections.candidate_id
        and c.status = 'published'
        and c.deleted_at is null
    )
  );

drop policy if exists "candidate section admins read" on public.candidate_sections;
create policy "candidate section admins read"
  on public.candidate_sections for select
  to authenticated
  using (public.has_permission('candidates.view'));

drop policy if exists "candidate section writers" on public.candidate_sections;
create policy "candidate section writers"
  on public.candidate_sections for all
  to authenticated
  using (public.has_permission('candidates.edit'))
  with check (public.has_permission('candidates.edit'));

-- Bitta RPC candidate va dynamic sectionlarni bitta transaction ichida saqlaydi.
-- UI yuborgan section ID boshqa candidate'ga tegishli bo'lsa operatsiya rad etiladi.
create or replace function public.save_candidate_profile_v2(
  p_candidate uuid,
  p_payload jsonb,
  p_sections jsonb,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  delete from public.candidate_sections
  where candidate_id = v_candidate
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
$$;

revoke all on function public.save_candidate_profile_v2(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_candidate_profile_v2(uuid, jsonb, jsonb, uuid) to service_role;

-- AI prompt global setting: har bir candidate qatorida takrorlanmaydi.
insert into public.site_settings (key, value)
values (
  'candidate_structuring_prompt',
  $prompt$SEN PROFESSIONAL BIOGRAFIK MAQOLA MUALLIFI VA MA’LUMOTLARNI STRUKTURALOVCHI SUN’IY INTELLEKTSAN.

Quyida nomzod tomonidan yuborilgan ma’lumotlar beriladi. Ularni o‘rganib, imloviy va uslubiy xatolarsiz, ta’sirli, keng, dinamik va professional biografik maqola shaklida tayyorla.

Hech qanday faktni o‘zingdan to‘qima. Berilmagan yutuq, til, lavozim, sana yoki tashkilot nomini qo‘shma. Tushunarsiz ma’lumot bo‘lsa, uni mantiqan o‘zgartirib yuborma.

Natijani faqat quyidagi markerlar asosida yoz:

!!!Ism-familiyasi va otasining ismi
&&&Qisqa tavsif
+++Tug‘ilgan yili
***Tug‘ilgan joyi
$$$Hozirda yashash hududi
(((Ta’limi
)))Faoliyat sohasi
%%%Gaplasha oladigan tillari

Har bir marker yangi qator boshida yozilsin. Marker bilan qiymat orasida bo‘sh joy bo‘lmasin. Qisqa tavsifdagi yo‘nalishlar va tillar ` | ` belgisi bilan ajratilsin.

Asosiy ma’lumotlardan keyin biografik maqolani bo‘limlarga ajrat. Har bir yangi bo‘lim sarlavhasi oldidan `^^^` markerini yoz. Bo‘lim matni sarlavhadan keyingi qatordan boshlansin.

Maqolada mavjud ma’lumotlarga qarab bolalik va shakllanish davri, ta’lim yo‘li, faoliyatining boshlanishi, yutuqlar va natijalar, jamoatchilik yoki volontyorlik faoliyati, hayotiy tamoyillari, shaxsiy fazilatlari, kelajak maqsadlari hamda jamiyat va Vatan rivojiga munosabati yoritilsin.

Har bir bo‘lim mazmunli, tabiiy va bir-birini takrorlamaydigan bo‘lsin. Maqola quruq tarjimai hol bo‘lib qolmasin. U insonning intilishi, xarakteri, yo‘li va maqsadini ochib bersin.

Matnda haddan tashqari balandparvoz, isbotlanmagan yoki sun’iy maqtovlardan foydalanma. Imloviy xato qilma.

Natijada hech qanday izoh, kirish gapi, markdown kod bloki yoki qo‘shimcha tavsiya yozma. Faqat tayyor markerli ma’lumot va maqolani chiqar.

NOMZOD YUBORGAN MA’LUMOTLAR:

[SHU YERGA NOMZODNING BARCHA MA’LUMOTLARINI JOYLASHTIRING]$prompt$
)
on conflict (key) do nothing;
