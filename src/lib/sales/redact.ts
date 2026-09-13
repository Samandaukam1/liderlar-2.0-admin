/**
 * PII redaksiyasi — bilim bazasiga chiqadigan har bir matn shu yerdan o'tadi.
 *
 * QAYERDA ISHLAYDI: AI'ga transkript yuborishdan OLDIN va bilim yozuvini
 * saqlashdan oldin. Xom `sales_messages` matni redaksiya qilinmaydi — u
 * suhbatning o'zi va faqat admin ko'radi (RLS). Talab aynan shunday:
 * "Raw conversation faqat admin ko'rsin".
 *
 * TARTIB MUHIM. Qoidalar ro'yxatdagi tartibda qo'llanadi:
 *   1) sir/token — eng o'ziga xos shakl, boshqasi uni bo'lib yubormasin;
 *   2) email     — ichida raqam bo'lishi mumkin, telefon qoidasidan oldin;
 *   3) uzun raqam bloklari (hisob 20 -> karta 16 -> JSHSHIR 14);
 *   4) telefon;
 *   5) hujjat seriyasi.
 *
 * NEGA NARX MASKALANMAYDI: "500 000 so'm" — sotuv fakti, bizga aynan shu
 * kerak. Shuning uchun telefon qoidalari operator kodini talab qiladi va
 * ixtiyoriy 6–7 xonali raqam guruhini ushlamaydi.
 */

export const PII_KINDS = [
  "secret",
  "email",
  "account",
  "card",
  "document",
  "phone",
  /* --- 2-faza (8, 32 va 33-band) --- */
  "intake_link",
  "telegram_id",
  "telegram_username",
] as const;
export type PiiKind = (typeof PII_KINDS)[number];

export const PII_PLACEHOLDERS: Record<PiiKind, string> = {
  secret: "[maxfiy]",
  email: "[email]",
  account: "[hisob raqami]",
  card: "[karta raqami]",
  document: "[hujjat raqami]",
  phone: "[telefon]",
  intake_link: "[anketa havolasi]",
  telegram_id: "[telegram id]",
  telegram_username: "[telegram foydalanuvchi]",
};

interface Rule {
  kind: PiiKind;
  pattern: RegExp;
  /** Moslikni to'liq emas, faqat qiymat qismini almashtirish uchun. */
  replace?: (match: string) => string;
  /** Yolg'on moslikni rad etadi (masalan "+5 000 000 so'm" — telefon emas). */
  guard?: (match: string) => boolean;
}

/**
 * Moslik ichida ALLAQACHON qo'yilgan o'rin egasi bormi.
 *
 * Ba'zi qoidalar `label: qiymat` shaklini almashtiradi va natija
 * (`token: [maxfiy]`) o'sha qoidaga qayta tushadi. Tekshirmasak,
 * redaksiyadan o'tgan matn ham "PII bor" deb baholanardi.
 */
function isPlaceholder(match: string): boolean {
  return Object.values(PII_PLACEHOLDERS).some((placeholder) => match.includes(placeholder));
}

/** Moslikdagi raqamlar soni — telefon uzunligini tekshirish uchun. */
function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/** O'zbekiston mobil va shahar operator kodlari — 9 xonali raqamning boshi. */
const OPERATOR_CODES = "9\\d|33|55|77|88|20|71|61|62|65|66|67|69|70|72|73|74|75|76|78|79";

const RULES: Rule[] = [
  // --- 1. Sirlar ---
  // Telegram bot tokeni: 1234567890:AA...
  { kind: "secret", pattern: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g },
  // JWT
  { kind: "secret", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // OpenAI/Stripe uslubidagi kalitlar
  { kind: "secret", pattern: /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g },
  // "token: ...", "parol = ..." — qiymat butunlay olib tashlanadi.
  // Ajratgich (`:` yoki `=`) MAJBURIY: usiz "parol yangilandi" kabi oddiy
  // gap ham sir deb hisoblanib, foydali bilim yo'q qilinardi.
  {
    kind: "secret",
    pattern: /\b(token|secret|password|parol|api[_-]?key|apikey|kalit)\b\s*[:=]\s*\S{4,}/gi,
    replace: (match) => `${match.split(/[\s:=]/)[0]}: ${PII_PLACEHOLDERS.secret}`,
    // O'Z NATIJASINI QAYTA USHLAMASIN. `token: [maxfiy]` ham shu
    // naqshga to'g'ri keladi, ya'ni redaksiyadan o'tgan matn
    // "hali ham PII bor" deb baholanardi va `isRedacted()` doim
    // `false` qaytarardi — bilim yozuvi umuman saqlanmasdi.
    guard: (match) => !isPlaceholder(match),
  },
  // Uzun hex — imzo, xesh, sessiya identifikatori.
  { kind: "secret", pattern: /\b[A-Fa-f0-9]{32,}\b/g },

  // --- 2. Email ---
  { kind: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]{2,}/g },

  // --- 3. Raqam bloklari (uzundan qisqaga) ---
  // Bank hisob raqami (20 xona).
  { kind: "account", pattern: /(?<!\d)\d{20}(?!\d)/g },
  // Karta (16 xona, guruhlangan yoki yaxlit) — chek rekvizitining o'zagi.
  { kind: "card", pattern: /(?<!\d)\d{4}[ \-]?\d{4}[ \-]?\d{4}[ \-]?\d{4}(?!\d)/g },
  // JSHSHIR / PINFL (14 xona).
  { kind: "document", pattern: /(?<!\d)\d{14}(?!\d)/g },

  /*
   * --- 3b. BELGILANGAN TELEGRAM IDENTIFIKATORI ---
   *
   * TELEFON QOIDALARIDAN OLDIN turishi SHART. Telegram
   * identifikatori odatda 9–10 xonali va ko'pi "9" bilan
   * boshlanadi — ya'ni u O'zbekiston operator kodi naqshiga
   * to'g'ri keladi va telefon deb maskalanardi. Natijada
   * `telegram_id` toifasi hech qachon ishlamasdi.
   *
   * Yorliq (`telegram id:`) talab qilinadi: usiz yalang son
   * narx ham bo'lishi mumkin.
   */
  {
    kind: "telegram_id",
    pattern: /\b(telegram\s*id|chat\s*id|user\s*id)\b\s*[:=]?\s*\d{5,}/gi,
    replace: (match) => {
      const label = match.match(/^[A-Za-z\s]+/)?.[0]?.trim() ?? "id";
      return `${label}: ${PII_PLACEHOLDERS.telegram_id}`;
    },
  },

  // --- 4. Telefon ---
  // +998 XX XXX XX XX (ajratgichlar ixtiyoriy).
  {
    kind: "phone",
    pattern: /(?<![\d])\+?\s?998[ \-().]*\d{2}[ \-().]*\d{3}[ \-().]*\d{2}[ \-().]*\d{2}(?!\d)/g,
  },
  // Ichki format: operator kodi + 7 xona. Kod talab qilinishi narxni
  // ("990 000 so'm") telefon deb ushlab qolishning oldini oladi.
  {
    kind: "phone",
    pattern: new RegExp(`(?<![\\d+])(?:${OPERATOR_CODES})[ \\-]?\\d{3}[ \\-]?\\d{2}[ \\-]?\\d{2}(?!\\d)`, "g"),
  },
  // Boshqa davlat raqami: + bilan boshlanadigan blok. `guard` 10–15 xonani
  // talab qiladi — "+5 000 000 so'm" (7 xona) telefon deb belgilanmaydi.
  {
    kind: "phone",
    pattern: /\+\d[\d \-().]{7,16}\d/g,
    guard: (match) => digitCount(match) >= 10 && digitCount(match) <= 15,
  },

  // --- 5. Hujjat seriyasi: AA1234567 ---
  { kind: "document", pattern: /\b[A-Z]{2}[ \-]?\d{7}\b/g },

  /* ==================== 2-FAZA QO'SHIMCHALARI ====================== */

  /*
   * --- 6. ANKETA HAVOLASI (33-band) ---
   *
   * `https://.../anketa/<32 bayt base64url>` — bu BIR MARTALIK
   * KIRISH KALITI. Kim havolani ko'rsa, o'sha mijozning anketasini
   * ochadi. Auditda aniqlangan: `send(intakeLink)` matni
   * `sales_outbound_log.body` ga xom holda yozilardi, ya'ni kalit
   * keng o'qiladigan jurnalda qolardi.
   *
   * Havolaning O'ZI o'chirilmaydi — yo'l saqlanadi, faqat TOKEN
   * almashtiriladi. Shunda admin qaysi havola ekanini ko'radi,
   * lekin uni ISHLATA OLMAYDI.
   */
  {
    kind: "intake_link",
    pattern: /(https?:\/\/[^\s/]+\/(?:anketa|intake)\/)[A-Za-z0-9_-]{16,}/gi,
    replace: (match) => {
      const base = match.match(/^https?:\/\/[^\s/]+\/(?:anketa|intake)\//i)?.[0] ?? "";
      return `${base}${PII_PLACEHOLDERS.intake_link}`;
    },
  },
  // Bearer token URL ichida (`?token=...`, `&access_token=...`).
  {
    kind: "secret",
    pattern: /([?&](?:token|access_token|key|secret|auth)=)[A-Za-z0-9._~-]{12,}/gi,
    replace: (match) => {
      const prefix = match.match(/^[?&][A-Za-z_]+=/)?.[0] ?? "";
      return `${prefix}${PII_PLACEHOLDERS.secret}`;
    },
    guard: (match) => !isPlaceholder(match),
  },

  /*
   * --- 7. TELEGRAM IDENTIFIKATORI ---
   *
   * FAQAT TELEGRAM KONTEKSTIDA. Yalang 9–10 xonali son narx
   * ham bo'lishi mumkin ("100 000 000 so'm"), shuning uchun
   * qoida `tg://user?id=` yoki "telegram id" kabi ANIQ belgini
   * talab qiladi. Belgisiz sonni ushlash biznes faktini
   * buzardi.
   */
  {
    kind: "telegram_id",
    pattern: /tg:\/\/user\?id=\d{5,}/gi,
  },
  // t.me havolasi — foydalanuvchi nomini ochadi.
  { kind: "telegram_username", pattern: /\b(?:https?:\/\/)?t\.me\/[A-Za-z0-9_]{4,}/gi },

  /*
   * --- 8. @foydalanuvchi ---
   *
   * Eng oxirida: `@` bilan boshlangan blok email qoidasidan
   * keyin turishi SHART, aks holda "ism@domen.uz" ning
   * domen qismi foydalanuvchi nomi deb olinardi.
   *
   * Telegram nomi kamida 5 belgi bo'ladi; qisqa `@` bloklari
   * (masalan `@1`) qoidaga tushmaydi.
   */
  { kind: "telegram_username", pattern: /(?<![\w.])@[A-Za-z][A-Za-z0-9_]{4,31}\b/g },
];

export interface RedactionResult {
  text: string;
  /** Topilgan toifalar — audit va testlar uchun. Matnning o'zi qaytmaydi. */
  kinds: PiiKind[];
}

/**
 * Matndan shaxsiy va maxfiy ma'lumotni olib tashlaydi.
 * Bo'sh/undefined kirish bo'sh natija beradi — chaqiruvchi tekshirmasin.
 */
export function redactPii(input: string | null | undefined): RedactionResult {
  if (!input) return { text: "", kinds: [] };

  let text = input;
  const kinds = new Set<PiiKind>();

  for (const rule of RULES) {
    // Har qoida uchun yangi RegExp: global lastIndex holati saqlanib qolmaydi.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    text = text.replace(pattern, (match) => {
      if (rule.guard && !rule.guard(match)) return match;
      kinds.add(rule.kind);
      return rule.replace ? rule.replace(match) : PII_PLACEHOLDERS[rule.kind];
    });
  }

  return { text, kinds: [...kinds] };
}

/** Matnda redaksiya qilinadigan narsa bormi. */
export function containsPii(input: string | null | undefined): boolean {
  return redactPii(input).kinds.length > 0;
}

/**
 * Redaksiya izi qolganini tekshiradi — bilim yozuvini saqlashdan oldingi
 * oxirgi to'siq. `redactPii` dan keyin ham xom telefon qolgan bo'lsa, bu
 * qoidada teshik bor degani va yozuv saqlanmaydi.
 */
export function isRedacted(input: string | null | undefined): boolean {
  return !containsPii(input);
}
