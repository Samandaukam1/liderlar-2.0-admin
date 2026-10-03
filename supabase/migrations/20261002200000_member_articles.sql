-- =========================================================================
-- A'ZO MAQOLALARI VA NASHR KANALLARI
--
-- NEGA MAVJUD `articles` JADVALI QAYTA ISHLATILMAYDI:
--
-- U NOMZOD HAQIDA yozilgan BIOGRAFIYA va tahririyat yozadi. Web
-- tomonda u nomzod sahifasining biografiya matni sifatida
-- ko'rsatiladi (`candidate.articles.map(a => a.content)`), ustiga
-- `/maqola/<slug>` sahifasi, qidiruv, sitemap va jurnal bog'lanishi
-- ham shu jadvaldan o'qiydi — jami 18 joy.
--
-- Foydalanuvchi yozgan maqolani o'sha jadvalga qo'shish uchun har 18
-- joyga filtr qo'shish kerak bo'lardi. Bittasi o'tkazib yuborilsa,
-- odamning inshosi NOMZOD BIOGRAFIYASI o'rniga chiqib ketardi.
--
-- Bu yerdagi maqola boshqa narsa: uni A'ZO O'ZI yozadi, mavzusi
-- erkin va u "Liderlar Online" nashrida chiqadi.
--
-- §25 MODELI: BITTA KANONIK MAQOLA + KANAL METAMA'LUMOTI. Ikki
-- nusxa maqola yaratilmaydi — AdabiyotX va Liderlar Online bitta
-- yozuvning ikki nashr kanali.
--
-- FORWARD-ONLY.
-- =========================================================================

/* ====================================================================== *
 * 1. MAQOLA
 * ====================================================================== */

create table if not exists public.member_articles (
  id uuid primary key default gen_random_uuid(),

  /*
   * MUALLIF — NOMZOD.
   *
   * `candidate_id`, `profile_id` emas: ommaviy maqola muallifi
   * ensiklopediyadagi profilga havola qiladi (§26) va u nomzod
   * sahifasi. Akkaunt keyin boshqa odamga o'tsa ham, maqola
   * muallifligi o'zgarmasligi kerak.
   *
   * `on delete restrict`: maqolasi bor nomzodni o'chirib bo'lmaydi —
   * §35 nashr qilingan mazmunni yo'q qilishni taqiqlaydi.
   */
  candidate_id uuid not null references public.candidates(id) on delete restrict,

  /** Kim yuborgani — audit uchun. Muallifdan farq qilishi mumkin. */
  submitted_by uuid references public.profiles(id) on delete set null,

  title text not null check (char_length(title) between 5 and 300),
  subtitle text check (subtitle is null or char_length(subtitle) <= 500),

  /*
   * SLUG NASHR PAYTIDA YASALADI.
   *
   * `null` — hali nashr qilinmagan. Qoralamaga slug berish uni
   * ommaviy manzilda band qilib qo'yardi va nomi o'zgarsa manzil
   * eskirardi.
   */
  slug text check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  excerpt text check (excerpt is null or char_length(excerpt) <= 600),

  /*
   * MAZMUN.
   *
   * Matn sifatida saqlanadi va NASHR PAYTIDA tozalanadi (§58). Xom
   * HTML saqlash ommaviy sahifada saqlangan XSS bo'lardi; tozalashni
   * o'qish paytida qilish esa har ko'rishda takrorlanardi.
   */
  content text not null default '',

  /*
   * BANNER RASMI — NASHR UCHUN SHART (§23, §24).
   *
   * Bazada `not null` EMAS: qoralamada rasm hali bo'lmasligi mumkin.
   * Shart quyidagi triggerda — faqat nashr holatiga o'tishda
   * tekshiriladi.
   */
  hero_url text,
  hero_alt text check (hero_alt is null or char_length(hero_alt) <= 300),

  /*
   * HOLATLAR (§23).
   *
   * Spec sanagan sakkiztasi. Mavjud `articles` jadvalida beshta bor
   * va u yerda `changes_requested` yo'q — u esa muallifga NIMA
   * tuzatish kerakligini aytadigan yagona holat (§27).
   */
  state text not null default 'draft' check (state in (
    'draft', 'submitted', 'in_review', 'changes_requested',
    'approved', 'published', 'rejected', 'archived'
  )),

  /** Tahririyat izohi — muallif ko'radi (§27). */
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,

  submitted_at timestamptz,
  published_at timestamptz,

  seo_title text check (seo_title is null or char_length(seo_title) <= 200),
  seo_description text check (seo_description is null or char_length(seo_description) <= 400),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
 * SLUG FAQAT NASHRDAGILAR ORASIDA UNIKAL.
 *
 * Arxivlangan maqolaning slug'i band bo'lib turishi kerak emas,
 * lekin uning manzili ishlashda davom etishi uchun qator saqlanadi.
 */
create unique index if not exists uq_member_articles_slug
  on public.member_articles (slug)
  where slug is not null;

create index if not exists idx_member_articles_candidate
  on public.member_articles (candidate_id, created_at desc);

-- Tahririyat navbati: yuborilganlar, eng eski birinchi.
create index if not exists idx_member_articles_queue
  on public.member_articles (submitted_at)
  where state in ('submitted', 'in_review');

/*
 * OMMAVIY RO'YXAT INDEKSI.
 *
 * "Liderlar Online" sahifasi eng yangilarini sahifalab oladi (§51).
 */
create index if not exists idx_member_articles_published
  on public.member_articles (published_at desc)
  where state = 'published';

drop trigger if exists trg_member_articles_updated on public.member_articles;
create trigger trg_member_articles_updated
  before update on public.member_articles
  for each row execute function public.set_updated_at();

/* ====================================================================== *
 * 2. NASHR SHARTLARI — BAZA DARAJASIDA
 *
 *    §23: sarlavha, banner rasmi va MA'NOLI mazmun bo'lmasa, maqola
 *    yuborilmaydi va nashr qilinmaydi.
 *
 *    NEGA TRIGGER: shart faqat ilovada bo'lsa, admin paneldan yoki
 *    keyin yoziladigan boshqa koddan bannersiz maqola nashr qilinishi
 *    mumkin bo'lardi — va u Liderlar Online kartochkasida bo'sh
 *    joy bo'lib chiqardi.
 * ====================================================================== */

create or replace function public.member_article_publish_guard()
returns trigger
language plpgsql
as $$
begin
  if new.state in ('submitted', 'in_review', 'approved', 'published') then
    if new.hero_url is null or btrim(new.hero_url) = '' then
      raise exception 'Maqolada banner rasmi bo''lishi shart'
        using errcode = 'check_violation';
    end if;

    /*
     * MAZMUN UZUNLIGI — 200 belgi.
     *
     * Aniq son tanlangani: "bo'sh emas" sharti bitta harfni ham
     * o'tkazardi va tahririyat navbati ma'nosiz yozuvlar bilan
     * to'lardi. 200 belgi — bir paragrafdan kamroq, ya'ni haqiqiy
     * maqolaga to'siq bo'lmaydi.
     */
    if char_length(btrim(new.content)) < 200 then
      raise exception 'Maqola mazmuni juda qisqa (kamida 200 belgi)'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Nashr qilingan maqolada manzil bo'lishi shart.
  if new.state = 'published' and (new.slug is null or btrim(new.slug) = '') then
    raise exception 'Nashr qilinadigan maqolada manzil (slug) bo''lishi shart'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_article_publish_guard on public.member_articles;
create trigger trg_member_article_publish_guard
  before insert or update on public.member_articles
  for each row execute function public.member_article_publish_guard();

/* ====================================================================== *
 * 3. REVIZYALAR — AVTOSAQLASH VA TARIX (§23, §27)
 * ====================================================================== */

create table if not exists public.member_article_revisions (
  id uuid primary key default gen_random_uuid(),

  article_id uuid not null references public.member_articles(id) on delete cascade,

  revision integer not null check (revision > 0),

  title text not null,
  subtitle text,
  content text not null default '',
  excerpt text,

  /*
   * AVTOSAQLASH REVIZYASI ALOHIDA BELGILANADI.
   *
   * Tarixni ko'rsatganda ular yashiriladi: har 30 soniyada bir
   * yozuv tushsa, haqiqiy versiyalar ular orasida ko'rinmay
   * qolardi. Mavjud `article_revisions` jadvalida ham shu yondashuv.
   */
  is_autosave boolean not null default false,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  unique (article_id, revision)
);

create index if not exists idx_member_article_revisions_article
  on public.member_article_revisions (article_id, revision desc);

/* ====================================================================== *
 * 4. NASHR KANALLARI — §25
 *
 *    BITTA MAQOLA, BIR NECHA KANAL. Ikki nusxa maqola yaratilmaydi:
 *    AdabiyotX va Liderlar Online bitta yozuvning kanallari.
 *
 *    Kanal holati alohida, chunki biri nashr bo'lib ikkinchisi
 *    yiqilishi mumkin — §25 "never silently lose publication if
 *    AdabiyotX sync fails" deydi.
 * ====================================================================== */

create table if not exists public.member_article_channels (
  article_id uuid not null references public.member_articles(id) on delete cascade,

  channel text not null check (channel in ('liderlar_online', 'adabiyotx')),

  state text not null default 'pending' check (state in (
    'pending', 'synced', 'failed', 'disabled'
  )),

  /** Tashqi tizimdagi id — AdabiyotX uchun. */
  external_id text,
  external_url text,

  /*
   * NECHA MARTA URINILGAN.
   *
   * Qayta urinish vazifasi shu songa qaraydi: cheksiz urinish
   * yiqilgan integratsiyaga abadiy so'rov yuborib turardi.
   */
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  last_attempt_at timestamptz,

  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (article_id, channel)
);

-- Qayta urinish navbati (§73).
create index if not exists idx_member_article_channels_retry
  on public.member_article_channels (last_attempt_at)
  where state = 'failed';

drop trigger if exists trg_member_article_channels_updated on public.member_article_channels;
create trigger trg_member_article_channels_updated
  before update on public.member_article_channels
  for each row execute function public.set_updated_at();

comment on table public.member_article_channels is
  'Maqolaning nashr kanallari. Bitta kanonik maqola, bir necha kanal — '
  'nusxa maqola yaratilmaydi (§25).';

/* ====================================================================== *
 * 5. RLS
 * ====================================================================== */

alter table public.member_articles enable row level security;
alter table public.member_article_revisions enable row level security;
alter table public.member_article_channels enable row level security;

/*
 * OMMAVIY O'QISH: faqat nashr qilingan maqola va faqat nashr
 * qilingan nomzodning.
 *
 * Ikkinchi shart muhim: nomzod profili arxivlangan bo'lsa, uning
 * maqolasi muallifsiz havola bilan qolib ketardi.
 */
drop policy if exists "published member articles are public" on public.member_articles;
create policy "published member articles are public"
  on public.member_articles for select
  using (
    state = 'published'
    and exists (
      select 1 from public.candidates c
      where c.id = member_articles.candidate_id
        and c.status = 'published'
        and c.deleted_at is null
    )
  );

/* Muallif o'z maqolalarini hamma holatda ko'radi. */
drop policy if exists "own member articles" on public.member_articles;
create policy "own member articles"
  on public.member_articles for select
  using (
    exists (
      select 1 from public.candidates c
      where c.id = member_articles.candidate_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

drop policy if exists "editors read member articles" on public.member_articles;
create policy "editors read member articles"
  on public.member_articles for select
  using (public.has_permission('articles.view'));

/*
 * REVIZYALAR VA KANALLAR OMMAVIY EMAS.
 *
 * Revizyalarda nashr qilinmagan matn bor; kanal holatida esa ichki
 * nosozlik xabarlari (`last_error`) bo'ladi va ularni ommaga
 * ochishning sababi yo'q (§55).
 */
drop policy if exists "own article revisions" on public.member_article_revisions;
create policy "own article revisions"
  on public.member_article_revisions for select
  using (
    exists (
      select 1
      from public.member_articles a
      join public.candidates c on c.id = a.candidate_id
      where a.id = member_article_revisions.article_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "editors read article revisions" on public.member_article_revisions;
create policy "editors read article revisions"
  on public.member_article_revisions for select
  using (public.has_permission('articles.view'));

drop policy if exists "editors read article channels" on public.member_article_channels;
create policy "editors read article channels"
  on public.member_article_channels for select
  using (public.has_permission('articles.view'));

/*
 * YOZISH SIYOSATI HECH QAYERDA YO'Q.
 *
 * Muallif `state` ni 'published' qilib qo'ysa, tahririyat ko'rigini
 * butunlay chetlab o'tardi (§27, §43). Barcha yozish server orqali.
 */
