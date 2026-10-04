-- =========================================================================
-- BIOGRAFIYANING MATNLI BO'LIMLARI — KO'RIK HOLATI
--
-- MUAMMO: ommaviy biografiyadagi uzun matn `candidate_sections` da turadi
-- va unda ko'rik holati YO'Q edi. Shuning uchun a'zo (hatto faol VIP ham)
-- o'z biografiyasining matnini muharrirdan boshqara olmasdi — faqat
-- "tahrir so'rovi" yozib, tahririyat qo'lda yangilashini kutardi. Ya'ni
-- "sahifada bor, lekin boshqarib bo'lmaydi" degan holat aynan shu yerda
-- qolgan edi.
--
-- YECHIM: tuzilgan yozuvlardagi (20261002140000) BIR XIL naqsh —
-- qatorning o'zida ko'rik holati. Alohida navbat jadvali qilinmaydi:
-- ko'rilayotgan narsa matnning O'ZI, uni boshqa jadvalga nusxalash
-- ikki joyda ajralib ketadigan bir xil matn hosil qilardi.
--
-- MAVJUD MA'LUMOT O'ZGARMAYDI: default `published`, ya'ni tahririyat
-- yozgan barcha bo'limlar avvalgidek ommada qoladi.
--
-- FORWARD-ONLY.
-- =========================================================================

alter table public.candidate_sections
  add column if not exists review_state text not null default 'published'
    check (review_state in ('pending_review', 'published', 'rejected'));

/*
 * KIM YUBORGANI.
 *
 * `null` — tahririyat yozgan (eski bo'limlar va panel orqali
 * kiritilganlar). To'ldirilgan bo'lsa, a'zoning o'zi yuborgan.
 */
alter table public.candidate_sections
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null;

alter table public.candidate_sections
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

-- Admin navbati: kutayotganlar, eng eski birinchi.
create index if not exists idx_candidate_sections_pending
  on public.candidate_sections(created_at)
  where review_state = 'pending_review';

-- Ommaviy o'qish: `candidate_id` bo'yicha va faqat nashr bo'lganlar.
create index if not exists idx_candidate_sections_public
  on public.candidate_sections(candidate_id, sort_order)
  where review_state = 'published';

/* ====================================================================== *
 * OMMAVIY O'QISH SIYOSATI
 *
 *    MAVJUD SIYOSATNING O'ZI QAYTA TA'RIFLANADI — yangi siyosat
 *    QO'SHILMAYDI. RLS siyosatlari OR bilan birlashadi: `review_state`
 *    ni bilmaydigan eski siyosat qolsa, tekshiruvdagi matn BARIBIR
 *    ommaga chiqardi va butun himoya befoyda bo'lardi.
 * ====================================================================== */

drop policy if exists "published candidate sections are public" on public.candidate_sections;
create policy "published candidate sections are public"
  on public.candidate_sections for select
  using (
    review_state = 'published'
    and exists (
      select 1 from public.candidates c
      where c.id = candidate_sections.candidate_id
        and c.status = 'published'
        and c.deleted_at is null
    )
  );

/*
 * EGASI O'ZINING KUTAYOTGAN BO'LIMINI KO'RADI.
 *
 * Aks holda odam matn yuborgandan keyin uni muharrirda ko'rmay,
 * yo'qolib ketdi deb o'ylardi va qaytadan yozardi.
 */
drop policy if exists "own candidate sections are visible" on public.candidate_sections;
create policy "own candidate sections are visible"
  on public.candidate_sections for select
  using (
    exists (
      select 1 from public.candidates c
      where c.id = candidate_sections.candidate_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

/*
 * YOZISH HUQUQI O'ZGARMAYDI.
 *
 * `candidate section writers` (faqat `candidates.edit` ruxsati) o'z
 * joyida qoladi: a'zoning o'zi bazaga TO'G'RIDAN-TO'G'RI yozmaydi.
 * Uning o'zgarishi server amalidan o'tadi, u yerda huquq (VIP),
 * egalik (`candidates.user_id`) va ko'rik siyosati tekshiriladi.
 * Ya'ni RLS darajasida a'zo uchun yozish YO'Q — bu eng qat'iy holat
 * va boshqa a'zoning profiliga tegish imkonsiz.
 */

comment on column public.candidate_sections.review_state is
  'Ko''rik holati. A''zo yuborgan matn `pending_review` bo''ladi va '
  'ommaviy biografiyada ko''rinmaydi.';
