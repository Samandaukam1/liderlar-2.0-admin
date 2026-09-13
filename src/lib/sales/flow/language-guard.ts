/**
 * FAQAT O'ZBEKCHA CHIQISH (7- va 8-band).
 *
 * MUAMMO VA UNING SABABI:
 *
 * AI ba'zan "Hi," yoki "Hello" deb boshlab qolardi. Sababi bitta emas,
 * uchta va ular bir-birini kuchaytirardi:
 *
 *   1. TIL AKS ETTIRISH. Mijoz xabari modelga `user` rolida boradi.
 *      Til modellari oxirgi navbat tilini aks ettirishga juda kuchli
 *      moyil: "hi" kelsa "Hi" qaytadi. Bu moyillik promtdagi bitta
 *      jumladan ancha kuchli.
 *   2. QOIDANING O'RNI. "O'zbek tilida yoz" qoidalar ro'yxatining
 *      OXIRGI bandi edi — eng kam e'tibor beriladigan joy.
 *   3. CHIQISHDA TEKSHIRUV YO'Q. Yaratilgan matn hech kim tomonidan
 *      ko'rilmasdan Telegram'ga ketardi.
 *
 * Bu modul UCHINCHI sababni yopadi: matn yuborilishidan oldin
 * tekshiriladi. Birinchi ikkisi promt tomonida tuzatilgan.
 *
 * ATOQLI OTLAR MUAMMOSI: "Google", "Instagram", "Wikipedia",
 * "Recommendation Letter" — bular o'zbekcha matnda BO'LISHI KERAK.
 * Ularni inglizcha deb hisoblash foydali javoblarni bloklardi.
 *
 * SOF MODUL.
 */

/**
 * O'zbekcha matnda uchrashi TABIIY bo'lgan nomlar.
 *
 * Ro'yxat texnik topshiriqdan olingan va kengaytirilgan. Ular
 * tekshiruvdan OLDIN matndan olib tashlanadi, ya'ni "Google'da
 * chiqasiz" jumlasi inglizcha deb hisoblanmaydi.
 */
export const ALLOWED_PROPER_NOUNS: readonly string[] = [
  "Google", "Yandex", "Bing", "ChatGPT", "Gemini", "Copilot", "Claude",
  "Instagram", "Facebook", "TikTok", "YouTube", "Telegram", "Wikipedia",
  "AdabiyotX", "Project Found", "Recommendation Letter", "Liderlar",
  "liderlar.uz", "Mukammal Media Group", "MChJ", "PDF", "SMM", "AI",
  "Click", "Payme", "Uzum", "Humo", "Visa", "Mastercard", "CV",
];

/**
 * Inglizcha salomlashish — eng ko'p uchraydigan va eng ko'zga
 * tashlanadigan buzilish. Alohida tekshiriladi, chunki u xabarning
 * BOSHIDA turadi va mijoz uni birinchi o'qiydi.
 */
const ENGLISH_GREETINGS: readonly RegExp[] = [
  /^\s*hi\b/i,
  /^\s*hey\b/i,
  /^\s*hello\b/i,
  /^\s*good\s+(morning|afternoon|evening|day)\b/i,
  /^\s*dear\b/i,
  /^\s*greetings\b/i,
  /^\s*welcome\b/i,
];

/**
 * Ingliz tiliga xos, o'zbekchada umuman uchramaydigan so'zlar.
 *
 * RO'YXAT ATAYLAB QISQA VA ANIQ. Keng ro'yxat noto'g'ri ishlaydi:
 * masalan "in" o'zbekcha so'zlarning ichida ham uchraydi, "on" esa
 * "onam" ning bir qismi. Bu yerda faqat butun so'z sifatida
 * uchraganda inglizcha ekani SHUBHASIZ bo'lgan so'zlar turadi.
 */
const ENGLISH_MARKERS: readonly string[] = [
  "the", "and", "you", "your", "our", "we", "is", "are", "was", "were",
  "will", "would", "can", "could", "should", "have", "has", "with",
  "for", "from", "this", "that", "there", "here", "please", "thank",
  "thanks", "sorry", "hello", "regards", "best", "sincerely", "kindly",
  "let", "know", "about", "more", "any", "questions", "help", "information",
];

/** Ruscha matn — u ham chiqishda taqiqlanadi (standart til o'zbekcha). */
const RUSSIAN_MARKERS: readonly string[] = [
  "здравствуйте", "привет", "спасибо", "пожалуйста", "добрый",
  "вы", "ваш", "наш", "это", "который", "можно", "нужно",
];

export const LANGUAGE_VIOLATIONS = [
  "english_greeting",
  "english_body",
  "russian_body",
] as const;
export type LanguageViolation = (typeof LANGUAGE_VIOLATIONS)[number];

export const LANGUAGE_VIOLATION_LABELS: Record<LanguageViolation, string> = {
  english_greeting: "Inglizcha salomlashish",
  english_body: "Matn inglizcha",
  russian_body: "Matn ruscha",
};

export interface LanguageCheckResult {
  ok: boolean;
  violations: LanguageViolation[];
  /** Qaysi so'zlar shubha uyg'otdi — diagnostikada ko'rsatiladi. */
  markers: string[];
}

/** Atoqli otlarni matndan olib tashlaydi — ular tekshiruvga qatnashmaydi. */
function stripProperNouns(text: string): string {
  let result = text;
  for (const noun of ALLOWED_PROPER_NOUNS) {
    const escaped = noun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), " ");
  }
  return result;
}

function wordCount(haystack: string, words: readonly string[]): string[] {
  const found: string[] = [];
  for (const word of words) {
    if (new RegExp(`(?:^|[^\\p{L}])${word}(?:[^\\p{L}]|$)`, "iu").test(haystack)) {
      found.push(word);
    }
  }
  return found;
}

/**
 * Chiqadigan matn o'zbekchami.
 *
 * CHEGARA — IKKI SO'Z. Bitta inglizcha so'z tasodifiy bo'lishi mumkin
 * (iqtibos, xizmat nomi), ikkitasi esa allaqachon jumla. Salomlashish
 * uchun chegara YO'Q: bitta "Hi" ham yetarli, chunki u xabarning
 * birinchi so'zi va mijoz uni birinchi ko'radi.
 */
export function checkOutboundLanguage(text: string): LanguageCheckResult {
  const violations: LanguageViolation[] = [];
  const markers: string[] = [];

  const body = (text ?? "").trim();
  if (body === "") return { ok: true, violations, markers };

  for (const pattern of ENGLISH_GREETINGS) {
    if (pattern.test(body)) {
      violations.push("english_greeting");
      break;
    }
  }

  const stripped = stripProperNouns(body);

  const english = wordCount(stripped, ENGLISH_MARKERS);
  if (english.length >= 2) {
    violations.push("english_body");
    markers.push(...english.slice(0, 5));
  }

  const russian = wordCount(stripped, RUSSIAN_MARKERS);
  if (russian.length >= 2) {
    violations.push("russian_body");
    markers.push(...russian.slice(0, 5));
  }

  return { ok: violations.length === 0, violations, markers };
}

/**
 * O'rgangan salomlashuvlardan inglizchasini chiqarib tashlaydi.
 *
 * NEGA KERAK: uslub profili real yozishmalardan salomlashuv
 * namunalarini oladi. Admin bir marta "Hi" deb yozgan bo'lsa, u
 * namuna sifatida tushadi va promt modelga AYNAN inglizcha
 * salomlashishni BUYURARDI. Ya'ni o'rganish tizimining o'zi
 * muammoni kuchaytirardi.
 */
export function isUzbekGreeting(phrase: string): boolean {
  const value = phrase.trim();
  if (value === "") return false;
  return !ENGLISH_GREETINGS.some((pattern) => pattern.test(value));
}

/**
 * Mijoz inglizcha yozganda ham javob o'zbekcha bo'lishi kerakligini
 * modelga ALOHIDA aytadigan ko'rsatma.
 *
 * Oddiy "o'zbek tilida yoz" yetarli emas edi: model oxirgi navbat
 * tilini aks ettirishga moyil va bu moyillik umumiy qoidadan
 * kuchliroq. Shuning uchun aynan shu holat nomma-nom aytiladi.
 */
export const UZBEK_ONLY_RULE = [
  "TIL: FAQAT O‘ZBEK TILIDA (lotin yozuvida) yoz. Bu eng muhim qoida.",
  "Mijoz ingliz yoki rus tilida yozsa HAM, javobing o‘zbekcha bo‘ladi.",
  "“Hi”, “Hello”, “Hey”, “Dear”, “Здравствуйте” kabi so‘zlar bilan BOSHLAMA —",
  "o‘rniga “Assalomu alaykum” yoki kontekstga mos o‘zbekcha murojaat ishlat.",
  "Google, Instagram, Wikipedia, ChatGPT kabi nomlar o‘z holicha yoziladi —",
  "ular inglizcha so‘z emas, xizmat nomi.",
].join(" ");
