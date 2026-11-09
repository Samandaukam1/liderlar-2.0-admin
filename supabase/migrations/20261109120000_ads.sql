-- ============================================================================
-- REKLAMALARNI BOSHQARISH (2026-11-09)
--
-- Ikki joyda reklama ko'rsatiladi va ikkalasi BITTA jadvalda turadi:
--
--   placement = 'bot_post'    — post bot yuboradigan har bir post captionining
--                               OXIRIGA qo'shiladigan "matn + havola" qatori.
--                               Nomzod ismi `[*Ism*](havola)` ko'rinishida
--                               bo'lgani kabi, reklama ham `[*Matn*](havola)`.
--   placement = 'profile_bar' — har bir biografik sahifa ustida tepadan tushib
--                               keladigan animatsion bar (matn+tugma yoki rasm).
--
-- QOIDALAR (egasi 2026-11-09 da aytgan):
--   · har joyda bir vaqtda KO'PI BILAN 3 TA reklama yoqilgan bo'lishi mumkin —
--     trigger buni bazada ham tekshiradi, chunki panel tekshiruvi ikki admin
--     bir vaqtda yoqsa o'tkazib yuboradi;
--   · bir nechtasi yoqilgan bo'lsa ular KETMA-KET (navbat bilan) ko'rsatiladi.
--     Bot uchun navbat `claim_next_bot_post_ad()` da: eng uzoq ko'rsatilmagan
--     reklama olinadi va shu zahoti belgilanadi (FOR UPDATE SKIP LOCKED —
--     ikki post bir vaqtda yuborilsa ham bitta reklama ikki marta "navbatdagi"
--     bo'lib qolmaydi). Bar uchun navbat brauzerda hisoblanadi.
--
-- POSTGA YOPISHTIRISH: reklama `candidate_social_posts.telegram_caption` ga
-- YOZILMAYDI (u 5 xil sababdan qayta yig'iladi va navbatni buzardi). U
-- yuborish paytida qo'shiladi va birinchi yuborishda `telegram_ad_id` ga
-- yopishtiriladi — shunda qayta yuborish, faqat xatolarni qayta yuborish va
-- majburiy qayta yuborish bitta postga bitta reklamani saqlaydi.
--
-- NOMLASH: ommaviy URL'larda "ads", "reklama", "banner", "promo" so'zlari
-- ISHLATILMAYDI — reklama bloklovchilar (EasyList, RU AdList) shu so'zli
-- yo'llarni to'sadi. Shuning uchun bucket nomi `elon-media`. Jadval nomi
-- faqat server tomonida ishlatiladi, u muammo emas.
-- ============================================================================

-- ---------- Jadval ----------

create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),

  placement text not null check (placement in ('bot_post', 'profile_bar')),
  -- Admin paneldagi ichki nom ("Jaxongirman ilovasi — noyabr").
  title text not null check (char_length(btrim(title)) between 2 and 80),
  is_active boolean not null default false,
  sort_order integer not null default 0,

  -- bot_post: captionga qo'shiladigan gap; profile_bar/text: bardagi sarlavha.
  text text check (text is null or char_length(btrim(text)) between 2 and 160),
  url text not null check (url ~* '^https?://[^[:space:]]+$'),

  -- Faqat profile_bar uchun.
  kind text check (kind in ('text', 'image')),
  button_label text check (button_label is null or char_length(btrim(button_label)) between 1 and 32),
  -- 1:1 ilova logotipi (profile_bar/text), ommaviy URL.
  logo_url text,
  -- Butun bar o'rnini bosadigan rasm (profile_bar/image), ommaviy URL.
  image_url text,
  image_width integer check (image_width is null or image_width > 0),
  image_height integer check (image_height is null or image_height > 0),
  -- Ko'rinish va animatsiya: {theme, entrance, attention, logoPosition, bg, fg, accent}.
  style jsonb not null default '{}'::jsonb,
  -- X tugmasi birinchi bosilganda havola ochilsinmi (egasining talabi — default yoqilgan).
  close_opens_link boolean not null default true,

  -- Ixtiyoriy jadval: muddat tashqarisida faol bo'lsa ham ko'rsatilmaydi.
  starts_at timestamptz,
  ends_at timestamptz,

  -- Statistika. bot_post: shown_count = nechta postga qo'shildi.
  -- profile_bar: impressions = necha marta ko'rsatildi, clicks = necha marta bosildi.
  shown_count bigint not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  last_shown_at timestamptz,

  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ads_bot_post_shape check (
    placement <> 'bot_post' or (text is not null and kind is null)
  ),
  constraint ads_profile_bar_shape check (
    placement <> 'profile_bar'
    or (kind = 'text' and text is not null)
    or (kind = 'image' and image_url is not null)
  ),
  constraint ads_schedule check (starts_at is null or ends_at is null or ends_at > starts_at)
);

comment on table public.ads is
  'Reklamalar: bot post captioni oxiridagi havola (bot_post) va biografik sahifa ustidagi bar (profile_bar). Har joyda ko''pi bilan 3 tasi faol.';
comment on column public.ads.style is
  'profile_bar ko''rinishi: theme, entrance, attention, logoPosition va ixtiyoriy bg/fg/accent ranglar. Kalitlar kodda tasdiqlanadi.';
comment on column public.ads.close_opens_link is
  'Bardagi X birinchi bosilganda havola yangi oynada ochiladi, ikkinchi bosishda bar yopiladi.';

create index if not exists idx_ads_placement_active
  on public.ads (placement, sort_order, created_at)
  where is_active;

-- ---------- updated_at (umumiy trigger funksiyasi, 0001_extensions.sql) ----------

drop trigger if exists trg_ads_updated on public.ads;
create trigger trg_ads_updated
  before update on public.ads
  for each row execute function public.set_updated_at();

-- ---------- Ko'pi bilan 3 ta faol ----------

create or replace function public.ads_enforce_active_limit()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  if new.is_active then
    -- Bir joy uchun bitta qulf: ikki admin bir vaqtda to'rtinchisini yoqolmaydi.
    perform pg_advisory_xact_lock(hashtext('ads_active_limit:' || new.placement));
    select count(*) into active_count
      from public.ads
     where placement = new.placement
       and is_active
       and id <> new.id;
    if active_count >= 3 then
      raise exception 'Bir vaqtda ko‘pi bilan 3 ta reklama yoqilishi mumkin. Avval boshqasini o‘chiring.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ads_active_limit on public.ads;
create trigger ads_active_limit
  before insert or update of is_active, placement on public.ads
  for each row execute function public.ads_enforce_active_limit();

-- ---------- Bot navbati ----------

-- Navbatdagi bot reklamasini oladi VA belgilaydi. Faol, muddati mos, eng uzoq
-- ko'rsatilmagani birinchi (hech ko'rsatilmagan — eng birinchi). Hech narsa
-- bo'lmasa bo'sh qaytadi — chaqiruvchi reklamasiz yuboradi.
-- SECURITY INVOKER (standart): chaqiruvchi service_role bo'lib, u RLS'ni
-- chetlab o'tadi. DEFINER qilinsa funksiya egasining RLS holatiga bog'lanib
-- qolardi; anon'dan esa EXECUTE olib qo'yilgan.
create or replace function public.claim_next_bot_post_ad()
returns table (id uuid, text text, url text)
language sql
set search_path = public
as $$
  update public.ads a
     set last_shown_at = now(),
         shown_count = a.shown_count + 1
   where a.id = (
     select c.id
       from public.ads c
      where c.placement = 'bot_post'
        and c.is_active
        and (c.starts_at is null or c.starts_at <= now())
        and (c.ends_at is null or c.ends_at > now())
      order by c.last_shown_at asc nulls first, c.sort_order asc, c.created_at asc
      limit 1
      for update skip locked
   )
  returning a.id, a.text, a.url;
$$;

revoke all on function public.claim_next_bot_post_ad() from public, anon, authenticated;
grant execute on function public.claim_next_bot_post_ad() to service_role;

-- Navbatdagi reklamani O'ZGARTIRMASDAN ko'rish (Studio'dagi ko'rinish va sinov
-- yuborish uchun). Claim bilan bir xil tartib.
create or replace function public.peek_next_bot_post_ad()
returns table (id uuid, text text, url text)
language sql
stable
set search_path = public
as $$
  select c.id, c.text, c.url
    from public.ads c
   where c.placement = 'bot_post'
     and c.is_active
     and (c.starts_at is null or c.starts_at <= now())
     and (c.ends_at is null or c.ends_at > now())
   order by c.last_shown_at asc nulls first, c.sort_order asc, c.created_at asc
   limit 1;
$$;

revoke all on function public.peek_next_bot_post_ad() from public, anon, authenticated;
grant execute on function public.peek_next_bot_post_ad() to service_role;

-- ---------- Bar statistikasi ----------

-- Sayt route handler'i service_role bilan chaqiradi; anon'ga berilmaydi,
-- aks holda istalgan kishi hisobni shishirardi.
create or replace function public.track_profile_bar_ad(p_ad_id uuid, p_event text)
returns void
language sql
set search_path = public
as $$
  update public.ads
     set impressions = impressions + (case when p_event = 'impression' then 1 else 0 end),
         clicks = clicks + (case when p_event = 'click' then 1 else 0 end),
         last_shown_at = case when p_event = 'impression' then now() else last_shown_at end
   where id = p_ad_id
     and placement = 'profile_bar'
     and p_event in ('impression', 'click');
$$;

revoke all on function public.track_profile_bar_ad(uuid, text) from public, anon, authenticated;
grant execute on function public.track_profile_bar_ad(uuid, text) to service_role;

-- ---------- Bar sozlamalari (bitta qator) ----------

create table if not exists public.ads_settings (
  id boolean primary key default true check (id),
  -- sequential: har sahifa ko'rishida navbatdagisi; cycle: bitta sahifada
  -- har N soniyada almashadi; random: tasodifiy.
  profile_bar_rotation text not null default 'sequential'
    check (profile_bar_rotation in ('sequential', 'cycle', 'random')),
  profile_bar_appear_delay_ms integer not null default 1200
    check (profile_bar_appear_delay_ms between 0 and 30000),
  profile_bar_cycle_seconds integer not null default 8
    check (profile_bar_cycle_seconds between 3 and 120),
  -- Bar yopilgach shu soat davomida qayta chiqmaydi (o'sha brauzerda).
  profile_bar_dismiss_hours integer not null default 12
    check (profile_bar_dismiss_hours between 1 and 720),
  -- Sahifa pastga aylantirilganda bar yashirinadi, yuqoriga qaytganda chiqadi —
  -- shunda u dizaynlardagi yopishqoq menyularni va o'qishni to'smaydi.
  profile_bar_hide_on_scroll boolean not null default true,
  -- end: footer qatoridan keyin (postning eng oxiri); before_footer: footerdan oldin.
  bot_post_position text not null default 'end'
    check (bot_post_position in ('end', 'before_footer')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.ads_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists trg_ads_settings_updated on public.ads_settings;
create trigger trg_ads_settings_updated
  before update on public.ads_settings
  for each row execute function public.set_updated_at();

comment on table public.ads_settings is
  'Reklama bo''limining umumiy sozlamalari — yagona qator (id = true).';

-- ---------- RLS ----------

alter table public.ads enable row level security;
alter table public.ads_settings enable row level security;

-- Sayt (anon kalit) faqat faol va muddati mos BAR reklamalarini o'qiydi —
-- corner_video_settings bilan bir xil yo'l (anon client + unstable_cache).
-- Bot reklamalari ommaviy emas: ularni faqat service_role ko'radi.
drop policy if exists "active profile bar ads are public" on public.ads;
create policy "active profile bar ads are public"
  on public.ads for select
  using (
    placement = 'profile_bar'
    and is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

drop policy if exists "ads settings are public" on public.ads_settings;
create policy "ads settings are public"
  on public.ads_settings for select
  using (true);

-- Yozish faqat service_role (admin panel server action) orqali — RLS'ni chetlab o'tadi.
-- Huquqlar aniq yoziladi: Supabase'ning standart huquqlariga tayanmaymiz.
grant select on public.ads, public.ads_settings to anon, authenticated;
grant all on public.ads, public.ads_settings to service_role;

-- ---------- Postga yopishtirish ----------

alter table public.candidate_social_posts
  add column if not exists telegram_ad_enabled boolean not null default true,
  add column if not exists telegram_ad_id uuid references public.ads(id) on delete set null,
  add column if not exists telegram_ad_assigned_at timestamptz;

comment on column public.candidate_social_posts.telegram_ad_enabled is
  'false — bu postga reklama qo''shilmaydi (Studio''da "Reklamasiz").';
comment on column public.candidate_social_posts.telegram_ad_id is
  'Shu postga yopishtirilgan reklama. Admin oldindan tanlashi yoki birinchi yuborishda navbatdan olinishi mumkin; keyingi yuborishlar shuni saqlaydi.';

-- ---------- Rasm/logotip saqlash ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('elon-media', 'elon-media', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "elon media is publicly readable" on storage.objects;
create policy "elon media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'elon-media');

-- Yuklash faqat server (service_role) orqali — branding bucket bilan bir xil.

-- ---------- Ruxsat ----------
-- src/lib/permissions.ts dagi ads.manage ruxsatining SQL nusxasi.
-- super_admin '*' orqali oladi.

insert into public.role_permissions (role_slug, permission) values
  ('admin', 'ads.manage')
on conflict do nothing;
