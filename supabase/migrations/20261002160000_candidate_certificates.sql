-- =========================================================================
-- FOYDALANUVCHI KIRITGAN SERTIFIKATLAR
--
-- NEGA MAVJUD `certificates` JADVALI YARAMAYDI:
--
-- U PLATFORMA BERADIGAN sertifikat. Unda ommaviy tekshirish uchun
-- `code` (QR), `kind in ('mehr_activity','candidate')` va
-- `recipient_profile_id` bor — ya'ni uni Liderlar BERADI va kod orqali
-- har kim haqiqiyligini tekshiradi.
--
-- Foydalanuvchiga o'sha jadvalga yozish huquqini berish uni o'ziga
-- platforma sertifikati yozib qo'yish imkonini berardi va ommaviy
-- tekshirish sahifasi uni HAQIQIY deb ko'rsatardi. §8 aynan shuni
-- taqiqlaydi: "User submission and platform verification are separate
-- concepts."
--
-- Shuning uchun alohida jadval: bu yerdagi yozuv — DA'VO, tasdiq emas.
--
-- FORWARD-ONLY.
-- =========================================================================

create table if not exists public.candidate_certificates (
  id uuid primary key default gen_random_uuid(),

  candidate_id uuid not null references public.candidates(id) on delete cascade,

  /*
   * KIM YUBORGANI. `null` — admin kiritgan.
   *
   * `on delete restrict`: sertifikat tarixi bor profilni o'chirib
   * bo'lmaydi (§35 mazmunni yo'q qilmaslikni talab qiladi).
   */
  submitted_by uuid references public.profiles(id) on delete restrict,

  title text not null check (char_length(title) between 2 and 300),

  -- Beruvchi tashkilot. Tasdiqlanmagan DA'VO — shuning uchun majburiy emas.
  issuer text check (issuer is null or char_length(issuer) <= 300),

  issued_on date,
  expires_on date,

  /*
   * SERTIFIKAT RAQAMI VA TEKSHIRISH HAVOLASI.
   *
   * Ikkisi ham ixtiyoriy, lekin ular bo'lsa admin da'voni MUSTAQIL
   * tekshirishi mumkin — ya'ni tasdiqlash asosli bo'ladi.
   */
  credential_number text check (credential_number is null or char_length(credential_number) <= 160),
  credential_url text check (credential_url is null or char_length(credential_url) <= 1000),

  description text check (description is null or char_length(description) <= 2000),

  /*
   * DALIL RASMI.
   *
   * `candidate_media` dagi qatorga ishora emas, to'g'ridan-to'g'ri
   * URL: sertifikat rasmi profil galereyasiga tushmasligi kerak —
   * u alohida mazmun va galereyada aralashib ketardi.
   */
  evidence_url text check (evidence_url is null or char_length(evidence_url) <= 1000),

  /*
   * ISHONCH DARAJASI (§8 ning uch belgisi).
   *
   *   pending_review — yuborilgan, admin hali ko'rmagan. OMMADA YO'Q.
   *   user_entered   — admin ko'rdi, ommaga ochdi, lekin TASDIQLAMADI.
   *                    Belgisi: "Foydalanuvchi kiritgan".
   *   verified       — admin mustaqil tekshirdi va tasdiqladi.
   *   rejected       — qaytarildi (masalan da'vo yolg'on).
   *
   * NEGA `pending_review` DEFAULT: §8 uch belgini talab qiladi va
   * foydalanuvchi kiritganini ommada ko'rsatishga ruxsat beradi.
   * Lekin ensiklopediya uchun tekshirilmagan da'voni admin KO'RMASDAN
   * ommaga chiqarish xavfli: kimdir o'ziga katta mukofot yozib
   * qo'yardi. Shuning uchun admin ishonch darajasini O'ZI tanlaydi —
   * uch belgi saqlanadi, lekin hech biri avtomatik berilmaydi.
   */
  trust text not null default 'pending_review' check (trust in (
    'pending_review', 'user_entered', 'verified', 'rejected'
  )),

  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  sort_order integer not null default 0 check (sort_order >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * MUDDAT BERILISH SANASIDAN OLDIN BO'LMASIN.
   *
   * Bazada tekshirmasak, "2020 da berilgan, 2015 da tugagan" degan
   * yozuv ommaviy profilda chiqib turardi.
   */
  constraint certificate_dates_ordered check (
    expires_on is null or issued_on is null or expires_on >= issued_on
  )
);

/*
 * OMMAVIY O'QISH INDEKSI.
 *
 * Ommaviy profil faqat `user_entered` va `verified` larni oladi.
 * Qismiy indeks aynan shu so'rov uchun.
 */
create index if not exists idx_candidate_certificates_public
  on public.candidate_certificates (candidate_id, sort_order)
  where trust in ('user_entered', 'verified');

-- Admin navbati: eng eski birinchi.
create index if not exists idx_candidate_certificates_pending
  on public.candidate_certificates (created_at)
  where trust = 'pending_review';

create index if not exists idx_candidate_certificates_candidate
  on public.candidate_certificates (candidate_id, created_at desc);

drop trigger if exists trg_candidate_certificates_updated on public.candidate_certificates;
create trigger trg_candidate_certificates_updated
  before update on public.candidate_certificates
  for each row execute function public.set_updated_at();

comment on table public.candidate_certificates is
  'Foydalanuvchi kiritgan sertifikatlar — DA''VO, tasdiq emas. '
  'Platforma beradigan sertifikatlar `certificates` jadvalida.';

comment on column public.candidate_certificates.trust is
  'Ishonch darajasi. Hech biri avtomatik berilmaydi: admin tanlaydi.';

/* ====================================================================== *
 * RLS
 * ====================================================================== */

alter table public.candidate_certificates enable row level security;

/*
 * OMMAVIY O'QISH: faqat admin ochgan darajalar va faqat nashr
 * qilingan nomzodda.
 *
 * `pending_review` va `rejected` ommada KO'RINMAYDI — birinchisi
 * hali ko'rilmagan da'vo, ikkinchisi rad etilgan.
 */
drop policy if exists "public certificates are visible" on public.candidate_certificates;
create policy "public certificates are visible"
  on public.candidate_certificates for select
  using (
    trust in ('user_entered', 'verified')
    and exists (
      select 1 from public.candidates c
      where c.id = candidate_certificates.candidate_id
        and c.status = 'published'
        and c.deleted_at is null
    )
  );

/*
 * EGASI HAMMASINI KO'RADI.
 *
 * Kutayotgan va qaytarilgan yozuvlarini ham: aks holda u yuborgan
 * sertifikatini muharrirda ko'rmay, yo'qolib ketdi deb o'ylardi.
 */
drop policy if exists "own certificates are visible" on public.candidate_certificates;
create policy "own certificates are visible"
  on public.candidate_certificates for select
  using (
    exists (
      select 1 from public.candidates c
      where c.id = candidate_certificates.candidate_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

drop policy if exists "admins read certificates" on public.candidate_certificates;
create policy "admins read certificates"
  on public.candidate_certificates for select
  using (public.has_permission('candidates.view'));

/*
 * YOZISH SIYOSATI YO'Q — ataylab.
 *
 * Foydalanuvchi to'g'ridan-to'g'ri yozsa, `trust` ni 'verified'
 * qilib qo'yishi mumkin bo'lardi — ya'ni o'zini o'zi tasdiqlardi.
 * §8 va §43 aynan shuni taqiqlaydi.
 *
 * Barcha yozish server orqali va u `trust` ni O'ZI qo'yadi.
 */
