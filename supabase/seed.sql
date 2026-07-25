-- ============================================================
-- Liderlar.uz 2.0 — Seed ma'lumotlari
-- Migrationlardan keyin Supabase SQL Editor da ishga tushiring.
-- Idempotent — qayta ishga tushirish xavfsiz.
-- ============================================================

-- ---------- Hududlar ----------
insert into public.regions (name, slug, sort_order) values
  ('Toshkent shahri', 'toshkent-shahri', 1),
  ('Toshkent viloyati', 'toshkent-viloyati', 2),
  ('Andijon', 'andijon', 3),
  ('Buxoro', 'buxoro', 4),
  ('Farg''ona', 'fargona', 5),
  ('Jizzax', 'jizzax', 6),
  ('Xorazm', 'xorazm', 7),
  ('Namangan', 'namangan', 8),
  ('Navoiy', 'navoiy', 9),
  ('Qashqadaryo', 'qashqadaryo', 10),
  ('Qoraqalpog''iston', 'qoraqalpogiston', 11),
  ('Samarqand', 'samarqand', 12),
  ('Sirdaryo', 'sirdaryo', 13),
  ('Surxondaryo', 'surxondaryo', 14)
on conflict (slug) do nothing;

-- ---------- Yo'nalishlar ----------
insert into public.categories (name, slug, color, sort_order) values
  ('Ta''lim', 'talim', 'cyan', 1),
  ('IT va texnologiya', 'it-texnologiya', 'sky', 2),
  ('Tadbirkorlik', 'tadbirkorlik', 'mint', 3),
  ('Ijtimoiy faollik', 'ijtimoiy-faollik', 'rose', 4),
  ('Madaniyat va san''at', 'madaniyat-sanat', 'lavender', 5),
  ('Sport', 'sport', 'lime', 6),
  ('Ilm-fan', 'ilm-fan', 'peach', 7),
  ('Jurnalistika va media', 'jurnalistika-media', 'cyan', 8)
on conflict (slug) do nothing;

-- ---------- Boshlang'ich reyting davri ----------
insert into public.ranking_periods (name, starts_on, ends_on, status, is_current)
select date_part('year', now())::text || ' · boshlang''ich davr',
       date_trunc('quarter', now())::date,
       (date_trunc('quarter', now()) + interval '3 months')::date,
       'open', true
where not exists (select 1 from public.ranking_periods where is_current = true);

insert into public.ranking_weights (period_id, achievements, monthly_activity, active_leadership)
select p.id, 40, 25, 35
from public.ranking_periods p
where p.is_current = true
on conflict (period_id) do nothing;

-- ---------- Sayt sozlamalari ----------
insert into public.site_settings (key, value) values
  ('site_title', 'Liderlar.uz'),
  ('site_description', 'O''zbekistonning yosh liderlari platformasi'),
  ('hero_title', 'Yosh liderlar — kelajak bunyodkorlari'),
  ('hero_subtitle', 'Eng faol yosh liderlarni kashf eting, kuzating va ilhomlaning'),
  ('contact_email', 'info@liderlar.uz'),
  ('application_form_enabled', 'true')
on conflict (key) do nothing;

-- ---------- Huquqiy sahifalar (qoralama) ----------
insert into public.legal_pages (slug, title, content) values
  ('oferta', 'Ommaviy oferta', 'Ommaviy oferta matni admin panel orqali kiritiladi.'),
  ('privacy', 'Maxfiylik siyosati', 'Maxfiylik siyosati matni admin panel orqali kiritiladi.'),
  ('terms', 'Foydalanish shartlari', 'Foydalanish shartlari matni admin panel orqali kiritiladi.')
on conflict (slug) do nothing;

-- ============================================================
-- BIRINCHI SUPER ADMIN
-- 1) Supabase Dashboard → Authentication → Users → "Add user" orqali
--    email + parol bilan foydalanuvchi yarating (email confirmed).
-- 2) So'ng quyidagini o'z emailingiz bilan ishga tushiring:
-- ============================================================

create or replace function public.grant_role_by_email(p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_role uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    return 'Foydalanuvchi topilmadi: ' || p_email;
  end if;
  select id into v_role from public.roles where slug = p_role;
  if v_role is null then
    return 'Rol topilmadi: ' || p_role;
  end if;
  insert into public.profiles (id, full_name)
  values (v_user, split_part(p_email, '@', 1))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role_id)
  values (v_user, v_role)
  on conflict (user_id, role_id) do nothing;
  return 'OK: ' || p_email || ' → ' || p_role;
end;
$$;

-- Misol (o'z emailingizga almashtiring va izohdan chiqaring):
-- select public.grant_role_by_email('jahongirme9@gmail.com', 'super_admin');
