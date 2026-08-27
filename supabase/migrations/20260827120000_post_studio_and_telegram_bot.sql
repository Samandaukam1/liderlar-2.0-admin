-- ============================================================
-- Post Studio: 1080x1080 ijtimoiy tarmoq postlari + Telegram
-- shaxsiy yetkazib beruvchi bot (kanal emas).
--
-- Mavjud jadvallar tekshirildi: candidates, articles, quotes,
-- candidate_intakes, audit_logs allaqachon bor va o'zgartirilmaydi.
-- Bu yerda faqat yangi jadvallar yaratiladi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. candidate_social_posts
-- ------------------------------------------------------------
create table if not exists public.candidate_social_posts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  article_id uuid references public.articles(id) on delete set null,
  template_id text not null default 'template-01'
    check (template_id in ('template-01','template-02','template-03',
                           'template-04','template-05','template-06')),

  quote text not null default '',
  quote_source text check (quote_source in
    ('featured_quote','article_quote','life_motto','manual','none')),
  name_lines jsonb not null default '[]'::jsonb,
  short_bio_items jsonb not null default '[]'::jsonb,

  portrait_source_url text,
  portrait_processed_url text,
  portrait_transform jsonb not null default
    '{"offsetX":0,"offsetY":0,"scale":1,"flip":false}'::jsonb,

  font_size_overrides jsonb not null default '{}'::jsonb,

  rendered_image_url text,
  rendered_thumbnail_url text,
  rendered_at timestamptz,

  telegram_caption text,
  -- Shaxsiy yetkazib berishda bitta message_id bo'lmaydi; batafsil natija
  -- telegram_post_deliveries jadvalida. Bu ustun oxirgi yuborish xulosasi.
  telegram_last_sent_at timestamptz,
  telegram_sent_count integer not null default 0,
  telegram_failed_count integer not null default 0,

  status text not null default 'draft'
    check (status in ('draft','rendering','ready','approved','scheduled',
                      'published','failed','needs_review')),
  scheduled_at timestamptz,
  published_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_social_posts_candidate
  on public.candidate_social_posts(candidate_id);
create index if not exists idx_social_posts_article
  on public.candidate_social_posts(article_id);
create index if not exists idx_social_posts_status
  on public.candidate_social_posts(status);
create index if not exists idx_social_posts_scheduled
  on public.candidate_social_posts(scheduled_at)
  where status = 'scheduled';
create index if not exists idx_social_posts_created
  on public.candidate_social_posts(created_at desc);

-- Bitta nomzodga bitta faol post (qayta yaratishni oldini oladi).
create unique index if not exists uq_social_posts_candidate_active
  on public.candidate_social_posts(candidate_id)
  where status <> 'failed';

drop trigger if exists trg_social_posts_updated on public.candidate_social_posts;
create trigger trg_social_posts_updated
  before update on public.candidate_social_posts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. telegram_post_subscribers
--    Bot kanalga admin qilinmaydi; foydalanuvchilar /start orqali
--    o'zlari obuna bo'ladi va postlar shaxsiy chatga yuboriladi.
-- ------------------------------------------------------------
create table if not exists public.telegram_post_subscribers (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  chat_id bigint not null unique,
  username text,
  first_name text,
  last_name text,
  language_code text,
  is_active boolean not null default true,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tg_subscribers_active
  on public.telegram_post_subscribers(is_active) where is_active = true;

drop trigger if exists trg_tg_subscribers_updated on public.telegram_post_subscribers;
create trigger trg_tg_subscribers_updated
  before update on public.telegram_post_subscribers
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. telegram_post_deliveries — har yuborish natijasi
-- ------------------------------------------------------------
create table if not exists public.telegram_post_deliveries (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.candidate_social_posts(id) on delete cascade,
  subscriber_id uuid not null references public.telegram_post_subscribers(id) on delete cascade,
  telegram_message_id bigint,
  status text not null check (status in ('sent','failed','skipped')),
  error text,
  sent_at timestamptz not null default now()
);

-- Duplicate himoyasi: bitta post bitta obunachiga faqat bir marta
-- muvaffaqiyatli ketadi. Xato yozuvlar qayta urinishga to'sqinlik qilmaydi.
create unique index if not exists uq_tg_delivery_once
  on public.telegram_post_deliveries(post_id, subscriber_id)
  where status = 'sent';

create index if not exists idx_tg_delivery_post
  on public.telegram_post_deliveries(post_id, status);
create index if not exists idx_tg_delivery_subscriber
  on public.telegram_post_deliveries(subscriber_id, sent_at desc);

-- ------------------------------------------------------------
-- 4. Storage bucket — post assetlari (public read, admin write)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('candidate-post-assets', 'candidate-post-assets', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "post assets are public readable" on storage.objects;
create policy "post assets are public readable"
  on storage.objects for select
  using (bucket_id = 'candidate-post-assets');

-- ------------------------------------------------------------
-- 5. RLS — public client hech qachon to'g'ridan-to'g'ri yoza olmaydi.
--    Barcha yozuv server route + service_role orqali.
-- ------------------------------------------------------------
alter table public.candidate_social_posts enable row level security;
alter table public.telegram_post_subscribers enable row level security;
alter table public.telegram_post_deliveries enable row level security;

drop policy if exists "post studio admins read" on public.candidate_social_posts;
create policy "post studio admins read"
  on public.candidate_social_posts for select
  to authenticated
  using (public.has_permission('posts.view'));

drop policy if exists "post studio admins write" on public.candidate_social_posts;
create policy "post studio admins write"
  on public.candidate_social_posts for all
  to authenticated
  using (public.has_permission('posts.manage'))
  with check (public.has_permission('posts.manage'));

drop policy if exists "tg subscribers admins read" on public.telegram_post_subscribers;
create policy "tg subscribers admins read"
  on public.telegram_post_subscribers for select
  to authenticated
  using (public.has_permission('posts.view'));

drop policy if exists "tg deliveries admins read" on public.telegram_post_deliveries;
create policy "tg deliveries admins read"
  on public.telegram_post_deliveries for select
  to authenticated
  using (public.has_permission('posts.view'));

-- ------------------------------------------------------------
-- 6. Ruxsatlar — src/lib/permissions.ts matritsasining SQL nusxasi
-- ------------------------------------------------------------
-- super_admin allaqachon '*' ga ega, shuning uchun bu yerda sanalmaydi.
insert into public.role_permissions (role_slug, permission) values
  ('admin', 'posts.view'),
  ('admin', 'posts.manage'),
  ('admin', 'posts.publish'),
  ('editor', 'posts.view'),
  ('editor', 'posts.manage'),
  ('moderator', 'posts.view'),
  ('analyst', 'posts.view'),
  ('viewer', 'posts.view')
on conflict do nothing;

-- ------------------------------------------------------------
-- 7. 2 soatlik avtomatik pipeline holati
--    Anketa yuborilgandan keyin +2 soat kutiladi. Browser setTimeout
--    yoki ochiq Vercel request ishlatilmaydi: process_after ustuni
--    to'ldiriladi va Vercel Cron uni davriy tekshiradi.
-- ------------------------------------------------------------
alter table public.candidate_intakes
  add column if not exists post_pipeline_status text
    check (post_pipeline_status is null or post_pipeline_status in
      ('pending','running','completed','failed','needs_review','skipped')),
  add column if not exists post_pipeline_process_after timestamptz,
  add column if not exists post_pipeline_started_at timestamptz,
  add column if not exists post_pipeline_finished_at timestamptz,
  add column if not exists post_pipeline_error text,
  add column if not exists post_pipeline_attempts integer not null default 0;

create index if not exists idx_intake_pipeline_due
  on public.candidate_intakes(post_pipeline_process_after)
  where post_pipeline_status in ('pending','failed');

-- submitted_at qo'yilganda process_after = submitted_at + 2 soat.
create or replace function public.set_post_pipeline_schedule()
returns trigger
language plpgsql
as $$
begin
  if new.submitted_at is not null
     and (old.submitted_at is null or old.submitted_at is distinct from new.submitted_at)
  then
    new.post_pipeline_process_after := new.submitted_at + interval '2 hours';
    if new.post_pipeline_status is null then
      new.post_pipeline_status := 'pending';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_intake_pipeline_schedule on public.candidate_intakes;
create trigger trg_intake_pipeline_schedule
  before update on public.candidate_intakes
  for each row execute function public.set_post_pipeline_schedule();

-- Allaqachon yuborilgan anketalar uchun ham rejani to'ldiramiz.
update public.candidate_intakes
set post_pipeline_process_after = submitted_at + interval '2 hours',
    post_pipeline_status = coalesce(post_pipeline_status, 'pending')
where submitted_at is not null
  and post_pipeline_process_after is null;

-- ------------------------------------------------------------
-- 8. Telegram caption sozlamalari (hardcode qilinmaydi)
-- ------------------------------------------------------------
insert into public.site_settings (key, value) values
  ('telegram_bot.application_url', 'https://liderlar.uz/ariza'),
  ('telegram_bot.instagram_url', 'https://instagram.com/liderlar.uz'),
  ('telegram_bot.username', 'liderlaruz')
on conflict (key) do nothing;
