-- ============================================================
-- KANALDAGI TUGMALI OVOZ BERISH — hudud so'rovi
--
-- NEGA TELEGRAM SO'ROVNOMASI EMAS:
--   · u bitta so'rovnomaga 12 tadan ko'p variant qo'ymaydi,
--     hudud esa 14 ta;
--   · natija bizning bazamizga tushmaydi, ya'ni keyin hududiy
--     koordinatorlar tizimida ishlatib bo'lmaydi.
--
-- Tugmali ovozda ikkala cheklov ham yo'q: variant soni erkin va
-- har ovoz shu jadvalga yoziladi.
--
-- QOIDA: non-destructive. Hech narsa o'chirilmaydi.
-- ============================================================

create table if not exists public.channel_poll_votes (
  id uuid primary key default gen_random_uuid(),

  -- Qaysi so'rov. Hozir bitta ('region'), lekin kelajakda boshqa
  -- savollar ham shu mexanizmdan foydalanishi mumkin.
  poll_key text not null default 'region',

  -- Qaysi xabar ostida ovoz berilgan. Kanal bir nechta so'rov
  -- joylashi mumkin va ular aralashmasligi kerak.
  chat_id bigint not null,
  message_id bigint not null,

  -- Kim ovoz bergani. SAQLANISHI SHART: usiz bir odam cheksiz
  -- marta bosib, natijani buzib yuborardi.
  telegram_user_id bigint not null,

  -- Tanlangan hudud. `regions.slug` — nom o'zgarsa ham bog'lanish
  -- saqlanadi.
  option_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- BIR ODAM — BIR OVOZ. Boshqa tugmani bossa, ovozi KO'CHADI
-- (upsert), yangi ovoz qo'shilmaydi.
create unique index if not exists uq_channel_poll_vote_once
  on public.channel_poll_votes(chat_id, message_id, telegram_user_id);

-- Sanoq shu indeks bo'yicha yig'iladi.
create index if not exists idx_channel_poll_vote_counts
  on public.channel_poll_votes(chat_id, message_id, option_key);

drop trigger if exists trg_channel_poll_votes_updated on public.channel_poll_votes;
create trigger trg_channel_poll_votes_updated
  before update on public.channel_poll_votes
  for each row execute function public.set_updated_at();

alter table public.channel_poll_votes enable row level security;

-- Ovozlarni faqat panel ko'radi; yozishni server service_role bilan
-- bajaradi.
do $$
begin
  execute format('drop policy if exists "channel poll votes read" on public.channel_poll_votes');
  execute format(
    'create policy "channel poll votes read" on public.channel_poll_votes for select using (public.has_permission(%L))',
    'posts.view'
  );
end $$;

-- Kanal identifikatori. Moderator kanaldan bitta postni botga
-- forward qilganda avtomatik to'ldiriladi — id'ni qo'lda topish
-- kerak emas.
insert into public.site_settings (key, value) values
  ('telegram_bot.channel_id', '')
on conflict (key) do nothing;
