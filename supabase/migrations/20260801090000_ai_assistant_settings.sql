-- ============================================================
-- Liderlar.uz 2.0 — AI Assistant (Jaxongir AI floating widget)
-- Admin-configurable appearance/behaviour for the user-panel widget:
-- avatar, animation toggles, greeting, quick questions. Single row,
-- publicly readable (RLS), writable only via the service-role admin
-- client after requirePermission('ai_assistant.manage'). Idempotent.
-- ============================================================

create table if not exists public.ai_assistant_settings (
  id boolean primary key default true,
  assistant_name text not null default 'Jaxongir AI'
    check (char_length(assistant_name) between 1 and 60),
  greeting text not null default
    'Salom! Men Jaxongir AI — Liderlar.uz bo''yicha savollaringizga yordam beraman.'
    check (char_length(greeting) <= 500),
  quick_questions text[] not null default array[
    'Reyting qanday hisoblanadi?',
    'IT yo''nalishidagi liderlarni ko''rsat',
    'Ariza qanday topshiraman?'
  ]::text[],

  avatar_kind text not null default 'video' check (avatar_kind in ('image', 'video')),
  avatar_image_url text,
  avatar_video_url text,

  size_px integer not null default 56 check (size_px between 32 and 160),
  floating_height_px integer not null default 24 check (floating_height_px between 0 and 200),
  particle_count integer not null default 18 check (particle_count between 0 and 80),
  animation_speed numeric not null default 1.0 check (animation_speed between 0.25 and 3),

  glow_enabled boolean not null default true,
  particle_enabled boolean not null default true,
  pulse_enabled boolean not null default true,
  bloom_enabled boolean not null default true,
  blur_shadow_enabled boolean not null default true,
  halo_enabled boolean not null default true,
  voice_enabled boolean not null default false,

  glow_color text not null default '#13BCE4' check (glow_color ~* '^#[0-9a-f]{6}$'),
  border_color text not null default '#13BCE4' check (border_color ~* '^#[0-9a-f]{6}$'),
  background_color text check (background_color is null or background_color ~* '^#[0-9a-f]{6}$'),

  opening_animation text not null default 'portal' check (opening_animation in ('portal', 'fade', 'scale')),
  closing_animation text not null default 'teleport' check (closing_animation in ('teleport', 'fade', 'scale')),

  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint ai_assistant_settings_singleton check (id)
);

drop trigger if exists set_ai_assistant_settings_updated_at on public.ai_assistant_settings;
create trigger set_ai_assistant_settings_updated_at
  before update on public.ai_assistant_settings
  for each row execute function public.set_updated_at();

insert into public.ai_assistant_settings (id) values (true) on conflict (id) do nothing;

-- ---------- RLS ----------
alter table public.ai_assistant_settings enable row level security;

drop policy if exists "ai assistant settings are public" on public.ai_assistant_settings;
create policy "ai assistant settings are public"
  on public.ai_assistant_settings for select
  using (true);

-- Writes only ever happen through the service-role admin client (gated by
-- requirePermission('ai_assistant.manage') in the app layer), so no
-- insert/update/delete policy is granted to authenticated/anon here.

-- ---------- Realtime ----------
-- Lets the public widget pick up admin changes live without a redeploy.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ai_assistant_settings'
  ) then
    alter publication supabase_realtime add table public.ai_assistant_settings;
  end if;
end $$;

-- ---------- Storage bucket ----------
insert into storage.buckets (id, name, public) values
  ('ai-assistant', 'ai-assistant', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "ai assistant bucket is publicly readable" on storage.objects;
create policy "ai assistant bucket is publicly readable"
  on storage.objects for select
  using (bucket_id = 'ai-assistant');

drop policy if exists "admins upload ai assistant media" on storage.objects;
create policy "admins upload ai assistant media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'ai-assistant' and public.has_permission('media.upload'));

drop policy if exists "admins delete ai assistant media" on storage.objects;
create policy "admins delete ai assistant media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'ai-assistant' and public.has_permission('media.upload'));

-- ---------- Permission sync ----------
-- src/lib/permissions.ts dagi ai_assistant.manage ruxsatining SQL nusxasi
-- (role_permissions matritsasi bilan sinxron). super_admin '*' orqali qamrab olingan.
insert into public.role_permissions (role_slug, permission) values
  ('admin', 'ai_assistant.manage')
on conflict do nothing;
