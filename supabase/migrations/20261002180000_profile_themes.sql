-- =========================================================================
-- PREMIUM PROFIL DIZAYNLARI
--
-- §11: dizayn BARQAROR KALIT bilan saqlanadi, xom CSS bilan emas.
--
-- Nega kalit: CSS saqlansa, u foydalanuvchi kiritgan kod bo'lib qolardi
-- va ommaviy sahifaga tushardi — ya'ni uslub orqali hujum yo'li ochilardi.
-- Kalit esa kodda ro'yxatlangan komponentga ishora qiladi va noma'lum
-- kalit standart dizaynga tushadi.
--
-- IKKI MAYDON — ko'rish va nashr ALOHIDA (§11):
--
--   published_theme — ommaviy sahifa shuni ko'rsatadi
--   draft_theme     — faqat egasi ko'radi (ko'rib chiqish)
--
-- Bitta maydon bo'lganida "ko'rib chiqish" ommaviy sahifani darhol
-- o'zgartirardi va odam tanlashni sinab ko'ra olmasdi.
--
-- FORWARD-ONLY. Mavjud profillar o'zgarmaydi: `null` — standart dizayn.
-- =========================================================================

create table if not exists public.candidate_theme_preferences (
  /*
   * NOMZODGA BOG'LANGAN, PROFILGA EMAS.
   *
   * Dizayn ENSIKLOPEDIYA SAHIFASINING ko'rinishi. Profil keyin boshqa
   * akkauntga bog'lansa, sahifa ko'rinishi o'zgarmasligi kerak.
   */
  candidate_id uuid primary key references public.candidates(id) on delete cascade,

  /*
   * NASHR QILINGAN DIZAYN.
   *
   * `null` — standart. Bu MUHIM: dizayn tizimi o'chirilsa yoki kalit
   * koddan olib tashlansa, profil ishlashda davom etadi (§11 "safe
   * fallback").
   */
  published_theme text check (published_theme is null or char_length(published_theme) between 2 and 48),

  /** Egasi ko'rib chiqayotgan dizayn. Ommaviy sahifaga TA'SIR QILMAYDI. */
  draft_theme text check (draft_theme is null or char_length(draft_theme) between 2 and 48),

  published_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

drop trigger if exists trg_candidate_theme_preferences_updated on public.candidate_theme_preferences;
create trigger trg_candidate_theme_preferences_updated
  before update on public.candidate_theme_preferences
  for each row execute function public.set_updated_at();

comment on table public.candidate_theme_preferences is
  'Nomzod sahifasining premium dizayni. Barqaror kalit saqlanadi, '
  'CSS emas. `null` — standart dizayn.';

/*
 * DIZAYN HISOBOTI UCHUN INDEKS.
 *
 * §36 admin panelda "theme usage" ko'rsatishni talab qiladi — ya'ni
 * "qaysi dizayn necha profilda" degan so'rov bo'ladi.
 */
create index if not exists idx_theme_preferences_published
  on public.candidate_theme_preferences (published_theme)
  where published_theme is not null;

/* ====================================================================== *
 * RLS
 * ====================================================================== */

alter table public.candidate_theme_preferences enable row level security;

/*
 * OMMAVIY O'QISH: nashr qilingan dizayn hammaga ko'rinadi.
 *
 * Ommaviy sahifa uni o'qishi kerak va u imzosiz so'rov. `draft_theme`
 * ham shu qatorda, lekin u SIR EMAS — "bu odam qaysi dizaynni sinab
 * ko'rayapti" degan ma'lumotni yashirishning sababi yo'q.
 */
drop policy if exists "theme preferences are public" on public.candidate_theme_preferences;
create policy "theme preferences are public"
  on public.candidate_theme_preferences for select
  using (
    exists (
      select 1 from public.candidates c
      where c.id = candidate_theme_preferences.candidate_id
        and c.status = 'published'
        and c.deleted_at is null
    )
  );

drop policy if exists "own theme preference" on public.candidate_theme_preferences;
create policy "own theme preference"
  on public.candidate_theme_preferences for select
  using (
    exists (
      select 1 from public.candidates c
      where c.id = candidate_theme_preferences.candidate_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

drop policy if exists "admins read theme preferences" on public.candidate_theme_preferences;
create policy "admins read theme preferences"
  on public.candidate_theme_preferences for select
  using (public.has_permission('candidates.view'));

/*
 * YOZISH SIYOSATI YO'Q.
 *
 * Dizayn tanlash VIP huquqiga bog'langan (`profile.premium_themes`) va
 * u faqat serverda tekshiriladi. Foydalanuvchi to'g'ridan-to'g'ri yozsa,
 * obunasiz ham premium dizayn qo'yib olardi (§43).
 */
