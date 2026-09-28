-- =========================================================================
-- PROMO KODLAR REYESTRI VA AMAL QILISH MUDDATI
--
-- MAQSAD: promo kodlar admin panelda ro'yxatga olinadi va ularning
-- amal qilish muddatini tugatish mumkin bo'ladi. Muddati tugagan
-- kodni nomzod arizada yozsa, forma uni qabul qilmaydi va sababini
-- aytadi.
--
-- NEGA `coordinators.promo_code` DAN ALOHIDA: u yerdagi kod LID
-- MARSHRUTI uchun — "bu nomzod kimning odami". Bu yerdagi reyestr
-- esa AMAL QILISH haqida — "bu kod hali ishlaydimi". Ikkalasini
-- bitta ustunga tiqish koordinatorning kodini muddati tugagani
-- uchun o'chirishga majbur qilardi va lid marshruti buzilardi.
--
-- Koordinatorning kodi ham shu yerga qo'shilishi mumkin: u holda
-- `coordinator_id` to'ldiriladi va ikkovi bog'lanadi.
--
-- FORWARD-ONLY.
-- =========================================================================

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),

  -- NORMALLASHTIRILGAN SHAKL — solishtirish shu ustun bo'yicha.
  -- Bo'shliq, tire, ostki chiziq va nuqta olib tashlangan, bosh
  -- harfda. "TSUL-TAVSIYA" va "tsul tavsiya" bitta qatorga tushadi.
  code text not null check (char_length(code) between 1 and 64),

  -- Admin AYNAN qanday yozgani — panelda shu ko'rinadi.
  raw_code text not null,

  -- Nima uchun berilgan: kampaniya nomi, tashkilot va h.k.
  label text,

  -- MUDDAT. `null` — muddatsiz. To'ldirilgan va o'tib ketgan
  -- bo'lsa, kod amal qilmaydi. Sana ishlatilgani ataylab:
  -- shunchaki bayroq bo'lsa, "ertaga tugasin" deb belgilab
  -- bo'lmasdi.
  expires_at timestamptz,

  is_active boolean not null default true,
  notes text,

  coordinator_id uuid references public.coordinators(id) on delete set null,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- BITTA KOD — BITTA FAOL QATOR. Faolsiz qatorning kodi qayta
-- ishlatilishi mumkin: eski kampaniya nomini keyin qayta ochish
-- odatiy ish.
create unique index if not exists uq_promo_codes_active
  on public.promo_codes (code) where is_active;

create index if not exists idx_promo_codes_expiry
  on public.promo_codes (expires_at) where is_active;

drop trigger if exists trg_promo_codes_updated on public.promo_codes;
create trigger trg_promo_codes_updated
  before update on public.promo_codes
  for each row execute function public.set_updated_at();

alter table public.promo_codes enable row level security;

-- O'QISH OMMAVIY EMAS, LEKIN ANONIM ROLGA KERAK: ariza formasi
-- kodni tekshiradi va u imzosiz so'rov. Faqat MUDDATI TUGAGAN
-- kodlar ko'rinadi — "qaysi kodlar ishlayapti" degan ro'yxat
-- marketing ma'lumoti va uni ochiq qoldirishning sababi yo'q.
--
-- Yozish siyosati YO'Q: qatorlar faqat service_role orqali
-- (admin panel serveri) o'zgaradi.
drop policy if exists "expired promo codes are readable" on public.promo_codes;
create policy "expired promo codes are readable"
  on public.promo_codes for select
  using (is_active and expires_at is not null and expires_at <= now());

comment on table public.promo_codes is
  'Promo kodlar reyestri va amal qilish muddati. Lid marshruti uchun emas.';
