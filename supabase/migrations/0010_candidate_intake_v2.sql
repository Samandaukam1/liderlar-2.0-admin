-- ============================================================
-- Liderlar.uz 2.0 — 0010: Candidate Intake V2
-- Nomzod anketasini yig'ish tizimi (qo'lda + xavfsiz havola).
--
-- QOIDA: Bu migration NON-DESTRUCTIVE va IDEMPOTENT.
--   * Hech qanday `drop table` yo'q.
--   * Mavjud 42-jadvalli sxema (0001–0009) canonical — faqat kengaytiriladi.
--   * candidates / articles ga faqat `add column if not exists` bilan ustun qo'shiladi.
--   * Qayta ishga tushirish xavfsiz.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Mavjud jadvallarni bog'lash uchun ustunlar (non-destructive)
-- ------------------------------------------------------------
alter table public.candidates
  add column if not exists source_intake_id uuid;

alter table public.articles
  add column if not exists source_intake_id uuid;

-- ------------------------------------------------------------
-- 1. Template va savollar (UI hech narsani hardcode qilmaydi)
-- ------------------------------------------------------------
create table if not exists public.candidate_intake_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  intro_text text not null default '',
  photo_stage_title text not null default '0-bosqich — Rasm',
  photo_stage_instruction text not null default '',
  footer_text text not null default '',
  is_active boolean not null default false,
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Faqat bitta faol template bo'lishi mumkin
create unique index if not exists uq_intake_template_active
  on public.candidate_intake_templates(is_active) where is_active = true;

drop trigger if exists trg_intake_templates_updated on public.candidate_intake_templates;
create trigger trg_intake_templates_updated
  before update on public.candidate_intake_templates
  for each row execute function public.set_updated_at();

create table if not exists public.candidate_intake_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.candidate_intake_templates(id) on delete cascade,
  question_no integer not null check (question_no >= 1),
  prompt text not null,
  help_text text,
  answer_type text not null default 'rich_text'
    check (answer_type in ('rich_text', 'short_text', 'contact')),
  is_required boolean not null default true,
  allow_no_answer boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (template_id, question_no)
);

create index if not exists idx_intake_questions_template
  on public.candidate_intake_questions(template_id, question_no);

-- ------------------------------------------------------------
-- 2. Intake (anketa qoralamasi) — ikkala usul uchun yagona jadval
-- ------------------------------------------------------------
create table if not exists public.candidate_intakes (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.candidate_intake_templates(id) on delete set null,

  intake_method text not null check (intake_method in ('manual', 'secure_link')),
  status text not null default 'draft'
    check (status in (
      'draft', 'submitted', 'ai_reviewing', 'needs_clarification',
      'approved', 'promoted', 'published', 'archived'
    )),

  -- Ism (savollardan oldin kiritiladi)
  first_name text not null default '',
  last_name text not null default '',
  father_name text not null default '',
  full_name text not null check (char_length(full_name) between 1 and 200),

  -- Progress
  current_question_no integer not null default 0,
  last_completed_question_no integer not null default 0,
  lock_version integer not null default 0,

  -- Yakuniy kontakt
  phone_e164 text,
  telegram_username text,

  -- Rozilik (to'liq IP saqlanmaydi — faqat bir tomonlama hash)
  consent_given boolean not null default false,
  consent_text_version text,
  consent_at timestamptz,
  consent_ip_hash text,

  -- Jaxongir AI global natijalari
  short_bio text,
  biography_draft text,
  global_fact_conflicts jsonb not null default '[]'::jsonb,
  editorial_commentary text,
  moderation_summary text,
  ai_ready_for_review boolean not null default false,

  -- Bog'lanishlar (promote/publish dan keyin)
  candidate_id uuid references public.candidates(id) on delete set null,
  article_id uuid references public.articles(id) on delete set null,

  assigned_admin uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,

  submitted_at timestamptz,
  approved_at timestamptz,
  promoted_at timestamptz,
  published_at timestamptz,
  last_autosave_at timestamptz,
  last_seen_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_intakes_status on public.candidate_intakes(status) where deleted_at is null;
create index if not exists idx_intakes_method on public.candidate_intakes(intake_method) where deleted_at is null;
create index if not exists idx_intakes_assigned on public.candidate_intakes(assigned_admin);
create index if not exists idx_intakes_candidate on public.candidate_intakes(candidate_id);

drop trigger if exists trg_intakes_updated on public.candidate_intakes;
create trigger trg_intakes_updated
  before update on public.candidate_intakes
  for each row execute function public.set_updated_at();

-- candidates.source_intake_id -> candidate_intakes FK (endi jadval mavjud)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'candidates_source_intake_fk'
  ) then
    alter table public.candidates
      add constraint candidates_source_intake_fk
      foreign key (source_intake_id) references public.candidate_intakes(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'articles_source_intake_fk'
  ) then
    alter table public.articles
      add constraint articles_source_intake_fk
      foreign key (source_intake_id) references public.candidate_intakes(id) on delete set null;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3. Xavfsiz havola tokenlari (xom token HECH QACHON saqlanmaydi)
--    token_hash = HMAC-SHA256(raw, CANDIDATE_LINK_SECRET) — app darajasida.
-- ------------------------------------------------------------
create table if not exists public.candidate_intake_links (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  token_prefix text not null,             -- ko'rsatish uchun xavfsiz prefiks (xom token emas)
  status text not null default 'active' check (status in ('active', 'used', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_intake_links_intake on public.candidate_intake_links(intake_id, status);
create index if not exists idx_intake_links_expires on public.candidate_intake_links(expires_at) where status = 'active';

-- ------------------------------------------------------------
-- 4. Javoblar (rich_content = TipTap JSON, plain_text = qidiruv/AI)
-- ------------------------------------------------------------
create table if not exists public.candidate_intake_answers (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  question_id uuid not null references public.candidate_intake_questions(id) on delete cascade,
  question_no integer not null,

  answer_state text not null default 'unanswered'
    check (answer_state in ('unanswered', 'answered', 'no_answer')),
  rich_content jsonb not null default '{}'::jsonb,
  plain_text text not null default '',

  -- Jaxongir AI natijalari (asl matn hech qachon ustidan yozilmaydi)
  ai_improved_text text,
  ai_removed_segments jsonb not null default '[]'::jsonb,
  ai_fact_flags jsonb not null default '[]'::jsonb,
  ai_clarification_questions jsonb not null default '[]'::jsonb,
  ai_moderation_notes jsonb not null default '[]'::jsonb,
  ai_confidence numeric,
  moderation_flagged boolean not null default false,

  -- Muharrir yakuniy varianti
  final_text text,
  final_rich_content jsonb,
  editor_state text not null default 'pending'
    check (editor_state in ('pending', 'accepted', 'partially_accepted', 'rejected', 'manual')),

  lock_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (intake_id, question_id)
);

create index if not exists idx_intake_answers_intake on public.candidate_intake_answers(intake_id, question_no);

drop trigger if exists trg_intake_answers_updated on public.candidate_intake_answers;
create trigger trg_intake_answers_updated
  before update on public.candidate_intake_answers
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. Javob revizyalari (har savoldan chiqishda + admin tahririda snapshot)
-- ------------------------------------------------------------
create table if not exists public.candidate_intake_answer_revisions (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  answer_id uuid references public.candidate_intake_answers(id) on delete set null,
  question_no integer not null,
  answer_state text not null,
  rich_content jsonb not null default '{}'::jsonb,
  plain_text text not null default '',
  source text not null default 'public' check (source in ('public', 'admin', 'ai', 'clarification')),
  edited_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_intake_answer_revs on public.candidate_intake_answer_revisions(answer_id, created_at desc);
create index if not exists idx_intake_answer_revs_intake on public.candidate_intake_answer_revisions(intake_id, created_at desc);

-- ------------------------------------------------------------
-- 6. "Jadvalga aylantirish" natijasi (TipTap table node yonida strukturaviy nusxa)
-- ------------------------------------------------------------
create table if not exists public.candidate_intake_answer_tables (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  answer_id uuid not null references public.candidate_intake_answers(id) on delete cascade,
  has_header boolean not null default true,
  table_data jsonb not null default '{"headers":[],"rows":[]}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_intake_answer_tables on public.candidate_intake_answer_tables(answer_id, sort_order);

-- ------------------------------------------------------------
-- 7. Attachmentlar (private bucket; original fayl nomi metadata sifatida)
-- ------------------------------------------------------------
create table if not exists public.candidate_intake_attachments (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  answer_id uuid references public.candidate_intake_answers(id) on delete set null,
  bucket text not null default 'candidate-intake-files',
  path text not null,
  file_name text not null,               -- ORIGINAL nom (metadata) — path ichida ishlatilmaydi
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  checksum_sha256 text,
  kind text not null default 'file'
    check (kind in ('image', 'video', 'audio', 'pdf', 'document', 'file', 'photo')),
  is_primary_photo boolean not null default false,
  status text not null default 'active' check (status in ('active', 'deleted')),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bucket, path)
);

create index if not exists idx_intake_attachments_intake on public.candidate_intake_attachments(intake_id) where status = 'active';
create index if not exists idx_intake_attachments_answer on public.candidate_intake_attachments(answer_id);
-- Bitta intake uchun faqat bitta asosiy (birlamchi) portret rasm
create unique index if not exists uq_intake_primary_photo
  on public.candidate_intake_attachments(intake_id)
  where is_primary_photo = true and status = 'active';

-- ------------------------------------------------------------
-- 8. AI yugurishlari (matn + rasm + moderatsiya audit)
-- ------------------------------------------------------------
create table if not exists public.candidate_intake_ai_runs (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  ai_job_id uuid references public.ai_jobs(id) on delete set null,
  kind text not null check (kind in (
    'improve_answer', 'improve_all', 'biography_draft',
    'fact_check', 'moderation', 'photo_edit'
  )),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  model text,
  idempotency_key text,
  input_summary jsonb not null default '{}'::jsonb,   -- sanitized (xom kalit/token yo'q)
  output jsonb,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (idempotency_key)
);

create index if not exists idx_intake_ai_runs_intake on public.candidate_intake_ai_runs(intake_id, created_at desc);

-- ------------------------------------------------------------
-- 9. Rasm tahrirlash joblari (OpenAI image edit)
-- ------------------------------------------------------------
create table if not exists public.candidate_intake_photo_edits (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  source_attachment_id uuid references public.candidate_intake_attachments(id) on delete set null,
  ai_run_id uuid references public.candidate_intake_ai_runs(id) on delete set null,
  prompt text not null,
  model text,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  result_bucket text,
  result_path text,
  is_selected boolean not null default false,
  error text,
  idempotency_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (idempotency_key)
);

create index if not exists idx_intake_photo_edits_intake on public.candidate_intake_photo_edits(intake_id, created_at desc);
-- Bitta intake uchun faqat bitta tanlangan qayta ishlangan rasm
create unique index if not exists uq_intake_selected_photo
  on public.candidate_intake_photo_edits(intake_id)
  where is_selected = true;

-- ------------------------------------------------------------
-- 10. Ko'rib chiqish / aniqlashtirish izohlari
-- ------------------------------------------------------------
create table if not exists public.candidate_intake_review_comments (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id) on delete cascade,
  answer_id uuid references public.candidate_intake_answers(id) on delete set null,
  question_no integer,
  kind text not null default 'note'
    check (kind in ('note', 'clarification', 'moderation', 'fact_conflict')),
  body text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_intake_review_comments on public.candidate_intake_review_comments(intake_id, status, created_at desc);

-- ============================================================
-- 11. Storage bucket (private) — anketa fayllari
-- ============================================================
insert into storage.buckets (id, name, public) values
  ('candidate-intake-files', 'candidate-intake-files', false)
on conflict (id) do update set public = excluded.public;

-- ============================================================
-- 12. RLS — barcha yangi jadvallarda yoqiladi.
--     Anon (ochiq forma) HECH QACHON to'g'ridan-to'g'ri yoza olmaydi:
--     public oqim faqat server route + service_role orqali ishlaydi.
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'candidate_intake_templates', 'candidate_intake_questions', 'candidate_intakes',
    'candidate_intake_links', 'candidate_intake_answers', 'candidate_intake_answer_revisions',
    'candidate_intake_answer_tables', 'candidate_intake_attachments',
    'candidate_intake_ai_runs', 'candidate_intake_photo_edits', 'candidate_intake_review_comments'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end;
$$;

-- Adminlar (intakes.view ruxsati) barcha intake jadvallarini o'qiy oladi.
do $$
declare
  t text;
begin
  foreach t in array array[
    'candidate_intake_templates', 'candidate_intake_questions', 'candidate_intakes',
    'candidate_intake_links', 'candidate_intake_answers', 'candidate_intake_answer_revisions',
    'candidate_intake_answer_tables', 'candidate_intake_attachments',
    'candidate_intake_ai_runs', 'candidate_intake_photo_edits', 'candidate_intake_review_comments'
  ]
  loop
    execute format('drop policy if exists "intake admins read" on public.%I;', t);
    execute format($f$
      create policy "intake admins read" on public.%I for select
      to authenticated using (public.has_permission('intakes.view'));
    $f$, t);
  end loop;
end;
$$;

-- Yozish: intakes.edit ruxsati (defense-in-depth; server service_role bilan ishlaydi).
-- ESLATMA: anon uchun HECH QANDAY policy yo'q => RLS uni bloklaydi.
do $$
declare
  t text;
begin
  foreach t in array array[
    'candidate_intakes', 'candidate_intake_answers', 'candidate_intake_answer_revisions',
    'candidate_intake_answer_tables', 'candidate_intake_attachments',
    'candidate_intake_photo_edits', 'candidate_intake_review_comments'
  ]
  loop
    execute format('drop policy if exists "intake writers" on public.%I;', t);
    execute format($f$
      create policy "intake writers" on public.%I for all
      to authenticated
      using (public.has_permission('intakes.edit'))
      with check (public.has_permission('intakes.edit'));
    $f$, t);
  end loop;
end;
$$;

-- Havolalar: yaratish/bekor qilish intakes.link ruxsatiga bog'liq
drop policy if exists "intake link managers" on public.candidate_intake_links;
create policy "intake link managers" on public.candidate_intake_links for all
  to authenticated
  using (public.has_permission('intakes.link'))
  with check (public.has_permission('intakes.link'));

-- Template/savollarni faqat sozlash ruxsatiga ega adminlar yozadi
drop policy if exists "intake template managers" on public.candidate_intake_templates;
create policy "intake template managers" on public.candidate_intake_templates for all
  to authenticated
  using (public.has_permission('intakes.edit'))
  with check (public.has_permission('intakes.edit'));

drop policy if exists "intake question managers" on public.candidate_intake_questions;
create policy "intake question managers" on public.candidate_intake_questions for all
  to authenticated
  using (public.has_permission('intakes.edit'))
  with check (public.has_permission('intakes.edit'));

-- Storage: candidate-intake-files private — faqat media.view/upload/delete
-- ruxsatiga ega adminlar (0008 dagi umumiy policy'lar bucket bo'yicha ishlaydi,
-- lekin "public buckets are readable" bu bucketni o'z ichiga olmaydi — to'g'ri).
-- Qo'shimcha aniq policy (idempotent):
drop policy if exists "intake files admin read" on storage.objects;
create policy "intake files admin read" on storage.objects for select
  to authenticated
  using (bucket_id = 'candidate-intake-files' and public.has_permission('intakes.view'));

-- ============================================================
-- 13. Ruxsatlar matritsasi (src/lib/permissions.ts nusxasi)
-- ============================================================
insert into public.role_permissions (role_slug, permission) values
  ('admin', 'intakes.view'), ('admin', 'intakes.create'), ('admin', 'intakes.edit'),
  ('admin', 'intakes.link'), ('admin', 'intakes.review'), ('admin', 'intakes.approve'),
  ('admin', 'intakes.promote'), ('admin', 'intakes.publish'),

  ('editor', 'intakes.view'), ('editor', 'intakes.create'), ('editor', 'intakes.edit'),
  ('editor', 'intakes.link'), ('editor', 'intakes.review'),

  ('moderator', 'intakes.view'), ('moderator', 'intakes.review'),

  ('analyst', 'intakes.view'),
  ('viewer', 'intakes.view')
on conflict do nothing;

-- ============================================================
-- 14. Sayt sozlamalari (promptlar, rozilik matni, limitlar)
-- ============================================================
insert into public.site_settings (key, value) values
  ('candidate_intake.default_photo_prompt',
   'Ushbu rasmni professional biografik portretga aylantiring. Yuz identifikatsiyasini, yoshini va shaxsiy xususiyatlarini AYNAN saqlang; yuzni almashtirmang. Bosh va yelka tik, kameraga to''g''ri qaragan. Neytral premium studiya foni (siklorama). Tabiiy teri teksturasi saqlansin, yuz ortiqcha silliqlanmasin. Ortiqcha predmetlarni olib tashlang. Tana nisbatlarini buzmang.'),
  ('candidate_intake.female_photo_prompt_addition',
   'Rasmiy, vazmin ayollar biznes kiyimi. Kiyim uslubi shaxsning roziligi va tanloviga mos bo''lsin; diniy yoki madaniy atributlar o''zboshimchalik bilan qo''shilmasin yoki olib tashlanmasin.'),
  ('candidate_intake.male_photo_prompt_addition',
   'Rasmiy erkaklar biznes kiyimi (kostyum yoki toza rasmiy ko''ylak). Kiyim uslubi shaxsning roziligi va tanloviga mos bo''lsin.'),
  ('candidate_intake.consent_text',
   'Men bergan ma''lumotlar to''g''ri ekanligini tasdiqlayman va ularning Liderlar.uz platformasida biografik maqola va brending maqsadida qayta ishlanishiga hamda nashr etilishiga roziman.'),
  ('candidate_intake.consent_version', 'v1'),
  ('candidate_intake.max_upload_mb', '25'),
  ('candidate_intake.link_ttl_days', '30')
on conflict (key) do nothing;

-- ============================================================
-- 15. Faol template + 15 ta biografik savol (idempotent seed)
-- ============================================================
do $$
declare
  v_template uuid;
begin
  select id into v_template
  from public.candidate_intake_templates where slug = 'liderlar-v2';

  if v_template is null then
    insert into public.candidate_intake_templates
      (slug, name, intro_text, photo_stage_title, photo_stage_instruction, footer_text, is_active, version)
    values (
      'liderlar-v2',
      'Liderlar.uz biografik anketa (V2)',
      'Iltimos, maqolaga asos bo''ladigan savollarga javob bering! Javoblar tartib raqami bilan ko''rsatiladi.',
      '0-bosqich — Rasm',
      'Maqola va brending ishlari uchun kameraga to''g''ri qaragan, rasmiy kiyingan sifatli rasmingizni yuboring.',
      'Liderlar.uz | Instagram | @uzlye_rasmiy',
      true,
      1
    )
    returning id into v_template;
  end if;

  -- Savollar (question_no unikal — on conflict do nothing => idempotent)
  insert into public.candidate_intake_questions
    (template_id, question_no, prompt, answer_type, is_required, allow_no_answer, sort_order)
  values
    (v_template, 1,  'To''liq ismingiz, familiyangiz va otangizning ismi?', 'rich_text', true, true, 1),
    (v_template, 2,  'Tug''ilgan yilingiz, kuni va joyingiz?', 'rich_text', true, true, 2),
    (v_template, 3,  'Hozirgi yashash joyingiz (viloyat/tuman/shahar)?', 'rich_text', true, true, 3),
    (v_template, 4,  'Ta''lim darajangiz va o''qigan o''quv yurtlaringiz?', 'rich_text', true, true, 4),
    (v_template, 5,  'Qaysi sohada faoliyat yuritasiz yoki o''qiyapsiz?', 'rich_text', true, true, 5),
    (v_template, 6,  'Faoliyatingizni qachondan va qanday boshlagansiz?', 'rich_text', true, true, 6),
    (v_template, 7,  'Erishgan muhim yutuqlaringiz (tanlovlar, sertifikatlar, loyihalar, mukofotlar)?', 'rich_text', true, true, 7),
    (v_template, 8,  'Hayotingizda sizga ta''sir qilgan biror shaxs yoki voqea bormi?', 'rich_text', true, true, 8),
    (v_template, 9,  'Sizni ilhomlantiradigan shior yoki hayotiy prinsipingiz qanday?', 'rich_text', true, true, 9),
    (v_template, 10, 'Bo''sh vaqtingizda nima bilan shug''ullanasiz?', 'rich_text', true, true, 10),
    (v_template, 11, 'Sizningcha, lider bo''lish uchun eng muhim fazilat nima?', 'rich_text', true, true, 11),
    (v_template, 12, 'Kelajakdagi rejalaringiz va orzu-maqsadlaringiz nimalardan iborat?', 'rich_text', true, true, 12),
    (v_template, 13, 'Sizdan boshqalar nimani o''rganishlari mumkin deb o''ylaysiz?', 'rich_text', true, true, 13),
    (v_template, 14, 'O''zingiz haqingizda yana qanday qiziqarli yoki muhim ma''lumot bo''lishi mumkin?', 'rich_text', true, true, 14),
    (v_template, 15, 'Boshqa yoshlar uchun qanday maslahat yoki motivatsion fikr bildirasiz?', 'rich_text', true, true, 15)
  on conflict (template_id, question_no) do nothing;
end;
$$;

-- ============================================================
-- 16. RPC: progress hisoblash
-- ============================================================
create or replace function public.intake_progress(p_intake uuid)
returns table (total integer, answered integer, required_total integer, required_answered integer)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select cq.id, cq.is_required
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
    count(*) filter (where q.is_required)::int as required_total,
    count(*) filter (
      where q.is_required and exists (
        select 1 from a where a.question_id = q.id
          and (a.answer_state = 'no_answer'
               or (a.answer_state = 'answered' and char_length(trim(a.plain_text)) > 0))
      )
    )::int as required_answered
  from q;
$$;

-- ============================================================
-- 17. RPC: anketani yuborishdan oldingi validatsiya + holat o'tkazish
--     Xato bo'lsa jsonb {ok:false, errors:[...]} qaytaradi (exception emas).
-- ============================================================
create or replace function public.submit_candidate_intake(
  p_intake uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake record;
  v_errors text[] := '{}';
  v_prog record;
  v_missing integer;
begin
  select * into v_intake from public.candidate_intakes where id = p_intake and deleted_at is null;
  if v_intake.id is null then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Anketa topilmadi'));
  end if;

  if v_intake.status not in ('draft', 'needs_clarification') then
    return jsonb_build_object('ok', false,
      'errors', jsonb_build_array('Anketa allaqachon yuborilgan yoki ko''rib chiqilmoqda'));
  end if;

  -- Barcha majburiy savollarga javob berilganmi?
  select * into v_prog from public.intake_progress(p_intake);
  v_missing := coalesce(v_prog.required_total, 0) - coalesce(v_prog.required_answered, 0);
  if v_missing > 0 then
    v_errors := array_append(v_errors, format('%s ta majburiy savol javobsiz qolgan', v_missing));
  end if;

  -- Kontakt
  if v_intake.phone_e164 is null or v_intake.phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    v_errors := array_append(v_errors, 'To''g''ri telefon raqami (E.164) kiritilishi shart');
  end if;
  if v_intake.telegram_username is null or v_intake.telegram_username !~ '^@[A-Za-z0-9_]{5,32}$' then
    v_errors := array_append(v_errors, 'To''g''ri Telegram username kiritilishi shart');
  end if;

  -- Rozilik
  if v_intake.consent_given is not true then
    v_errors := array_append(v_errors, 'Rozilik berilishi shart');
  end if;

  if array_length(v_errors, 1) is not null then
    return jsonb_build_object('ok', false, 'errors', to_jsonb(v_errors));
  end if;

  update public.candidate_intakes
  set status = 'submitted', submitted_at = now()
  where id = p_intake;

  return jsonb_build_object('ok', true, 'intake_id', p_intake,
    'progress', jsonb_build_object('total', v_prog.total, 'answered', v_prog.answered));
end;
$$;

-- ============================================================
-- 18. RPC: anketani nomzodga aylantirish (va ixtiyoriy nashr)
--     p_publish=false  -> candidate/article DRAFT yaratadi, intake='promoted'
--     p_publish=true   -> nashr etadi, intake='published'
--     Rasm serverda candidate-avatars ga ko'chirilib, p_avatar_url beriladi.
-- ============================================================
create or replace function public.promote_candidate_intake(
  p_intake uuid,
  p_actor uuid default null,
  p_publish boolean default false,
  p_avatar_url text default null,
  p_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake record;
  v_candidate uuid;
  v_article uuid;
  v_slug text;
  v_article_slug text;
begin
  select * into v_intake from public.candidate_intakes where id = p_intake and deleted_at is null;
  if v_intake.id is null then
    raise exception 'Anketa topilmadi';
  end if;

  if p_publish then
    if v_intake.status not in ('approved', 'promoted') then
      raise exception 'Nashr etish uchun anketa avval tasdiqlangan bo''lishi kerak';
    end if;
  else
    if v_intake.status <> 'approved' then
      raise exception 'Nomzodga aylantirish uchun anketa "approved" holatida bo''lishi kerak';
    end if;
  end if;

  -- --- Slug (server slugify natijasi afzal; bo'lmasa oddiy ASCII) ---
  v_slug := nullif(regexp_replace(lower(coalesce(p_slug, v_intake.full_name)), '[^a-z0-9]+', '-', 'g'), '');
  v_slug := trim(both '-' from coalesce(v_slug, 'nomzod'));
  if v_slug = '' then v_slug := 'nomzod'; end if;

  -- --- Candidate (yaratish yoki yangilash) ---
  v_candidate := v_intake.candidate_id;
  if v_candidate is null then
    -- slug bandligini tekshirib, kerak bo'lsa qisqa suffiks qo'shamiz
    if exists (select 1 from public.candidates where slug = v_slug and deleted_at is null) then
      v_slug := v_slug || '-' || substr(md5(p_intake::text), 1, 5);
    end if;
    insert into public.candidates
      (slug, full_name, short_bio, avatar_url, phone, status, source_intake_id, user_id)
    values (
      v_slug,
      v_intake.full_name,
      nullif(left(coalesce(v_intake.short_bio, ''), 600), ''),
      p_avatar_url,
      v_intake.phone_e164,
      'draft',
      p_intake,
      null
    )
    returning id into v_candidate;
  else
    update public.candidates
    set avatar_url = coalesce(p_avatar_url, avatar_url),
        phone = coalesce(v_intake.phone_e164, phone),
        short_bio = coalesce(nullif(left(coalesce(v_intake.short_bio, ''), 600), ''), short_bio),
        source_intake_id = p_intake
    where id = v_candidate;
  end if;

  -- --- Article (biografik maqola draft) ---
  v_article := v_intake.article_id;
  v_article_slug := trim(both '-' from (v_slug || '-biografiya'));
  if v_article is null then
    if exists (select 1 from public.articles where slug = v_article_slug and deleted_at is null) then
      v_article_slug := v_article_slug || '-' || substr(md5(p_intake::text), 1, 5);
    end if;
    insert into public.articles
      (candidate_id, title, slug, excerpt, content, status, source_intake_id, created_by)
    values (
      v_candidate,
      v_intake.full_name,
      v_article_slug,
      nullif(left(coalesce(v_intake.short_bio, ''), 300), ''),
      coalesce(v_intake.biography_draft, ''),
      'draft',
      p_intake,
      p_actor
    )
    returning id into v_article;
  else
    update public.articles
    set candidate_id = v_candidate,
        content = coalesce(v_intake.biography_draft, content),
        excerpt = coalesce(nullif(left(coalesce(v_intake.short_bio, ''), 300), ''), excerpt),
        source_intake_id = p_intake
    where id = v_article;
  end if;

  -- --- Tasdiqlangan (birlamchi bo'lmagan) attachmentlarni media reyestriga qo'shish ---
  insert into public.candidate_media
    (bucket, path, file_name, mime_type, size_bytes, candidate_id, kind, uploaded_by)
  select a.bucket, a.path, a.file_name, a.mime_type, a.size_bytes, v_candidate,
         'intake-' || a.kind, a.uploaded_by
  from public.candidate_intake_attachments a
  where a.intake_id = p_intake and a.status = 'active' and a.is_primary_photo = false
  on conflict (bucket, path) do nothing;

  -- --- Holatlar ---
  if p_publish then
    update public.candidates
    set status = 'published',
        next_update_due_at = coalesce(next_update_due_at, now() + interval '30 days')
    where id = v_candidate;
    update public.articles
    set status = 'published', published_at = coalesce(published_at, now())
    where id = v_article;
    update public.candidate_intakes
    set candidate_id = v_candidate, article_id = v_article,
        status = 'published', published_at = now(),
        promoted_at = coalesce(promoted_at, now())
    where id = p_intake;
  else
    update public.candidate_intakes
    set candidate_id = v_candidate, article_id = v_article,
        status = 'promoted', promoted_at = now()
    where id = p_intake;
  end if;

  perform public.write_audit_log(
    p_actor,
    case when p_publish then 'intake.publish' else 'intake.promote' end,
    'candidate_intake', p_intake::text, null,
    jsonb_build_object('candidate_id', v_candidate, 'article_id', v_article, 'published', p_publish),
    null, case when p_publish then 'warning' else 'info' end
  );

  return jsonb_build_object(
    'candidate_id', v_candidate,
    'article_id', v_article,
    'candidate_slug', v_slug,
    'published', p_publish
  );
end;
$$;

-- Bu RPC'lar FAQAT server (service_role) yoki autentifikatsiyalangan admin
-- tomonidan chaqiriladi — anon uchun grant BERILMAYDI (ochiq oqim server route orqali).
grant execute on function public.intake_progress(uuid) to authenticated, service_role;
grant execute on function public.submit_candidate_intake(uuid, uuid) to authenticated, service_role;
grant execute on function public.promote_candidate_intake(uuid, uuid, boolean, text, text) to authenticated, service_role;

