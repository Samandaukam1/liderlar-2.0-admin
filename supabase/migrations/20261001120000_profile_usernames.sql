-- =========================================================================
-- LOGIN (USERNAME) — EMAILSIZ KIRISH
--
-- MAQSAD: nomzod akkauntni faollashtirganda email so'ralmaydi. U
-- o'ziga login tanlaydi va tizimga "login + parol" bilan kiradi.
--
-- SUPABASE AUTH O'ZGARMAYDI. U hamon yagona autentifikatsiya
-- hokimi; GoTrue esa parol bilan kirish uchun email talab qiladi.
-- Shuning uchun har username hisobiga ICHKI, ko'rinmaydigan
-- manzil beriladi (`u-<uuid>@users.liderlar.uz`) va u:
--   · foydalanuvchiga HECH QACHON ko'rsatilmaydi;
--   · usernamedan KELTIRIB CHIQARILMAYDI — login o'zgarsa,
--     autentifikatsiya shaxsi joyida qoladi;
--   · hech qachon xat yuborilmaydi (MX yozuvi yo'q, parol
--     tiklash email oqimi bu hisoblar uchun ishlatilmaydi).
--
-- MAVJUD EMAIL FOYDALANUVCHILAR BUZILMAYDI: ularda `username`
-- bo'sh qoladi va ular avvalgidek email bilan kiraveradi.
--
-- FORWARD-ONLY. Hech narsa o'chirilmaydi.
-- =========================================================================

alter table public.profiles
  add column if not exists username text,
  -- Login qachon qo'yilgani/o'zgartirilgani — kelgusida sovish
  -- muddati va audit uchun.
  add column if not exists username_set_at timestamptz;

comment on column public.profiles.username is
  'Foydalanuvchi tanlagan login. Registrga sezgir EMAS: "Asadbek" va '
  '"asadbek" bitta login. Nomzodning ommaviy slug''i bilan ALOQASI YO''Q — '
  'loginni o''zgartirish /liderlar/<slug> havolasini o''zgartirmaydi.';

/*
 * YAGONALIK — BAZA DARAJASIDA, REGISTRGA SEZGIR EMAS.
 *
 * Faqat forma tekshiruviga tayanish poyga holatida ikki odamga
 * bitta loginni berib yuborardi: ikkovi ham "bo'sh" degan javob
 * olib, ikkovi ham saqlashga urinadi.
 */
create unique index if not exists uq_profiles_username_lower
  on public.profiles (lower(username))
  where username is not null;

/* ------------------------------------------------------------------ *
 * BAND QILINGAN LOGINLAR
 *
 * Tizim nomlari odam tomonidan olinmasligi kerak: "admin" yoki
 * "liderlar" loginli hisob boshqalarni chalg'itadi va ishonchni
 * suiiste'mol qilish uchun ishlatiladi.
 * ------------------------------------------------------------------ */

create table if not exists public.reserved_usernames (
  username text primary key,
  reason text
);

insert into public.reserved_usernames (username, reason) values
  ('admin', 'tizim'),
  ('administrator', 'tizim'),
  ('root', 'tizim'),
  ('system', 'tizim'),
  ('api', 'tizim'),
  ('support', 'tizim'),
  ('help', 'tizim'),
  ('info', 'tizim'),
  ('liderlar', 'brend'),
  ('liderlaruz', 'brend'),
  ('liderlar_uz', 'brend'),
  ('mehr', 'brend'),
  ('mehr365', 'brend'),
  ('jaxongir', 'brend'),
  ('moderator', 'tizim'),
  ('tahririyat', 'tizim'),
  ('koordinator', 'tizim'),
  ('bot', 'tizim'),
  ('null', 'texnik'),
  ('undefined', 'texnik')
on conflict (username) do nothing;

alter table public.reserved_usernames enable row level security;
-- Siyosat ATAYLAB yo'q: ro'yxatni faqat server (service_role) o'qiydi.

/* ------------------------------------------------------------------ *
 * LOGIN -> AUTH SHAXSI
 *
 * Kirishda server loginni ichki manzilga aylantirishi kerak.
 * `auth.users` jadvalini ochib qo'ymaslik uchun buni SECURITY
 * DEFINER funksiya qiladi: u faqat BITTA qiymat qaytaradi va
 * ro'yxatni ko'rsatmaydi.
 * ------------------------------------------------------------------ */

create or replace function public.auth_email_for_username(p_username text)
returns text
language sql
security definer
set search_path = public, auth
stable
as $$
  select u.email
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.username is not null
     and lower(p.username) = lower(btrim(p_username))
   limit 1;
$$;

/*
 * ANONIM ROLGA BERILMAYDI.
 *
 * Funksiya faqat server tomonidan (service_role) chaqiriladi.
 * Anonimga ochilsa, u login bo'yicha hisob bor-yo'qligini
 * tekshirish vositasiga aylanardi.
 */
revoke all on function public.auth_email_for_username(text) from public, anon, authenticated;
grant execute on function public.auth_email_for_username(text) to service_role;

comment on function public.auth_email_for_username(text) is
  'Login bo''yicha ichki auth manzilini qaytaradi. Faqat service_role.';
