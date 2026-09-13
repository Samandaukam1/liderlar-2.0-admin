/**
 * MIJOZ SAVOLLARINI QAZISH — SOF MODUL.
 *
 * TALAB (12-band): FAQ o'ylab topilmasin. Har bir savol REAL
 * saqlangan xabardan chiqsin va nechta mijoz so'ragani halol
 * sanalsin.
 *
 * NEGA QOIDALAR, MODEL EMAS:
 *   · 8 845 kiruvchi xabarni modelga yuborish qimmat va sekin;
 *   · model bir xil savolga har safar boshqa nom berishi mumkin,
 *     u holda klaster buziladi;
 *   · qoida DETERMINISTIK — test bugun ham, bir yildan keyin ham
 *     bir xil natija beradi.
 *
 * Model keyingi bosqichda (noma'lum savollarni nomlashda) ishlatiladi,
 * lekin SANOQ har doim shu yerdagi deterministik qoidadan chiqadi.
 */

import { normalizeForIntent, normalizeForMatch } from "../text-normalize.ts";

/* ------------------------------- turlari -------------------------------- */

export const QUESTION_KINDS = [
  "question",
  "implied",
  "objection",
  "confusion",
  "technical_problem",
  "trust",
  "service",
  "post_sale",
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  question: "To‘g‘ridan-to‘g‘ri savol",
  implied: "Yashirin savol",
  objection: "E’tiroz",
  confusion: "Tushunmovchilik",
  technical_problem: "Texnik muammo",
  trust: "Ishonch savoli",
  service: "Xizmat savoli",
  post_sale: "Sotuvdan keyingi savol",
};

export interface QuestionIntent {
  key: string;
  label: string;
  kind: QuestionKind;
  category: string;
}

interface IntentRule extends QuestionIntent {
  /**
   * Naqshlar. TARTIB MUHIM: ro'yxatdagi BIRINCHI mos keluvchi qoida
   * g'olib bo'ladi, shuning uchun aniqroq qoida yuqorida turadi.
   */
  patterns: readonly RegExp[];
}

/* ---------------------------- niyat lug'ati ----------------------------- */

/**
 * QOIDA: YAQIN, LEKIN BOSHQA SAVOL — BOSHQA KALIT (13-band).
 *
 * "Sertifikat berasizmi?" — xizmat tarkibi haqida savol.
 * "Sertifikat qachon keladi?" — allaqachon sotib olgan mijozning
 * yetkazib berish holati haqidagi savoli.
 *
 * Ularni bitta "sertifikat" klasteriga qo'shish eng zararli
 * xato bo'lardi: bot birinchisiga "qachon keladi" javobini,
 * ikkinchisiga "ha, beriladi" javobini berardi. Shuning uchun
 * HOLAT savollari (`_status`) MAVJUDLIK savollaridan
 * (`_availability`) qat'iy ajratilgan.
 *
 * Xuddi shu sabab bilan to'lov ham to'rtga bo'lingan:
 * usul / jami summa / chek / tasdiq.
 */
const INTENT_RULES: readonly IntentRule[] = [
  /* ---------- TO'LOV: to'rt xil savol, to'rt xil javob ---------- */
  {
    key: "payment_method",
    label: "To‘lovni qanday qilaman",
    kind: "question",
    category: "payment",
    patterns: [
      /\bqanday\s+to['’ʻ]?la/i,
      /\bqanaqa\s+to['’ʻ]?la/i,
      /\bto['’ʻ]?lovni\s+qanday\b/i,
      /\bto['’ʻ]?lov\s+qanaqa\b/i,
      /\bqa(y|)erga\s+(to['’ʻ]?la|tasha|pul)/i,
      /\bqa(t|y)ga\s+ta(sh|shl)a/i,
      /\bkarta\s+raqam/i,
      /\bkarta\s+raqami?\b/i,
      /\bqaysi\s+kartaga\b/i,
      /\bpulni\s+qanday\b/i,
      /\bpulni\s+qa(y|t)erga\b/i,
      /\bhisob\s+raqam/i,
    ],
  },
  {
    key: "payment_total",
    label: "Jami qancha to‘layman",
    kind: "question",
    category: "payment",
    patterns: [
      /\bboshqa\s+to['’ʻ]?lov\s+yo['’ʻ]?q/i,
      /\bqo['’ʻ]?shimcha\s+to['’ʻ]?lov/i,
      /\byana\s+to['’ʻ]?lov\s+bormi/i,
      /\bjami\s+qancha\b/i,
      /\bhammasi\s+bo['’ʻ]?lib\s+qancha\b/i,
      /\bbo['’ʻ]?ldimi\b.*\bto['’ʻ]?lov/i,
    ],
  },
  {
    key: "payment_evidence",
    label: "Chekni qayerga yuboraman",
    kind: "question",
    category: "payment",
    patterns: [
      /\bchekni\s+(qa(y|t)erga|kimga|sizga)/i,
      /\bchek\s+yubor(aymi|ayinmi|sammi)/i,
      /\bskrinshot\s+yubor/i,
      /\bkvitansiya/i,
    ],
  },
  {
    key: "payment_confirmation",
    label: "To‘lovim tushdimi",
    kind: "post_sale",
    category: "payment",
    patterns: [
      /\bto['’ʻ]?lov(im)?\s+(tushdimi|keldimi|bordimi|qabul qilindimi)/i,
      /\bpulim\s+(tushdimi|bordimi|keldimi)/i,
      /\bchek(im)?\s+(bordimi|keldimi|yetdimi|tushdimi)/i,
      /\btasdiqlandimi\b/i,
    ],
  },
  {
    key: "installment",
    label: "Bo‘lib to‘lasa bo‘ladimi",
    kind: "question",
    category: "payment",
    patterns: [/\bbo['’ʻ]?lib\s+to['’ʻ]?la/i, /\bqismlarga\s+bo['’ʻ]?l/i, /\brassrochka/i],
  },

  /* ---------- NARX ---------- */
  {
    key: "price_amount",
    label: "Narxi qancha",
    kind: "question",
    category: "price",
    patterns: [
      /\bnarxi\s+(qancha|nech)/i,
      /\bqancha\s+turadi\b/i,
      /\bnech(a|i)\s+pul\b/i,
      /\bqancha\s+bo['’ʻ]?ladi\b/i,
      /\bnarxi?\??$/i,
      /\bqanchadan\b/i,
    ],
  },
  {
    key: "discount_validity",
    label: "Chegirma qachongacha",
    kind: "question",
    category: "price",
    patterns: [
      /\bchegirma\s+(amaldami|qachon|bormi|tugadimi)/i,
      /\baksiya\s+(qachon|amaldami|bormi)/i,
      /\bhali\s+chegirma/i,
      /\bqachongacha\b/i,
    ],
  },
  {
    key: "why_paid",
    label: "Nega pullik / pul qayerga ketadi",
    kind: "objection",
    category: "price",
    patterns: [
      /\bnega\s+pullik\b/i,
      /\bnimaga\s+pul\b/i,
      /\bpul\s+qa(y|t)erga\s+ketadi\b/i,
      /\bsizlarga\s+nima\s+foyda\b/i,
      /\bbepul\s+emasmi\b/i,
      /\btekin\s+emasmi\b/i,
      /\bbepul\s+deb\s+o['’ʻ]?yla/i,
    ],
  },

  /* ---------- SERTIFIKAT: mavjudlik va holat ALOHIDA ---------- */
  {
    key: "certificate_availability",
    label: "Sertifikat beriladimi",
    kind: "question",
    category: "service",
    patterns: [
      /\bsertifikat\s+(ham\s+)?(beriladimi|berasizmi|bormi|chiqadimi)/i,
      /\bguvohnoma\s+(bormi|beriladimi)/i,
    ],
  },
  {
    key: "certificate_status",
    label: "Sertifikat qachon keladi",
    kind: "post_sale",
    category: "service",
    patterns: [
      /\bsertifikat(im|ni)?\s+(qachon|qani|tayyormi|keldimi|yubor)/i,
      /\bsertifikat\s+qachon\s+beriladi/i,
    ],
  },
  {
    key: "certificate_value",
    label: "Sertifikat nimaga yaraydi",
    kind: "objection",
    category: "service",
    patterns: [
      /\bsertifikat\s+(nima\s+beradi|foydasi|nimaga\s+kerak|yordam\s+beradimi)/i,
      /\bsertifikat.*\bgrant/i,
      /\bgrantga\s+o['’ʻ]?tsam/i,
      /\bkontraktdan\s+grantga/i,
    ],
  },

  /* ---------- NASHR: mavjudlik va holat ALOHIDA ---------- */
  {
    key: "publication_status",
    label: "Maqolam qachon chiqadi",
    kind: "post_sale",
    category: "publication",
    patterns: [
      /\bqachon\s+chiqadi\b/i,
      /\btayyor\s+bo['’ʻ]?ldimi\b/i,
      /\btayyormi\b/i,
      /\bnech(a|i)\s+kun\s+kutamiz?\b/i,
      /\bchiqdimi\b/i,
      /\bbo['’ʻ]?ldimi\s+maqola/i,
    ],
  },
  {
    key: "publication_place",
    label: "Qayerda chiqadi",
    kind: "question",
    category: "publication",
    patterns: [
      /\bqa(y|t)erda\s+(chiqadi|joylanadi|e['’ʻ]?lon)/i,
      /\bqaysi\s+saytda\b/i,
      /\bqa(y|t)erga\s+chiqadi\b/i,
    ],
  },
  {
    key: "article_authorship",
    label: "Maqolani kim yozadi",
    kind: "question",
    category: "service",
    patterns: [
      /\bmaqolani\s+kim\s+yoz/i,
      /\bmaqola\s+yoz(asizlarmi|asizmi|ib\s+berasizmi)/i,
      /\bmaqola\s+yozolmayman\b/i,
      /\bo['’ʻ]?zim\s+yozamanmi\b/i,
      /\bmen\s+maqola\s+ber/i,
    ],
  },

  /* ---------- ANKETA / JARAYON ---------- */
  {
    key: "next_step",
    label: "Endi nima qilaman",
    kind: "question",
    category: "process",
    patterns: [
      /\bendi\s+nima\s+(qil|bo['’ʻ]?l)/i,
      /\bnima\s+qil(ishim|sam)\s+ke(rak|k)/i,
      /\bnima\s+qile?\s+eni\b/i,
      /\bнима\s+килишим\s+керак/i,
      /\bkeyingi\s+qadam\b/i,
    ],
  },
  {
    key: "intake_problem",
    label: "Anketa ishlamayapti",
    kind: "technical_problem",
    category: "intake",
    patterns: [
      /\banketa.*\b(saqlanmayapti|ishlamayapti|ochilmayapti|qabul qilmadi)/i,
      /\bhech\s+saqlanmayapti\b/i,
      /\btasdiqlash\s+bossam\b/i,
      /\bhavola\s+(ishlamayapti|ochilmayapti|eskirgan)/i,
      /\blink\s+(ishlamayapti|ochilmayapti|eskirgan|tugagan)/i,
    ],
  },
  {
    key: "intake_status",
    label: "Anketam yetib bordimi",
    kind: "post_sale",
    category: "intake",
    patterns: [
      /\banketa(m|ni)?\s+(yubordim|to['’ʻ]?ldirdim).*\b(bordimi|keldimi|bo['’ʻ]?ldimi)/i,
      /\banketa\s+(keldimi|bordimi|tushdimi)/i,
    ],
  },

  /* ---------- RASM: uch xil muammo, uch xil javob ---------- */
  {
    key: "photo_requirement",
    label: "Qanday rasm kerak",
    kind: "question",
    category: "photo",
    patterns: [
      /\bqanday\s+rasm\b/i,
      /\b3\s*[x×]\s*4\b/i,
      /\brasm\s+qanaqa\b/i,
      /\bqanaqa\s+surat\b/i,
      /\brasm\s+bo['’ʻ]?lishi\s+kerakmi\b/i,
    ],
  },
  {
    key: "photo_technical",
    label: "Rasmni tayyorlay olmayapman",
    kind: "technical_problem",
    category: "photo",
    patterns: [
      /\brasmni\s+(tahrirlay|tayyorlay|yuklay)\s+olmayapman/i,
      /\bgemini\s+qilib\s+bermayapti/i,
      /\brasm\s+yuklanmayapti\b/i,
      /\bsurat\s+ketmayapti\b/i,
    ],
  },
  {
    key: "photo_likeness",
    label: "Rasm o‘xshamadi",
    kind: "post_sale",
    category: "photo",
    patterns: [
      /\brasm(im)?\s+o['’ʻ]?xsha(ma|b)/i,
      /\byuz(im|ini)?\s+o['’ʻ]?zgar/i,
      /\bюзими\s+o?згарт/i,
      /\bo['’ʻ]?zgartirib\s+yubor/i,
      /\bbu\s+men\s+emas\b/i,
    ],
  },
  {
    key: "photo_privacy",
    label: "Rasmim hammaga ko‘rinadimi",
    kind: "trust",
    category: "photo",
    patterns: [
      /\brasmimni\s+yubora\s*olmayman\b/i,
      /\bhammaga\s+.*\brasmimni\b/i,
      /\brasm(im)?\s+.*\bmaxfiy/i,
      /\brasmim\s+qa(y|t)erda\s+ishlatiladi/i,
    ],
  },

  /* ---------- ISHONCH / TASHKILOT ---------- */
  {
    key: "organization_official",
    label: "Rasmiy tashkilotmisiz",
    kind: "trust",
    category: "trust",
    patterns: [
      /\bbu\s+tashkilotmi\b/i,
      /\brasmiymi\b/i,
      /\blitsenziya\b/i,
      /\bruxsatnoma\b/i,
      /\bdavlat\s+(tashkiloti|idorasi)/i,
    ],
  },
  {
    key: "who_are_you",
    label: "O‘zi kimsiz",
    kind: "trust",
    category: "trust",
    patterns: [
      /\bo['’ʻ]?zi\s+kimsiz\b/i,
      /\bsiz\s+kimsiz\b/i,
      /\bkim\s+bilan\s+gaplashyapman\b/i,
      /\btelefon(ingiz)?(ni)?\s+ber/i,
      /\braqamingizni\s+ber/i,
    ],
  },
  {
    key: "is_it_trustworthy",
    label: "Ishonchlimi / aldov emasmi",
    kind: "trust",
    category: "trust",
    patterns: [
      /\bishonchlimi\b/i,
      /\baldov\b/i,
      /\bfiribgar/i,
      /\bhaqiqiymi\b/i,
      /\bscam\b/i,
    ],
  },

  /* ---------- QIYMAT ---------- */
  {
    key: "benefits_general",
    label: "Nima foyda beradi",
    kind: "question",
    category: "benefit",
    patterns: [
      /\bnima\s+foyda\b/i,
      /\bfoydasi\s+nima\b/i,
      /\bqanday\s+(ustunlik|afzallik|foyda)/i,
      /\bnima\s+beradi\b/i,
      /\bbizga?ga\s+nima\b/i,
      /\bnimaga\s+kerak\b/i,
    ],
  },
  {
    key: "google_visibility",
    label: "Google’da chiqadimi",
    kind: "question",
    category: "benefit",
    patterns: [/\bgoogle\b/i, /\bindeks/i, /\bqidiruvda\s+chiq/i, /\bgugl/i],
  },
  {
    key: "eligibility",
    label: "Men mos kelamanmi",
    kind: "objection",
    category: "eligibility",
    patterns: [
      /\byutuqlarim\s+yo['’ʻ]?q\b/i,
      /\bunchalik\s+ko['’ʻ]?p\s+yutuq/i,
      /\bmen\s+(to['’ʻ]?g['’ʻ]?ri\s+kelamanmi|mos\s+kelamanmi)/i,
      /\bhali\s+endi\s+talaba\b/i,
      /\bkim\s+qatnasha\s+oladi\b/i,
    ],
  },

  /* ---------- INSTAGRAM / TARQATISH ---------- */
  {
    key: "instagram_posting",
    label: "Instagramga qo‘yasizmi",
    kind: "question",
    category: "distribution",
    patterns: [/\binstagram/i, /\binstagramga\s+quy/i, /\bstoriesga\b/i],
  },

  /* ---------- TAHRIR ---------- */
  {
    key: "edit_request",
    label: "Matnni to‘g‘rilash kerak",
    kind: "post_sale",
    category: "support",
    patterns: [
      /\bto['’ʻ]?g['’ʻ]?rilasa\s+bo['’ʻ]?lmaydimi\b/i,
      /\bo['’ʻ]?zgartirib\s+bering\b/i,
      /\bxato\s+(yozilgan|ketgan|bor)/i,
      /\bshiorim\s+xato\b/i,
      /\bhali\s+ham\s+o['’ʻ]?zgarmadi\b/i,
      /\bo['’ʻ]?chirib\s+tashla/i,
    ],
  },
];

/** Barcha lug'atdagi niyatlar — adminda ro'yxat uchun. */
export const QUESTION_INTENTS: readonly QuestionIntent[] = INTENT_RULES.map(
  ({ key, label, kind, category }) => ({ key, label, kind, category }),
);

/* --------------------------- savolni aniqlash --------------------------- */

/**
 * Savol belgisi. O'zbekcha yozishmada "?" ko'pincha qo'yilmaydi,
 * shuning uchun so'roq YUKLAMALARI ham hisobga olinadi.
 */
const QUESTION_MARKERS: readonly RegExp[] = [
  /\?/,
  /*
   * SO'ROQ SO'ZLARI PREFIKS BO'YICHA.
   *
   * O'zbekchada so'roq so'zi kelishik qo'shimchasini oladi:
   * qayerda / qayerdan / qayerga, kim / kimga / kimdan,
   * qancha / qanchadan, necha / nechta.
   *
   * So'z chegarasi (`\b`) bilan qat'iy ro'yxat ishlatilsa,
   * "qayerdan" topilmay qolardi — chunki u "qayerda" dan keyin
   * `n` bilan davom etadi. Aynan shu xato test bilan tutildi.
   */
  /\b(qancha|qanday|qanaqa|qachon|qa(?:y|t)er|nima|nega|kim|qaysi|nech)\p{L}*/iu,
  // -mi / -mu so'roq yuklamasi so'z oxirida.
  /\p{L}+(mi|mi\?|midir)\b/iu,
  /\bbo['’ʻ]?ladimi\b/i,
  /\bbormi\b/i,
  /\bkerakmi\b/i,
];

/** Matn savol (yoki savol o'rnida turgan muammo) ekanini aniqlaydi. */
export function looksLikeQuestion(text: string): boolean {
  const normalized = normalizeForIntent(text);
  return QUESTION_MARKERS.some((marker) => marker.test(normalized));
}

export interface MinedQuestion {
  intentKey: string | null;
  intentLabel: string | null;
  kind: QuestionKind;
  category: string;
  /** Klasterlash uchun me'yorlashtirilgan shakl. */
  normalized: string;
}

/**
 * Bitta mijoz xabaridan savol niyatini chiqaradi.
 *
 * `null` — bu xabar savol emas. Bu ATAYLAB: "rahmat", "xo'p",
 * "yubordim" kabi xabarlarni FAQ ga qo'shish ro'yxatni
 * ma'nosiz qilardi.
 */
export function mineQuestion(text: string | null | undefined): MinedQuestion | null {
  const raw = (text ?? "").trim();
  if (raw === "") return null;
  // Juda qisqa tasdiqlar savol emas.
  if (raw.length < 3) return null;

  const normalized = normalizeForIntent(raw);

  for (const rule of INTENT_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(normalized))) continue;
    return {
      intentKey: rule.key,
      intentLabel: rule.label,
      kind: rule.kind,
      category: rule.category,
      normalized: normalizeQuestionForCluster(raw),
    };
  }

  /*
   * LUG'ATDA YO'Q, LEKIN SAVOL.
   *
   * Bu ENG QIMMATLI ma'lumot: aynan shular biz hali
   * javob bermagan savollar. Ular `intentKey = null` bilan
   * saqlanadi va me'yorlashtirilgan matni bo'yicha klasterlanadi.
   */
  if (looksLikeQuestion(raw)) {
    return {
      intentKey: null,
      intentLabel: null,
      kind: "question",
      category: "unknown",
      normalized: normalizeQuestionForCluster(raw),
    };
  }

  return null;
}

/**
 * Klasterlash uchun me'yorlashtirish.
 *
 * Tinish belgilari, ortiqcha bo'shliq va so'roq yuklamasi
 * olib tashlanadi — "narxi qancha?" va "Narxi qancha" bitta
 * kalitga tushadi. Lekin SO'ZLAR SAQLANADI: "sertifikat
 * beriladimi" va "sertifikat qachon" har xil qoladi.
 */
export function normalizeQuestionForCluster(text: string): string {
  return normalizeForIntent(text)
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Xabarda BIR NECHTA savol bo'lishi mumkin — hammasi qaytariladi. */
export function mineQuestions(text: string | null | undefined): MinedQuestion[] {
  const raw = (text ?? "").trim();
  if (raw === "") return [];

  const normalized = normalizeForIntent(raw);
  const matched: MinedQuestion[] = [];
  const seen = new Set<string>();

  for (const rule of INTENT_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(normalized))) continue;
    if (seen.has(rule.key)) continue;
    seen.add(rule.key);
    matched.push({
      intentKey: rule.key,
      intentLabel: rule.label,
      kind: rule.kind,
      category: rule.category,
      normalized: normalizeQuestionForCluster(raw),
    });
  }

  if (matched.length > 0) return matched;

  const single = mineQuestion(raw);
  return single ? [single] : [];
}

/** Niyat kaliti bo'yicha ta'rif. */
export function describeIntent(key: string): QuestionIntent | null {
  const rule = INTENT_RULES.find((entry) => entry.key === key);
  return rule ? { key: rule.key, label: rule.label, kind: rule.kind, category: rule.category } : null;
}

/** Matndagi savol so'zlari — noma'lum savollarni nomlashda ishlatiladi. */
export function questionHeadword(text: string): string {
  const normalized = normalizeForMatch(text);
  const match = normalized.match(
    /\b(qancha|qanday|qanaqa|qachon|qa(?:y|t)er|nima|nega|kim|qaysi|nech)\p{L}*/u,
  );
  return match ? match[1] : "";
}
