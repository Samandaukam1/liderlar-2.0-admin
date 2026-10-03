-- =========================================================================
-- PROFILNI O'ZI TAHRIRLASH — KO'RIK NAVBATI
--
-- NEGA YANGI JADVAL KERAK (§42: audit yetishmayotganini isbotlasin):
--
-- Hozirgi oqimda foydalanuvchi profilini TAHRIRLAMAYDI — u matnli
-- so'rov yozadi va u `audit_logs` ga tushadi, tahririyat esa qo'lda
-- o'zgartiradi (`requestEdit`).
--
-- `audit_logs` bu ish uchun yaramaydi: u qo'shib boriladigan JURNAL,
-- navbat emas. Unda "qo'llandi/rad etildi" holati, eski-yangi qiymat
-- juftligi va bitta maydon uchun bitta kutayotgan yozuv tushunchasi
-- yo'q. Jurnalga holat qo'shish uni jurnal bo'lishdan to'xtatardi.
--
-- `candidate_intake_answer_revisions` ham yaramaydi: u ANKETA
-- javoblariga bog'langan, `candidates` jadvalidagi maydonlarga emas.
--
-- FORWARD-ONLY.
-- =========================================================================

create table if not exists public.candidate_profile_edits (
  id uuid primary key default gen_random_uuid(),

  candidate_id uuid not null references public.candidates(id) on delete cascade,

  /*
   * KIM YUBORGANI.
   *
   * `candidate_id` dan ALOHIDA: nomzod profili keyin boshqa
   * akkauntga bog'lanishi mumkin va o'zgarishni kim yuborgani
   * tarixda qolishi kerak.
   *
   * `on delete restrict`: tahrir tarixi bor profilni o'chirib
   * bo'lmaydi — §35 mazmunni yo'q qilmaslikni talab qiladi.
   */
  profile_id uuid not null references public.profiles(id) on delete restrict,

  /*
   * MAYDON NOMI — ERKIN MATN, `check (field in (...))` EMAS.
   *
   * Ruxsat etilgan maydonlar ro'yxati kodda (`CANDIDATE_FIELDS`) va
   * u yerda testlangan. Bazaga ham yozib qo'ysak, yangi maydon
   * qo'shish uchun migratsiya kerak bo'lardi va ikki ro'yxat
   * ajralib ketardi.
   *
   * Xavfsizlik bu ustunga tayanmaydi: yozishga faqat server
   * ruxsatli va u ro'yxatdan o'tgan maydonni yozadi.
   */
  field text not null check (char_length(field) between 1 and 64),

  /*
   * QIYMATLAR MATN SIFATIDA.
   *
   * `jsonb` emas: bu yerda saqlanadigan narsa ADMIN KO'RADIGAN
   * "eski -> yangi" juftligi. Tiplangan qiymat kerak bo'lsa, u
   * `candidates` jadvalida turadi; bu yerdagisi ko'rik uchun.
   */
  before_value text,
  after_value text,

  state text not null default 'pending_review' check (state in (
    'pending_review', 'applied', 'rejected'
  )),

  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
 * BITTA MAYDON — BITTA KUTAYOTGAN O'ZGARISH.
 *
 * Foydalanuvchi tug'ilgan sanasini uch marta o'zgartirsa, uchta
 * navbat yozuvi paydo bo'lishi kerak emas: admin qaysi birini
 * qo'llashini bilmasdi. Yangi yozuv eskisining o'rnini oladi.
 *
 * `applied` va `rejected` yozuvlar hisobga olinmaydi — ular TARIX
 * va necha bo'lsa ham bo'ladi (§6 revision history).
 */
create unique index if not exists uq_candidate_edit_pending
  on public.candidate_profile_edits (candidate_id, field)
  where state = 'pending_review';

-- Admin navbati: eng eski birinchi.
create index if not exists idx_candidate_edits_pending
  on public.candidate_profile_edits (created_at)
  where state = 'pending_review';

create index if not exists idx_candidate_edits_candidate
  on public.candidate_profile_edits (candidate_id, created_at desc);

drop trigger if exists trg_candidate_profile_edits_updated on public.candidate_profile_edits;
create trigger trg_candidate_profile_edits_updated
  before update on public.candidate_profile_edits
  for each row execute function public.set_updated_at();

comment on table public.candidate_profile_edits is
  'Foydalanuvchi yuborgan va ko''rik talab qiladigan profil '
  'o''zgarishlari. Darhol nashr bo''ladigan maydonlar bu yerga '
  'tushmaydi — ular to''g''ridan-to''g''ri `candidates` ga yoziladi.';

/* ====================================================================== *
 * RLS
 * ====================================================================== */

alter table public.candidate_profile_edits enable row level security;

/*
 * FOYDALANUVCHI O'ZINIKINI KO'RADI.
 *
 * "Tekshiruvda" holatini ko'rsatish uchun kerak: aks holda odam
 * o'zgarish yuborganini bilmay, qayta-qayta yuborardi.
 */
drop policy if exists candidate_edits_self_select on public.candidate_profile_edits;
create policy candidate_edits_self_select on public.candidate_profile_edits
  for select using (profile_id = auth.uid());

drop policy if exists candidate_edits_admin_select on public.candidate_profile_edits;
create policy candidate_edits_admin_select on public.candidate_profile_edits
  for select using (public.has_permission('candidates.view'));

/*
 * YOZISH SIYOSATI YO'Q — ataylab.
 *
 * Foydalanuvchi bu jadvalga TO'G'RIDAN-TO'G'RI yozsa, `state` ni
 * 'applied' qilib qo'yishi mumkin bo'lardi — ya'ni o'z o'zgarishini
 * o'zi tasdiqlardi (§43 aynan shuni taqiqlaydi).
 *
 * Barcha yozish server orqali: u maydonni ruxsat ro'yxatidan
 * o'tkazadi va `state` ni o'zi qo'yadi.
 */

/* ====================================================================== *
 * O'ZGARISHNI QO'LLASH
 *
 *    Admin tasdiqlaganda IKKI narsa bo'lishi kerak: `candidates`
 *    yangilanadi va navbat yozuvi 'applied' ga o'tadi. Ikkisi bitta
 *    tranzaksiyada bo'lmasa, biri o'tib ikkinchisi yiqilganda navbat
 *    adminga qayta ko'rsatilardi yoki o'zgarish auditsiz qolardi.
 * ====================================================================== */

create or replace function public.apply_candidate_profile_edit(
  p_edit_id uuid,
  p_reviewer_id uuid,
  p_note text default null
)
returns public.candidate_profile_edits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edit public.candidate_profile_edits;
  v_result public.candidate_profile_edits;
begin
  select * into v_edit
  from public.candidate_profile_edits
  where id = p_edit_id
  for update;

  if not found then
    raise exception 'Tahrir topilmadi: %', p_edit_id using errcode = 'no_data_found';
  end if;

  if v_edit.state <> 'pending_review' then
    /*
     * Ikki admin bir vaqtda tasdiqlasa, ikkinchisi shu yerda
     * to'xtaydi — aks holda o'zgarish ikki marta qo'llanardi.
     */
    raise exception 'Bu tahrir allaqachon ko''rildi: %', v_edit.state
      using errcode = 'serialization_failure';
  end if;

  /*
   * MAYDONLAR RO'YXATI BU YERDA QAT'IY.
   *
   * Dinamik SQL (`execute format(...)`) ishlatilmaydi: `field`
   * ustuni erkin matn va uni ustun nomi sifatida qo'shish SQL
   * in'ektsiyasiga yo'l ochardi. Shuning uchun har bir maydon
   * ALOHIDA yozilgan — uzunroq, lekin in'ektsiya imkonsiz.
   *
   * Ro'yxat kodda (`CANDIDATE_FIELDS`) dagi `review` siyosatidagi
   * maydonlar bilan mos bo'lishi kerak.
   */
  if v_edit.field = 'birth_date' then
    update public.candidates
      set birth_date = nullif(v_edit.after_value, '')::date
      where id = v_edit.candidate_id;

  elsif v_edit.field = 'region_id' then
    update public.candidates
      set region_id = nullif(v_edit.after_value, '')::uuid
      where id = v_edit.candidate_id;

  elsif v_edit.field = 'category_id' then
    update public.candidates
      set category_id = nullif(v_edit.after_value, '')::uuid
      where id = v_edit.candidate_id;

  else
    raise exception 'Bu maydon qo''llanmaydi: %', v_edit.field
      using errcode = 'invalid_parameter_value';
  end if;

  update public.candidate_profile_edits
    set state = 'applied',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        review_note = p_note
    where id = p_edit_id
    returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.apply_candidate_profile_edit(uuid, uuid, text)
  from public, anon, authenticated;

comment on function public.apply_candidate_profile_edit is
  'Tasdiqlangan tahrirni `candidates` ga yozadi va navbat yozuvini '
  'yopadi — bitta tranzaksiyada. Faqat service_role.';
