-- =========================================================================
-- TELEGRAM BOT — DAVOMLI SUHBAT HOLATI
--
-- §20: "Use proper Telegram state machine / durable conversation state.
-- Do not keep critical state only in server memory."
--
-- NEGA XOTIRA YARAMAYDI: bot serverless funksiyada ishlaydi. Har
-- webhook so'rovi YANGI nusxada bajarilishi mumkin, ya'ni xotiradagi
-- holat keyingi xabarga yetib bormaydi. Odam "Ta'lim qo'shish" ni
-- bosib, nomini yozsa, bot uni nima deb qabul qilishini bilmasdi.
--
-- MAVJUD BOT HOLATSIZ: har callback xabar chizadi va hech narsa
-- eslab qolmaydi. Bu menyular uchun yetarli, lekin "bosqichma-bosqich
-- ma'lumot kiritish" uchun emas.
--
-- FORWARD-ONLY.
-- =========================================================================

create table if not exists public.bot_conversations (
  /*
   * TELEGRAM FOYDALANUVCHI ID SI — BIRLAMCHI KALIT.
   *
   * `profile_id` emas: holat Telegram SUHBATIGA tegishli. Bitta odam
   * ikki akkauntdan yozmaydi, lekin bog'lanmagan foydalanuvchi ham
   * holatga ega bo'lishi mumkin (masalan bog'lash jarayonida).
   *
   * `bigint`: Telegram id lari 32-bitdan oshib ketgan.
   */
  telegram_user_id bigint primary key,

  /*
   * BOG'LANGAN PROFIL.
   *
   * Yozilgan bo'lsa, holat shu odamga tegishli. Tekshiruv har
   * qadamda qaytariladi: holat yaratilgandan keyin bog'lanish
   * uzilgan bo'lishi mumkin (§62 AB-bandi).
   */
  profile_id uuid references public.profiles(id) on delete cascade,

  /*
   * QADAM — bot nima kutayotgani.
   *
   * ERKIN MATN, `check (...)` emas: yangi oqim qo'shilganda
   * migratsiya kerak bo'lmasligi uchun. Haqiqiy ro'yxat kodda va u
   * yerda tiplar bilan qo'riqlanadi.
   */
  step text not null check (char_length(step) between 1 and 64),

  /*
   * YIG'ILAYOTGAN MA'LUMOT.
   *
   * Masalan ta'lim yozuvi: {"kind":"education","title":"...","date_from":"2015-09-01"}
   *
   * `jsonb` — chunki har oqimda boshqa maydonlar bo'ladi va ularni
   * ustun sifatida yozish har yangi oqim uchun migratsiya talab
   * qilardi.
   */
  draft jsonb not null default '{}'::jsonb,

  /*
   * OXIRGI BOT XABARI.
   *
   * Tugmalarni o'chirish yoki xabarni tahrirlash uchun kerak: yangi
   * savol berganda eskisining tugmalari qolib ketsa, odam ikki
   * savolga bir vaqtda javob berib yuborardi.
   */
  last_message_id bigint,

  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

drop trigger if exists trg_bot_conversations_updated on public.bot_conversations;
create trigger trg_bot_conversations_updated
  before update on public.bot_conversations
  for each row execute function public.set_updated_at();

/*
 * ESKIRGAN SUHBATLARNI TOZALASH INDEKSI.
 *
 * Yarim qolgan suhbat abadiy turmasligi kerak: odam bir hafta oldin
 * "nomini yozing" savolida to'xtab qolsa, bugun yozgan tasodifiy
 * xabari o'sha savolga javob deb qabul qilinardi.
 */
create index if not exists idx_bot_conversations_stale
  on public.bot_conversations (updated_at);

comment on table public.bot_conversations is
  'Telegram bot suhbatining davomli holati. Serverless muhitda '
  'xotira yetib bormaydi (§20).';

/* ====================================================================== *
 * RLS
 * ====================================================================== */

alter table public.bot_conversations enable row level security;

/*
 * SIYOSAT UMUMAN YO'Q — na o'qish, na yozish.
 *
 * Bu jadvalga FAQAT bot serveri (`service_role`) tegadi. Unda
 * yarim kiritilgan ma'lumot va Telegram id lari bor; ularni
 * foydalanuvchiga ochishning sababi yo'q.
 *
 * RLS yoqilgan va siyosatsiz jadvalda har qanday amal rad etiladi —
 * ya'ni bu "ruxsat yo'q" degani.
 */
