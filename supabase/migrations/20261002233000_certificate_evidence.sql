-- =========================================================================
-- SERTIFIKAT DALILI — YOPIQ BUCKET (§8)
--
-- MUAMMO: sertifikat dalili (`candidate_certificates.evidence_url`)
-- OMMAVIY bucketdagi rasmga ishora qilardi. Dalil — diplom, guvohnoma,
-- ba'zan pasport ma'lumoti bor hujjat. Uni ommaviy manzilda saqlash
-- havolani bilgan har kimga shaxsiy hujjatni ochib berardi; PDF esa
-- umuman qabul qilinmasdi.
--
-- YECHIM:
--   1. Yopiq `certificate-evidence` bucket (PDF, JPG, PNG, WebP;
--      10 MB gacha). Undan faqat server o'qiydi va 60 soniyalik
--      imzolangan havola beradi — egasiga va tahririyatga.
--   2. `certificate_evidence` jadvali: qaysi sertifikatga qaysi fayl.
--      Sertifikatga BITTA dalil; almashtirishda eski fayl o'chiriladi.
--   3. Biriktirish va olib tashlash — RPC orqali, sertifikat ishonch
--      darajasi bilan BITTA tranzaksiyada (dalil o'zgarsa, oldingi
--      tasdiq o'z kuchini yo'qotadi — §6).
--   4. Mavjud "admins ... all buckets" siyosatlari bu bucketni
--      QAMRAMAYDI: `media.view` ruxsati bor har bir xodim (hatto
--      `viewer`) shaxsiy hujjatlarni storage API orqali to'g'ridan-
--      to'g'ri o'qiy olmasligi kerak.
--
-- MAVJUD MA'LUMOT: `evidence_url` ustuni O'CHIRILMAYDI (forward-only).
-- Eski yozuvlar o'qiladi va ko'rsatiladi; yangi dalil biriktirilganda
-- eski havola tozalanadi.
-- =========================================================================

/* ====================================================================== *
 * 1. BUCKET
 *
 *    `on conflict ... do update`: kimdir bucketni qo'lda OCHIQ qilib
 *    yaratgan bo'lsa ham, migratsiya uni yopiq holatga qaytaradi.
 *    Hajm va tur chegarasi storage darajasida ham turadi — ilova
 *    tekshiruvidan mustaqil ikkinchi to'siq.
 * ====================================================================== */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificate-evidence',
  'certificate-evidence',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/* ====================================================================== *
 * 2. UMUMIY ADMIN SIYOSATLARIDAN AJRATISH
 *
 *    0008 dagi uchta siyosat `bucket_id` ni cheklamaydi. Siyosatlar
 *    OR bilan birlashgani uchun yangi "taqiq" qo'shib bo'lmaydi —
 *    mavjudlarining O'ZI shu bucketni chiqarib qayta ta'riflanadi.
 *    Nomlar o'zgarmaydi.
 * ====================================================================== */

drop policy if exists "admins read all buckets" on storage.objects;
create policy "admins read all buckets"
  on storage.objects for select
  to authenticated
  using (public.has_permission('media.view') and bucket_id <> 'certificate-evidence');

drop policy if exists "admins upload media" on storage.objects;
create policy "admins upload media"
  on storage.objects for insert
  to authenticated
  with check (public.has_permission('media.upload') and bucket_id <> 'certificate-evidence');

drop policy if exists "admins delete media" on storage.objects;
create policy "admins delete media"
  on storage.objects for delete
  to authenticated
  using (public.has_permission('media.delete') and bucket_id <> 'certificate-evidence');

/*
 * BU BUCKET UCHUN SIYOSAT YO'Q — ataylab.
 *
 * Yuklash server bergan imzolangan URL orqali (token bitta manzilga
 * bitta yuklash huquqini beradi), o'qish esa server bergan 60
 * soniyalik imzolangan havola orqali. RLS yoqilgan `storage.objects`
 * da siyosatsiz amal rad etiladi.
 */

/* ====================================================================== *
 * 3. JADVAL
 * ====================================================================== */

create table if not exists public.certificate_evidence (
  -- Bitta sertifikat — bitta dalil.
  certificate_id uuid primary key
    references public.candidate_certificates(id) on delete cascade,

  /*
   * EGALIK — nomzodga. Sertifikat orqali ham topiladi, lekin bu ustun
   * egalik shartini har bir so'rovda bitta tenglik bilan tekshirish
   * imkonini beradi.
   */
  candidate_id uuid not null references public.candidates(id) on delete cascade,

  /*
   * YO'L SERVERDA YASALADI: candidates/<nomzod>/<sertifikat>/<uuid>.<ext>.
   *
   * Shakl bazada ham tekshiriladi — ilovadagi xato boshqa nomzodning
   * papkasiga ishora qiluvchi yozuv qoldirmasin.
   */
  path text not null unique check (
    path ~ '^candidates/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'
  ),

  mime_type text not null check (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),

  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),

  uploaded_by uuid references public.profiles(id) on delete set null,

  created_at timestamptz not null default now(),

  -- Yo'l shu nomzod va shu sertifikatga tegishli bo'lishi shart.
  constraint certificate_evidence_path_owner check (
    path like 'candidates/' || candidate_id::text || '/' || certificate_id::text || '/%'
  )
);

create index if not exists idx_certificate_evidence_candidate
  on public.certificate_evidence (candidate_id);

comment on table public.certificate_evidence is
  'Sertifikat dalili fayli (yopiq `certificate-evidence` bucketda). '
  'Faqat server o''qiydi va qisqa muddatli imzolangan havola beradi.';

alter table public.certificate_evidence enable row level security;

/*
 * O'QISH: faqat sertifikatlarni ko'ra oladigan tahririyat.
 *
 * Egasiga RLS siyosati BERILMAYDI: u faylni sayt serveri orqali
 * ko'radi (egalik shu yerda tekshiriladi). Yo'l ommaga
 * ko'rsatilmasligi kerak — hatto egasining brauzeriga ham.
 */
drop policy if exists "admins read certificate evidence" on public.certificate_evidence;
create policy "admins read certificate evidence"
  on public.certificate_evidence for select
  to authenticated
  using (public.has_permission('candidates.edit'));

-- YOZISH SIYOSATI YO'Q: faqat quyidagi funksiyalar (service_role).

/* ====================================================================== *
 * 4. BIRIKTIRISH — DALIL VA ISHONCH DARAJASI BITTA TRANZAKSIYADA
 *
 *    Qaytaradi: almashtirilgan ESKI faylning yo'li (yoki `null`).
 *    Server uni storage'dan o'chiradi — aks holda har almashtirish
 *    bucketda egasiz fayl qoldirardi.
 * ====================================================================== */

create or replace function public.attach_certificate_evidence(
  p_certificate_id uuid,
  p_candidate_id uuid,
  p_profile_id uuid,
  p_path text,
  p_mime text,
  p_size bigint
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_path text;
begin
  /*
   * SERTIFIKAT SHU NOMZODNIKI VA QULFLANADI.
   *
   * Parallel ikkinchi yuklash shu yerda navbat kutadi: ikkalasi
   * ham "eski yo'l yo'q" deb o'ylab, bittasining fayli egasiz
   * qolmasin.
   */
  perform 1
  from public.candidate_certificates
  where id = p_certificate_id
    and candidate_id = p_candidate_id
  for update;

  if not found then
    raise exception 'Sertifikat topilmadi' using errcode = 'P0002';
  end if;

  select path into v_old_path
  from public.certificate_evidence
  where certificate_id = p_certificate_id;

  insert into public.certificate_evidence (
    certificate_id, candidate_id, path, mime_type, size_bytes, uploaded_by
  )
  values (p_certificate_id, p_candidate_id, p_path, p_mime, p_size, p_profile_id)
  on conflict (certificate_id) do update
    set path = excluded.path,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        uploaded_by = excluded.uploaded_by,
        created_at = now();

  /*
   * DALIL O'ZGARDI — TASDIQ QAYTA KO'RILADI (§6).
   *
   * Admin "verified" ni eski hujjatga qarab bergan. Yangi fayl bilan
   * o'sha belgi o'z-o'zidan qolsa, tasdiqlanmagan hujjat "tasdiqlangan"
   * bo'lib ko'rinardi. Eski ommaviy havola ham tozalanadi: endi dalil
   * yopiq bucketda.
   */
  update public.candidate_certificates
    set trust = 'pending_review',
        reviewed_by = null,
        reviewed_at = null,
        review_note = null,
        evidence_url = null
    where id = p_certificate_id;

  return nullif(v_old_path, p_path);
end;
$$;

revoke all on function public.attach_certificate_evidence(uuid, uuid, uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.attach_certificate_evidence(uuid, uuid, uuid, text, text, bigint)
  to service_role;

comment on function public.attach_certificate_evidence is
  'Dalilni biriktiradi (yoki almashtiradi) va sertifikatni qayta '
  'tekshiruvga yuboradi. Eski fayl yo''lini qaytaradi. Faqat service_role.';

/* ====================================================================== *
 * 5. OLIB TASHLASH
 * ====================================================================== */

create or replace function public.detach_certificate_evidence(
  p_certificate_id uuid,
  p_candidate_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  perform 1
  from public.candidate_certificates
  where id = p_certificate_id
    and candidate_id = p_candidate_id
  for update;

  if not found then
    raise exception 'Sertifikat topilmadi' using errcode = 'P0002';
  end if;

  delete from public.certificate_evidence
  where certificate_id = p_certificate_id
    and candidate_id = p_candidate_id
  returning path into v_path;

  if v_path is not null then
    -- Tasdiq dalilga tayangan edi — dalilsiz holat qayta ko'riladi.
    update public.candidate_certificates
      set trust = 'pending_review',
          reviewed_by = null,
          reviewed_at = null,
          review_note = null
      where id = p_certificate_id;
  end if;

  return v_path;
end;
$$;

revoke all on function public.detach_certificate_evidence(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.detach_certificate_evidence(uuid, uuid)
  to service_role;

comment on function public.detach_certificate_evidence is
  'Dalilni olib tashlaydi va sertifikatni qayta tekshiruvga yuboradi. '
  'O''chirilgan fayl yo''lini qaytaradi (yoki null). Faqat service_role.';
