-- ============================================================
-- Liderlar.uz 2.0 — Burchak video (corner video widget)
-- A muted, auto-playing picture-in-picture video pinned to one
-- corner of every user-panel page. Tapping it enlarges the card
-- into the centre of the screen and unmutes it; an admin-defined
-- animated CTA button sits underneath. Single row, publicly
-- readable (RLS), writable only via the service-role admin client
-- after requirePermission('corner_video.manage'). Idempotent.
-- ============================================================

create table if not exists public.corner_video_settings (
  id boolean primary key default true,
  enabled boolean not null default false,

  video_url text,
  poster_url text,

  corner text not null default 'bottom-left'
    check (corner in ('bottom-left', 'bottom-right', 'top-left', 'top-right')),
  aspect_ratio text not null default '9:16'
    check (aspect_ratio in ('9:16', '4:5', '1:1', '16:9')),

  width_px integer not null default 150 check (width_px between 90 and 420),
  offset_x_px integer not null default 16 check (offset_x_px between 0 and 200),
  offset_y_px integer not null default 16 check (offset_y_px between 0 and 200),
  rounded_px integer not null default 18 check (rounded_px between 0 and 40),

  loop_enabled boolean not null default true,
  show_close_button boolean not null default true,

  button_enabled boolean not null default true,
  button_label text not null default 'Batafsil'
    check (char_length(button_label) between 1 and 40),
  button_url text,
  button_animation text not null default 'pulse'
    check (button_animation in ('pulse', 'bounce', 'glow', 'shine', 'none')),
  button_color text not null default '#13BCE4'
    check (button_color ~* '^#[0-9a-f]{6}$'),
  button_text_color text not null default '#FFFFFF'
    check (button_text_color ~* '^#[0-9a-f]{6}$'),

  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint corner_video_settings_singleton check (id)
);

drop trigger if exists set_corner_video_settings_updated_at on public.corner_video_settings;
create trigger set_corner_video_settings_updated_at
  before update on public.corner_video_settings
  for each row execute function public.set_updated_at();

insert into public.corner_video_settings (id) values (true) on conflict (id) do nothing;

-- ---------- RLS ----------
alter table public.corner_video_settings enable row level security;

drop policy if exists "corner video settings are public" on public.corner_video_settings;
create policy "corner video settings are public"
  on public.corner_video_settings for select
  using (true);

-- Writes only ever happen through the service-role admin client (gated by
-- requirePermission('corner_video.manage') in the app layer), so no
-- insert/update/delete policy is granted to authenticated/anon here.

-- ---------- Realtime ----------
-- Lets the public widget pick up admin changes live without a redeploy.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'corner_video_settings'
  ) then
    alter publication supabase_realtime add table public.corner_video_settings;
  end if;
end $$;

-- ---------- Storage bucket ----------
insert into storage.buckets (id, name, public) values
  ('corner-video', 'corner-video', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "corner video bucket is publicly readable" on storage.objects;
create policy "corner video bucket is publicly readable"
  on storage.objects for select
  using (bucket_id = 'corner-video');

drop policy if exists "admins upload corner video media" on storage.objects;
create policy "admins upload corner video media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'corner-video' and public.has_permission('media.upload'));

drop policy if exists "admins delete corner video media" on storage.objects;
create policy "admins delete corner video media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'corner-video' and public.has_permission('media.upload'));

-- ---------- Permission sync ----------
-- src/lib/permissions.ts dagi corner_video.manage ruxsatining SQL nusxasi
-- (role_permissions matritsasi bilan sinxron). super_admin '*' orqali qamrab olingan.
insert into public.role_permissions (role_slug, permission) values
  ('admin', 'corner_video.manage')
on conflict do nothing;
