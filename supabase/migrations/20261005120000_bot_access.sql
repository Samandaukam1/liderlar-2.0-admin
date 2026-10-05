-- =====================================================================
-- BOTLAR BOSHQARUVI: kim qaysi botning qaysi funksiyasidan foydalanadi.
--
-- Ilgari tahririyat bitta JSON ro'yxat edi (`site_settings` →
-- `telegram_bot.post_delivery_chat_ids`) va ro'yxatdagi har kim HAMMA
-- narsaga ega edi: postlar, to'lov tasdig'i, qora ro'yxat, sotuv
-- operatori. Yangi odam qo'shish migratsiya talab qilardi.
--
-- Endi har Telegram ID — alohida qator, ruxsatlar esa funksiya
-- darajasida (`permissions` massivi). Kalitlar katalogi kodda:
-- src/lib/bot-access/catalog.ts. Panel: /botlar (settings.manage).
--
-- RLS yoqilgan, siyosat YO'Q: jadvalga faqat service_role (server
-- action va bot webhook'lari) kiradi — intake_blacklist bilan bir xil.
-- =====================================================================

create table if not exists public.bot_access (
  id uuid primary key default gen_random_uuid(),
  -- Telegram chat/foydalanuvchi id. Guruh chatlari manfiy bo'ladi.
  telegram_id bigint not null unique check (telegram_id <> 0),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  note text check (note is null or length(note) <= 500),
  permissions text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bot_access enable row level security;

create index if not exists bot_access_permissions_idx on public.bot_access using gin (permissions);

-- ---------------------------------------------------------------------
-- MAVJUD TAHRIRIYAT RO'YXATINI KO'CHIRISH.
--
-- Ular ilgari hamma narsaga ega edi — shuning uchun hammasi bilan
-- ko'chiriladi, ya'ni ertadan keyin hech kimning imkoniyati kamaymaydi.
-- Ism bot obunachilari jadvalidan olinadi; topilmasa "Muharrir <id>".
-- ---------------------------------------------------------------------
insert into public.bot_access (telegram_id, display_name, note, permissions)
select
  ids.telegram_id,
  coalesce(
    nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''),
    nullif(s.username, ''),
    'Muharrir ' || ids.telegram_id::text
  ),
  'Avvalgi tahririyat ro''yxatidan ko''chirildi',
  array[
    'studio.posts', 'studio.payments', 'studio.channel', 'studio.autofix',
    'studio.report', 'studio.batch', 'studio.crm', 'studio.blacklist',
    'studio.intake_link', 'studio.region_poll',
    'sales.operator'
  ]
from (
  select distinct (elem #>> '{}')::bigint as telegram_id
  from public.site_settings st,
       jsonb_array_elements(
         case when jsonb_typeof(st.value::jsonb) = 'array' then st.value::jsonb else '[]'::jsonb end
       ) as elem
  where st.key = 'telegram_bot.post_delivery_chat_ids'
    and (elem #>> '{}') ~ '^-?[0-9]+$'
) ids
left join lateral (
  select first_name, last_name, username
  from public.telegram_post_subscribers sub
  where sub.chat_id = ids.telegram_id
  order by sub.updated_at desc nulls last
  limit 1
) s on true
on conflict (telegram_id) do nothing;
