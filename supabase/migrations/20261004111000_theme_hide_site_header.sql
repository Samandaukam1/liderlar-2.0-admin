-- =========================================================================
-- PREMIUM PROFIL: SAYT HEADERINI BERKITISH
--
-- VIP a'zo o'z ommaviy profilida standart Liderlar sayt headerini
-- ko'rsatish yoki berkitishni tanlaydi. Faqat SHU profil sahifasiga
-- ta'sir qiladi (boshqa sahifalar va boshqa a'zolar o'zgarmaydi).
--
-- Standart `false` — hozirgi xatti-harakat saqlanadi. Yozish faqat server
-- (service_role) orqali, `profile.premium_themes` huquqi bilan.
-- FORWARD-ONLY.
-- =========================================================================

alter table public.candidate_theme_preferences
  add column if not exists hide_site_header boolean not null default false;

comment on column public.candidate_theme_preferences.hide_site_header is
  'Ommaviy profilda standart sayt headeri berkitilsinmi (faqat shu profil).';
