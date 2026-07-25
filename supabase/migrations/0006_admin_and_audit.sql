-- ============================================================
-- Liderlar.uz 2.0 — 0006: Admin & audit
-- audit_logs va rol → ruxsat matritsasi
-- ============================================================

-- ---------- audit_logs ----------
-- Maxfiy kalit, parol yoki xom token bu jadvalga yozilmaydi
-- (app darajasida sanitizeForAudit + quyidagi check).
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_actor on public.audit_logs(actor_id);

-- ---------- role_permissions ----------
-- src/lib/permissions.ts dagi ROLE_PERMISSIONS matritsasining SQL nusxasi.
-- Server action va RLS bir xil manbaga tayanishi uchun.
create table if not exists public.role_permissions (
  role_slug text not null references public.roles(slug) on delete cascade,
  permission text not null,
  primary key (role_slug, permission)
);

-- super_admin uchun '*' — barcha ruxsatlar
insert into public.role_permissions (role_slug, permission) values
  ('super_admin', '*'),

  ('admin', 'dashboard.view'), ('admin', 'candidates.view'), ('admin', 'candidates.create'),
  ('admin', 'candidates.edit'), ('admin', 'candidates.publish'), ('admin', 'candidates.archive'),
  ('admin', 'articles.view'), ('admin', 'articles.create'), ('admin', 'articles.edit'),
  ('admin', 'articles.submit'), ('admin', 'articles.publish'),
  ('admin', 'updates.view'), ('admin', 'updates.review'), ('admin', 'updates.merge'),
  ('admin', 'tokens.view'), ('admin', 'tokens.manage'),
  ('admin', 'rankings.view'), ('admin', 'rankings.manage'), ('admin', 'rankings.adjust'),
  ('admin', 'podcasts.view'), ('admin', 'podcasts.manage'),
  ('admin', 'journals.view'), ('admin', 'journals.manage'),
  ('admin', 'quotes.view'), ('admin', 'quotes.manage'),
  ('admin', 'top100.view'), ('admin', 'top100.manage'),
  ('admin', 'taxonomy.view'), ('admin', 'taxonomy.manage'),
  ('admin', 'applications.view'), ('admin', 'applications.review'), ('admin', 'applications.convert'),
  ('admin', 'media.view'), ('admin', 'media.upload'), ('admin', 'media.delete'),
  ('admin', 'ai.use'), ('admin', 'notifications.view'), ('admin', 'notifications.manage'),
  ('admin', 'audit.view'), ('admin', 'legal.manage'), ('admin', 'import.run'), ('admin', 'export.run'),

  ('editor', 'dashboard.view'), ('editor', 'candidates.view'),
  ('editor', 'articles.view'), ('editor', 'articles.create'), ('editor', 'articles.edit'),
  ('editor', 'articles.submit'), ('editor', 'quotes.view'), ('editor', 'journals.view'),
  ('editor', 'media.view'), ('editor', 'media.upload'), ('editor', 'ai.use'),

  ('moderator', 'dashboard.view'), ('moderator', 'candidates.view'),
  ('moderator', 'updates.view'), ('moderator', 'updates.review'), ('moderator', 'tokens.view'),
  ('moderator', 'applications.view'), ('moderator', 'applications.review'),
  ('moderator', 'media.view'), ('moderator', 'media.upload'), ('moderator', 'notifications.view'),

  ('analyst', 'dashboard.view'), ('analyst', 'candidates.view'), ('analyst', 'rankings.view'),
  ('analyst', 'articles.view'), ('analyst', 'podcasts.view'), ('analyst', 'journals.view'),
  ('analyst', 'applications.view'), ('analyst', 'export.run'),

  ('viewer', 'dashboard.view'), ('viewer', 'candidates.view'), ('viewer', 'articles.view'),
  ('viewer', 'updates.view'), ('viewer', 'tokens.view'), ('viewer', 'rankings.view'),
  ('viewer', 'podcasts.view'), ('viewer', 'journals.view'), ('viewer', 'quotes.view'),
  ('viewer', 'top100.view'), ('viewer', 'taxonomy.view'), ('viewer', 'applications.view'),
  ('viewer', 'media.view'), ('viewer', 'notifications.view')
on conflict do nothing;
