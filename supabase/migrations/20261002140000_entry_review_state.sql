-- =========================================================================
-- TUZILGAN YOZUVLAR UCHUN KO'RIK HOLATI
--
-- MUAMMO: `education`, `work_experiences`, `achievements`, `events`,
-- `books_read`, `social_links` jadvallaridagi qator OMMAVIY PROFILDA
-- darhol ko'rinadi. Foydalanuvchi o'zi tahrirlashni boshlasa, u
-- "Yutuqlar" ga istalgan mukofotni yozib qo'yardi va u ensiklopediyada
-- FAKT sifatida turardi — §6 aynan shuni taqiqlaydi.
--
-- YECHIM: har bir yozuvda ko'rik holati bo'ladi.
--
-- NEGA ALOHIDA NAVBAT JADVALI EMAS: bu jadvallardagi QATORNING O'ZI
-- ko'rilayotgan mazmun. Uni boshqa jadvalga nusxalash ikki joyda
-- bir xil ma'lumot hosil qilardi va ular ajralib ketishi mumkin edi.
-- `candidate_profile_edits` esa `candidates` USTUNLARI uchun — u yerda
-- qator yo'q, faqat eski/yangi qiymat juftligi bor.
--
-- MAVJUD MA'LUMOT O'ZGARMAYDI: default `published`, ya'ni hozirgi
-- barcha qatorlar avvalgidek ko'rinishda qoladi.
--
-- FORWARD-ONLY.
-- =========================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'education', 'work_experiences', 'achievements', 'events', 'books_read', 'social_links'
  ]
  loop
    /*
     * DEFAULT `published` — ATAYLAB.
     *
     * `pending_review` bo'lganida, migratsiya qo'llanishi bilan
     * barcha mavjud yozuvlar ommaviy profillardan YO'QOLARDI. Ular
     * admin tomonidan kiritilgan va allaqachon tasdiqlangan.
     */
    execute format($f$
      alter table public.%I
        add column if not exists review_state text not null default 'published'
          check (review_state in ('pending_review', 'published', 'rejected'));
    $f$, t);

    /*
     * KIM KIRITGANI.
     *
     * `null` — admin kiritgan (eski yozuvlar va panel orqali
     * qo'shilganlar). To'ldirilgan bo'lsa, foydalanuvchining o'zi
     * yuborgan va ko'rik kerak edi.
     */
    execute format($f$
      alter table public.%I
        add column if not exists submitted_by uuid references public.profiles(id) on delete set null;
    $f$, t);

    execute format($f$
      alter table public.%I
        add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
        add column if not exists reviewed_at timestamptz,
        add column if not exists review_note text;
    $f$, t);

    -- Admin navbati: kutayotganlar, eng eski birinchi.
    execute format(
      'create index if not exists idx_%s_pending on public.%I(created_at) '
      'where review_state = ''pending_review'';', t, t
    );

    /*
     * OMMAVIY O'QISH INDEKSI.
     *
     * Ommaviy profil `candidate_id` bo'yicha va faqat `published`
     * qatorlarni oladi. Qismiy indeks aynan shu so'rov uchun.
     */
    execute format(
      'create index if not exists idx_%s_public on public.%I(candidate_id, sort_order) '
      'where review_state = ''published'';', t, t
    );
  end loop;
end;
$$;

/* ====================================================================== *
 * OMMAVIY O'QISH SIYOSATI
 *
 *    MAVJUD SIYOSATNING O'ZI QAYTA TA'RIFLANADI — yangi siyosat
 *    QO'SHILMAYDI.
 *
 *    Sabab: RLS siyosatlari OR bilan birlashadi. Yangi, qat'iyroq
 *    siyosat qo'shsak, eski `public candidate sections` siyosati
 *    (u `review_state` ni bilmaydi) tekshiruvdagi yozuvlarni
 *    BARIBIR ko'rsatib turardi — ya'ni butun himoya befoyda
 *    bo'lardi.
 *
 *    Shuning uchun nom o'zgarmaydi: 0008 dagi siyosat o'rniga
 *    shartga `review_state` qo'shilgan varianti qo'yiladi.
 *
 *    Ilovadagi filtr yetarli emas: RLS oxirgi himoya va u ilovadan
 *    mustaqil ishlashi kerak.
 * ====================================================================== */

do $$
declare
  t text;
begin
  foreach t in array array[
    'education', 'work_experiences', 'achievements', 'events', 'books_read', 'social_links'
  ]
  loop
    execute format(
      'drop policy if exists "public candidate sections" on public.%I;', t
    );
    execute format($f$
      create policy "public candidate sections" on public.%I
        for select
        using (
          review_state = 'published'
          and exists (
            select 1 from public.candidates c
            where c.id = %I.candidate_id
              and c.status = 'published'
              and c.deleted_at is null
          )
        );
    $f$, t, t);
  end loop;
end;
$$;

/*
 * EGASI O'ZINING KUTAYOTGAN YOZUVINI KO'RADI.
 *
 * Aks holda odam yozuv yuborgandan keyin uni muharrirda ko'rmay,
 * yo'qolib ketdi deb o'ylardi va qaytadan kiritardi.
 *
 * ALOHIDA siyosat sifatida qo'shiladi: u ommaviy siyosatdan
 * mustaqil va faqat o'z profiliga tegishli.
 */
do $$
declare
  t text;
begin
  foreach t in array array[
    'education', 'work_experiences', 'achievements', 'events', 'books_read', 'social_links'
  ]
  loop
    execute format('drop policy if exists "own entries are visible" on public.%I;', t);
    execute format($f$
      create policy "own entries are visible" on public.%I
        for select
        using (
          exists (
            select 1 from public.candidates c
            where c.id = %I.candidate_id
              and c.user_id = auth.uid()
              and c.deleted_at is null
          )
        );
    $f$, t, t);
  end loop;
end;
$$;

comment on column public.education.review_state is
  'Ko''rik holati. Foydalanuvchi yuborgan yozuv `pending_review` '
  'bo''ladi va ommaviy profilda ko''rinmaydi.';
