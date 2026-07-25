-- ============================================================
-- Liderlar.uz 2.0 — 0008: Storage bucketlar va RLS
-- ============================================================

-- ============ Ruxsat funksiyalari (policy'lar uchun) ============

-- Foydalanuvchi kamida bitta admin-panel roliga egami?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and p.is_active = true
  );
$$;

-- Berilgan rollardan biriga egami?
create or replace function public.has_any_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and p.is_active = true
      and r.slug = any (p_roles)
  );
$$;

-- role_permissions matritsasi bo'yicha aniq ruxsat tekshiruvi
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.role_permissions rp on rp.role_slug = r.slug
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and p.is_active = true
      and (rp.permission = p_permission or rp.permission = '*')
  );
$$;

-- ============ Storage bucketlar ============

insert into storage.buckets (id, name, public) values
  ('candidate-avatars', 'candidate-avatars', true),
  ('candidate-gallery', 'candidate-gallery', true),
  ('monthly-update-media', 'monthly-update-media', false),
  ('journal-covers', 'journal-covers', true),
  ('journal-pdfs', 'journal-pdfs', false),
  ('podcast-media', 'podcast-media', true),
  ('application-files', 'application-files', false),
  ('admin-private-files', 'admin-private-files', false)
on conflict (id) do update set public = excluded.public;

-- Storage policy'lar
drop policy if exists "public buckets are readable" on storage.objects;
create policy "public buckets are readable"
  on storage.objects for select
  using (bucket_id in ('candidate-avatars', 'candidate-gallery', 'journal-covers', 'podcast-media'));

drop policy if exists "admins read all buckets" on storage.objects;
create policy "admins read all buckets"
  on storage.objects for select
  to authenticated
  using (public.has_permission('media.view'));

drop policy if exists "admins upload media" on storage.objects;
create policy "admins upload media"
  on storage.objects for insert
  to authenticated
  with check (public.has_permission('media.upload'));

drop policy if exists "admins delete media" on storage.objects;
create policy "admins delete media"
  on storage.objects for delete
  to authenticated
  using (public.has_permission('media.delete'));

-- ============ RLS: barcha jadvallarda yoqiladi ============

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'roles', 'user_roles', 'role_permissions', 'regions', 'categories',
    'candidates', 'education', 'work_experiences', 'achievements', 'events',
    'books_read', 'social_links', 'candidate_media', 'articles', 'article_revisions',
    'podcasts', 'podcast_guests', 'journals', 'journal_articles', 'quotes',
    'applications', 'application_files', 'application_notes', 'legal_pages',
    'site_settings', 'ranking_categories', 'ranking_periods', 'ranking_weights',
    'ranking_events', 'ranking_scores', 'ranking_adjustments', 'profile_views',
    'monthly_update_tokens', 'monthly_updates', 'monthly_update_items',
    'monthly_update_media', 'audit_logs', 'ai_jobs', 'ai_chat_sessions',
    'ai_chat_messages', 'notifications'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end;
$$;

-- ============ Ochiq sayt (anon) o'qish policy'lari ============

drop policy if exists "taxonomy readable by all" on public.regions;
create policy "taxonomy readable by all" on public.regions for select using (true);

drop policy if exists "categories readable by all" on public.categories;
create policy "categories readable by all" on public.categories for select using (true);

drop policy if exists "published candidates are public" on public.candidates;
create policy "published candidates are public"
  on public.candidates for select
  using (status = 'published' and deleted_at is null);

-- Nomzod bo'limlari: faqat nashr etilgan nomzodniki ochiq
do $$
declare
  t text;
begin
  foreach t in array array[
    'education', 'work_experiences', 'achievements', 'events', 'books_read', 'social_links'
  ]
  loop
    execute format('drop policy if exists "public candidate sections" on public.%I;', t);
    execute format($f$
      create policy "public candidate sections" on public.%I for select
      using (exists (
        select 1 from public.candidates c
        where c.id = %I.candidate_id and c.status = 'published' and c.deleted_at is null
      ));
    $f$, t, t);
  end loop;
end;
$$;

drop policy if exists "published articles are public" on public.articles;
create policy "published articles are public"
  on public.articles for select
  using (status = 'published' and deleted_at is null);

drop policy if exists "announced podcasts are public" on public.podcasts;
create policy "announced podcasts are public"
  on public.podcasts for select
  using (status in ('announced', 'live', 'recorded', 'published'));

drop policy if exists "published journals are public" on public.journals;
create policy "published journals are public"
  on public.journals for select
  using (status = 'published');

drop policy if exists "journal articles of published journals" on public.journal_articles;
create policy "journal articles of published journals"
  on public.journal_articles for select
  using (exists (
    select 1 from public.journals j
    where j.id = journal_articles.journal_id and j.status = 'published'
  ));

drop policy if exists "published quotes are public" on public.quotes;
create policy "published quotes are public"
  on public.quotes for select
  using (status = 'published');

drop policy if exists "published rankings are public" on public.ranking_scores;
create policy "published rankings are public"
  on public.ranking_scores for select
  using (
    is_current = true
    and exists (
      select 1 from public.ranking_periods p
      where p.id = ranking_scores.period_id and p.published_at is not null
    )
  );

drop policy if exists "legal pages are public" on public.legal_pages;
create policy "legal pages are public" on public.legal_pages for select using (true);

drop policy if exists "site settings are public" on public.site_settings;
create policy "site settings are public" on public.site_settings for select using (true);

drop policy if exists "ranking categories are public" on public.ranking_categories;
create policy "ranking categories are public" on public.ranking_categories for select using (true);

-- Sayt ariza topshirishi mumkin (faqat insert, o'qiy olmaydi)
drop policy if exists "anyone can submit application" on public.applications;
create policy "anyone can submit application"
  on public.applications for insert
  with check (status = 'new' and assignee_id is null and candidate_id is null);

-- ============ Admin panel policy'lari ============

-- Profiles: har kim o'z profilini, adminlar hammasini ko'radi
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select
  to authenticated using (id = auth.uid());

drop policy if exists "admins read profiles" on public.profiles;
create policy "admins read profiles" on public.profiles for select
  to authenticated using (public.is_admin());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update
  to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Roles / user_roles / role_permissions: adminlar o'qiydi
drop policy if exists "admins read roles" on public.roles;
create policy "admins read roles" on public.roles for select
  to authenticated using (public.is_admin());

drop policy if exists "admins read user_roles" on public.user_roles;
create policy "admins read user_roles" on public.user_roles for select
  to authenticated using (public.is_admin());

drop policy if exists "admins read role_permissions" on public.role_permissions;
create policy "admins read role_permissions" on public.role_permissions for select
  to authenticated using (public.is_admin());

-- Adminlar uchun kengaytirilgan o'qish (draft'lar bilan birga)
do $$
declare
  t text;
begin
  foreach t in array array[
    'candidates', 'education', 'work_experiences', 'achievements', 'events',
    'books_read', 'social_links', 'candidate_media', 'articles', 'article_revisions',
    'podcasts', 'podcast_guests', 'journals', 'journal_articles', 'quotes',
    'applications', 'application_files', 'application_notes',
    'ranking_periods', 'ranking_weights', 'ranking_events', 'ranking_scores',
    'ranking_adjustments', 'profile_views'
  ]
  loop
    execute format('drop policy if exists "admins read all" on public.%I;', t);
    execute format($f$
      create policy "admins read all" on public.%I for select
      to authenticated using (public.is_admin());
    $f$, t);
  end loop;
end;
$$;

-- Yozish policy'lari: aniq permission bilan (defense in depth;
-- server service_role bilan ishlaydi, bu qatlam qo'shimcha himoya)
drop policy if exists "candidate writers" on public.candidates;
create policy "candidate writers" on public.candidates for all
  to authenticated
  using (public.has_permission('candidates.edit'))
  with check (public.has_permission('candidates.edit'));

drop policy if exists "article writers" on public.articles;
create policy "article writers" on public.articles for all
  to authenticated
  using (public.has_permission('articles.edit'))
  with check (public.has_permission('articles.edit'));

drop policy if exists "content managers write podcasts" on public.podcasts;
create policy "content managers write podcasts" on public.podcasts for all
  to authenticated
  using (public.has_permission('podcasts.manage'))
  with check (public.has_permission('podcasts.manage'));

drop policy if exists "content managers write journals" on public.journals;
create policy "content managers write journals" on public.journals for all
  to authenticated
  using (public.has_permission('journals.manage'))
  with check (public.has_permission('journals.manage'));

drop policy if exists "content managers write quotes" on public.quotes;
create policy "content managers write quotes" on public.quotes for all
  to authenticated
  using (public.has_permission('quotes.manage'))
  with check (public.has_permission('quotes.manage'));

drop policy if exists "taxonomy managers write categories" on public.categories;
create policy "taxonomy managers write categories" on public.categories for all
  to authenticated
  using (public.has_permission('taxonomy.manage'))
  with check (public.has_permission('taxonomy.manage'));

drop policy if exists "taxonomy managers write regions" on public.regions;
create policy "taxonomy managers write regions" on public.regions for all
  to authenticated
  using (public.has_permission('taxonomy.manage'))
  with check (public.has_permission('taxonomy.manage'));

-- Maxfiy jadvallar: faqat tegishli permission bilan o'qish
drop policy if exists "token viewers" on public.monthly_update_tokens;
create policy "token viewers" on public.monthly_update_tokens for select
  to authenticated using (public.has_permission('tokens.view'));

drop policy if exists "update viewers" on public.monthly_updates;
create policy "update viewers" on public.monthly_updates for select
  to authenticated using (public.has_permission('updates.view'));

drop policy if exists "update item viewers" on public.monthly_update_items;
create policy "update item viewers" on public.monthly_update_items for select
  to authenticated using (public.has_permission('updates.view'));

drop policy if exists "update media viewers" on public.monthly_update_media;
create policy "update media viewers" on public.monthly_update_media for select
  to authenticated using (public.has_permission('updates.view'));

drop policy if exists "audit viewers" on public.audit_logs;
create policy "audit viewers" on public.audit_logs for select
  to authenticated using (public.has_permission('audit.view'));

drop policy if exists "ai job viewers" on public.ai_jobs;
create policy "ai job viewers" on public.ai_jobs for select
  to authenticated using (public.has_permission('ai.use'));

drop policy if exists "own ai chat sessions" on public.ai_chat_sessions;
create policy "own ai chat sessions" on public.ai_chat_sessions for all
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "own ai chat messages" on public.ai_chat_messages;
create policy "own ai chat messages" on public.ai_chat_messages for all
  to authenticated
  using (exists (
    select 1 from public.ai_chat_sessions s
    where s.id = ai_chat_messages.session_id and s.created_by = auth.uid()
  ))
  with check (exists (
    select 1 from public.ai_chat_sessions s
    where s.id = ai_chat_messages.session_id and s.created_by = auth.uid()
  ));

-- Bildirishnomalar: o'zinikini yoki umumiy e'lonlarni ko'radi
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications for select
  to authenticated
  using (recipient_id = auth.uid() or (recipient_id is null and public.is_admin()));

drop policy if exists "mark own notifications read" on public.notifications;
create policy "mark own notifications read" on public.notifications for update
  to authenticated
  using (recipient_id = auth.uid() or (recipient_id is null and public.is_admin()))
  with check (recipient_id = auth.uid() or (recipient_id is null and public.is_admin()));

-- ESLATMA: service_role RLS'ni chetlab o'tadi va FAQAT serverda ishlatiladi
-- (src/lib/supabase/admin.ts — "server-only" import bilan himoyalangan).
