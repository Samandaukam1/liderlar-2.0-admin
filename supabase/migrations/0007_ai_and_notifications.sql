-- ============================================================
-- Liderlar.uz 2.0 — 0007: Jaxongir AI & notifications
-- ============================================================

-- ---------- ai_jobs ----------
create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null, -- 'improve_text' va h.k.
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  entity_type text,
  entity_id text,
  input_chars integer check (input_chars is null or input_chars >= 0),
  output_chars integer check (output_chars is null or output_chars >= 0),
  model text,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_ai_jobs_created on public.ai_jobs(created_at desc);
create index if not exists idx_ai_jobs_entity on public.ai_jobs(entity_type, entity_id);

-- ---------- ai_chat_sessions ----------
create table if not exists public.ai_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_chat_sessions_user on public.ai_chat_sessions(created_by);

-- ---------- ai_chat_messages ----------
create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_chat_messages_session on public.ai_chat_messages(session_id, created_at);

-- ---------- notifications ----------
-- recipient_id NULL bo'lsa — barcha adminlarga umumiy e'lon
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 300),
  body text,
  kind text not null default 'system',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient
  on public.notifications(recipient_id, read_at, created_at desc);
