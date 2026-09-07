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
] as const;
export type PiiKind = (typeof PII_KINDS)[number];

export const PII_PLACEHOLDERS: Record<PiiKind, string> = {
  secret: "[maxfiy]",
  email: "[email]",
  account: "[hisob raqami]",
  card: "[karta raqami]",
  document: "[hujjat raqami]",
  phone: "[telefon]",
};

interface Rule {
  kind: PiiKind;
  pattern: RegExp;
  /** Moslikni to'liq emas, faqat qiymat qismini almashtirish uchun. */
  replace?: (match: string) => string;
  /** Yolg'on moslikni rad etadi (masalan "+5 000 000 so'm" — telefon emas). */
  guard?: (match: string) => boolean;
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
