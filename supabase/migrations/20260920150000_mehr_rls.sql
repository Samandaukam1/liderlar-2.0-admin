-- ============================================================
-- MEHR 365+ / PHASE 1d — RLS VA RUXSATLAR
--
-- TAMOYIL: ommaviy yo'l faqat TASDIQLANGAN kontentni ko'radi.
--
-- Ishtirokchilar ro'yxati, check-in dalillari, joylashuv va
-- referral ma'lumotlari anon rolga UMUMAN ochilmaydi. Ommaviy
-- sahifa ularni serverda, ustunlarni ATMA-ATI sanab render
-- qiladi — `select("*")` bilan emas. Sabab: RLS qator darajasida
-- ishlaydi, ustun darajasida emas; qator ochilsa, undagi HAMMA
-- ustun ochiladi.
-- ============================================================

alter table public.mehr_categories        enable row level security;
alter table public.mehr_activities        enable row level security;
alter table public.mehr_activity_sessions enable row level security;
alter table public.mehr_participants      enable row level security;
alter table public.mehr_checkins          enable row level security;
alter table public.mehr_media             enable row level security;
alter table public.mehr_reviews           enable row level security;
alter table public.point_rules            enable row level security;
alter table public.point_ledger           enable row level security;
alter table public.point_aggregates       enable row level security;
alter table public.certificates           enable row level security;
alter table public.referral_codes         enable row level security;
alter table public.referral_attributions  enable row level security;
alter table public.referral_rewards       enable row level security;

-- ------------------------------------------------------------
-- KATEGORIYALAR — ommaviy
-- ------------------------------------------------------------
drop policy if exists mehr_categories_public_select on public.mehr_categories;
create policy mehr_categories_public_select on public.mehr_categories
  for select using (is_active = true);

-- ------------------------------------------------------------
-- EZGULIK ISHLARI
--
--   ommaviy  — faqat 'approved';
--   a'zo     — o'zi tashkil qilgani (har qanday holatda);
--   admin    — hammasi.
-- ------------------------------------------------------------
drop policy if exists mehr_activities_public_select on public.mehr_activities;
create policy mehr_activities_public_select on public.mehr_activities
  for select using (status = 'approved');

drop policy if exists mehr_activities_organizer_select on public.mehr_activities;
create policy mehr_activities_organizer_select on public.mehr_activities
  for select using (organizer_profile_id = auth.uid());

drop policy if exists mehr_activities_admin_select on public.mehr_activities;
create policy mehr_activities_admin_select on public.mehr_activities
  for select using (public.has_permission('mehr.view'));

-- ------------------------------------------------------------
-- MEDIA — ota tadbir tasdiqlangan bo'lsa ommaviy
-- ------------------------------------------------------------
drop policy if exists mehr_media_public_select on public.mehr_media;
create policy mehr_media_public_select on public.mehr_media
  for select using (
    exists (
      select 1 from public.mehr_activities a
      where a.id = mehr_media.activity_id and a.status = 'approved'
    )
  );

drop policy if exists mehr_media_organizer_select on public.mehr_media;
create policy mehr_media_organizer_select on public.mehr_media
  for select using (
    exists (
      select 1 from public.mehr_activities a
      where a.id = mehr_media.activity_id and a.organizer_profile_id = auth.uid()
    )
  );

drop policy if exists mehr_media_admin_select on public.mehr_media;
create policy mehr_media_admin_select on public.mehr_media
  for select using (public.has_permission('mehr.view'));

-- ------------------------------------------------------------
-- ISHTIROKCHILAR — OMMAVIY EMAS
--
--   A'zo o'z ishtirokini ko'radi; tashkilotchi o'z tadbiri
--   ro'yxatini ko'radi; admin hammasini. Anon — yo'q.
-- ------------------------------------------------------------
drop policy if exists mehr_participants_self_select on public.mehr_participants;
create policy mehr_participants_self_select on public.mehr_participants
  for select using (profile_id = auth.uid());

drop policy if exists mehr_participants_organizer_select on public.mehr_participants;
create policy mehr_participants_organizer_select on public.mehr_participants
  for select using (
    exists (
      select 1 from public.mehr_activities a
      where a.id = mehr_participants.activity_id and a.organizer_profile_id = auth.uid()
    )
  );

drop policy if exists mehr_participants_admin_select on public.mehr_participants;
create policy mehr_participants_admin_select on public.mehr_participants
  for select using (public.has_permission('mehr.view'));

-- ------------------------------------------------------------
-- SEANS VA CHECK-IN — FAQAT SERVER VA ADMIN
--
--   Seansda QR imzolash kaliti bor. U mijozga chiqsa, istalgan
--   odam o'zi uchun haqiqiy check-in tokeni yasay olardi —
--   ya'ni butun ishtirok tekshiruvi ma'nosini yo'qotardi.
--   Shuning uchun a'zoga ham, tashkilotchiga ham OCHILMAYDI.
-- ------------------------------------------------------------
drop policy if exists mehr_activity_sessions_admin_select on public.mehr_activity_sessions;
create policy mehr_activity_sessions_admin_select on public.mehr_activity_sessions
  for select using (public.has_permission('mehr.review'));

drop policy if exists mehr_checkins_admin_select on public.mehr_checkins;
create policy mehr_checkins_admin_select on public.mehr_checkins
  for select using (public.has_permission('mehr.review'));

drop policy if exists mehr_reviews_admin_select on public.mehr_reviews;
create policy mehr_reviews_admin_select on public.mehr_reviews
  for select using (public.has_permission('mehr.view'));

drop policy if exists mehr_reviews_organizer_select on public.mehr_reviews;
create policy mehr_reviews_organizer_select on public.mehr_reviews
  for select using (
    exists (
      select 1 from public.mehr_activities a
      where a.id = mehr_reviews.activity_id and a.organizer_profile_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- BALLAR
--
--   Qoidalar — ommaviy (shaffoflik: qaysi ish necha ball beradi).
--   Daftar   — faqat o'ziniki va admin.
--   Jamlanma — ommaviy: reyting shundan chiqadi va unda ism yo'q,
--              faqat profil id va raqam.
-- ------------------------------------------------------------
drop policy if exists point_rules_public_select on public.point_rules;
create policy point_rules_public_select on public.point_rules
  for select using (is_active = true);

drop policy if exists point_ledger_self_select on public.point_ledger;
create policy point_ledger_self_select on public.point_ledger
  for select using (profile_id = auth.uid());

drop policy if exists point_ledger_admin_select on public.point_ledger;
create policy point_ledger_admin_select on public.point_ledger
  for select using (public.has_permission('points.view'));

drop policy if exists point_aggregates_public_select on public.point_aggregates;
create policy point_aggregates_public_select on public.point_aggregates
  for select using (true);

-- ------------------------------------------------------------
-- SERTIFIKATLAR — ommaviy tekshirish uchun o'qiladi
--
--   Qatorda ism yo'q: faqat profil id, rol va holat. Bekor
--   qilingan sertifikat ham ko'rinadi — "bekor qilingan" deb
--   ko'rsatish uchun uni o'qish shart (§33).
-- ------------------------------------------------------------
drop policy if exists certificates_public_select on public.certificates;
create policy certificates_public_select on public.certificates
  for select using (true);

-- ------------------------------------------------------------
-- REFERRAL — HECH QACHON OMMAVIY EMAS
-- ------------------------------------------------------------
drop policy if exists referral_codes_self_select on public.referral_codes;
create policy referral_codes_self_select on public.referral_codes
  for select using (profile_id = auth.uid());

drop policy if exists referral_codes_admin_select on public.referral_codes;
create policy referral_codes_admin_select on public.referral_codes
  for select using (public.has_permission('referrals.view'));

drop policy if exists referral_attributions_self_select on public.referral_attributions;
create policy referral_attributions_self_select on public.referral_attributions
  for select using (referrer_profile_id = auth.uid());

drop policy if exists referral_attributions_admin_select on public.referral_attributions;
create policy referral_attributions_admin_select on public.referral_attributions
  for select using (public.has_permission('referrals.view'));

drop policy if exists referral_rewards_self_select on public.referral_rewards;
create policy referral_rewards_self_select on public.referral_rewards
  for select using (referrer_profile_id = auth.uid());

drop policy if exists referral_rewards_admin_select on public.referral_rewards;
create policy referral_rewards_admin_select on public.referral_rewards
  for select using (public.has_permission('referrals.view'));

/*
 * YOZISH SIYOSATLARI ATAYLAB YO'Q — BARCHA JADVALLARDA.
 *
 * Ball berish, sertifikat yaratish, tadbirni tasdiqlash, referral
 * mukofoti — hammasi tekshiruv va takrorlanmaslik kaliti bilan
 * birga bajarilishi kerak. Mijozga to'g'ridan-to'g'ri insert
 * berilsa, odam o'ziga ball yozib qo'yardi. Yozish faqat server
 * (service role) orqali.
 */

-- ============================================================
-- RUXSATLAR — src/lib/permissions.ts bilan bir xil
-- ============================================================
insert into public.role_permissions (role_slug, permission) values
  ('admin', 'mehr.view'),
  ('admin', 'mehr.review'),
  ('admin', 'mehr.manage'),
  ('admin', 'points.view'),
  ('admin', 'points.manage'),
  ('admin', 'certificates.manage'),
  ('admin', 'referrals.view'),
  ('admin', 'referrals.manage'),

  -- Moderator ko'rib chiqadi, lekin ball iqtisodiyotini o'zgartira olmaydi.
  ('moderator', 'mehr.view'),
  ('moderator', 'mehr.review'),
  ('moderator', 'points.view'),

  ('analyst', 'mehr.view'),
  ('analyst', 'points.view'),
  ('analyst', 'referrals.view'),

  /*
   * Kuzatuvchi.
   *
   * TS tomonda `viewer` roli `.view` bilan tugagan HAR QANDAY
   * ruxsatni avtomatik oladi (permissions.ts, VIEW_ONLY). Agar
   * bu yerda sanalmasa, panel bo'limni ko'rsatardi-yu, RLS bo'sh
   * ro'yxat qaytarardi — foydalanuvchi uchun "buzuq sahifa".
   */
  ('viewer', 'members.view'),
  ('viewer', 'mehr.view'),
  ('viewer', 'points.view'),
  ('viewer', 'referrals.view')
on conflict do nothing;
