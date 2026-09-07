/**
 * Savol NIYATLARI (intent) va ularni klasterlash.
 *
 * MUHIM CHEGARA: quyidagi ro'yxat — LUG'AT, ma'lumot emas. Unda turgan
 * niyat bazaga o'z-o'zidan yozilmaydi. Yozuv faqat REAL suhbatda uchragan
 * niyat uchun yaratiladi va uning har bir sanog'i haqiqiy xabarga tayanadi.
 * Texnik topshiriqdagi "Invent qilma" talabi aynan shu.
 *
 * Lug'at nima uchun kerak: modeldan har suhbatda o'z xohlagan nomini
 * o'ylab topishini so'rasak, "narxi qancha?" bir suhbatda PRICE, boshqasida
 * COST, uchinchisida NARX bo'lib chiqadi va klasterlash buziladi. Nazorat
 * ostidagi lug'at bir xil savolni bir xil kalitga olib keladi.
 *
 * Model lug'atda yo'q niyat qaytarsa u ham SAQLANADI (u ham real
 * ma'lumot), lekin `known: false` bilan belgilanadi.
 */

import { normalizeForMatch } from "./text-normalize.ts";

export type IntentKind = "question" | "objection";

export interface IntentDefinition {
  key: string;
  label: string;
  kind: IntentKind;
  /** Leksik zaxira: model kalit bermasa shu iboralar bo'yicha topiladi. */
  aliases: readonly string[];
}

/**
 * Texnik topshiriqda sanab o'tilgan takroriy savol va e'tirozlar.
 * Har biri — kutilayotgan niyat, tasdiqlangan fakt emas.
 */
export const KNOWN_INTENTS: readonly IntentDefinition[] = [
  {
    key: "PRICE_QUESTION",
    label: "Narx qancha",
    kind: "question",
    aliases: ["narxi", "narx", "qancha turadi", "necha pul", "nech pul", "qancha bo‘ladi", "qancha boladi", "narxchi", "qanchadan"],
  },
  {
    key: "SERVICE_BENEFIT",
    label: "Nima foydasi bor",
    kind: "question",
    aliases: ["nima foydasi", "nima beradi", "foydasi nima", "nima uchun kerak", "qanday foyda"],
  },
  {
    key: "WHERE_PUBLISHED",
    label: "Qayerda chiqadi",
    kind: "question",
    aliases: ["qayerda chiqadi", "qayerda joylanadi", "qaysi saytda", "qayerga chiqadi", "qayerda e‘lon"],
  },
  {
    key: "ARTICLE_PRICE",
    label: "Maqola qancha turadi",
    kind: "question",
    aliases: ["maqola qancha", "maqolaning narxi", "maqola narxi"],
  },
  {
    key: "TRUST_QUESTION",
    label: "Ishonchlimi",
    kind: "question",
    aliases: ["ishonchlimi", "aldov emasmi", "rostmi", "haqiqiymi", "kafolat bormi"],
  },
  {
    key: "TIMELINE_QUESTION",
    label: "Qachon chiqadi",
    kind: "question",
    aliases: ["qachon chiqadi", "qachon tayyor", "qancha vaqtda", "necha kunda", "qachon bo‘ladi"],
  },
  {
    key: "PAYMENT_METHOD",
    label: "To‘lov qanday",
    kind: "question",
    aliases: ["to‘lov qanday", "tolov qanday", "qanday to‘layman", "qayerga to‘layman", "to‘lov usuli", "karta raqami"],
  },
  {
    key: "APPLICATION_PROCESS",
    label: "Ariza qanday",
    kind: "question",
    aliases: ["ariza qanday", "qanday ariza", "ariza qoldirish", "ro‘yxatdan qanday", "qanday qatnashaman"],
  },
  {
    key: "ELIGIBILITY",
    label: "Kimlar qatnasha oladi",
    kind: "question",
    aliases: ["kimlar qatnasha", "kim qatnasha", "men qatnasha olamanmi", "shartlari nima"],
  },
  {
    key: "AGE_LIMIT",
    label: "Yosh chegarasi",
    kind: "question",
    aliases: ["yosh chegarasi", "necha yosh", "yoshim", "yosh cheklovi"],
  },
  {
    key: "CERTIFICATE",
    label: "Sertifikat",
    kind: "question",
    aliases: ["sertifikat", "guvohnoma", "diplom beriladimi"],
  },
  {
    key: "POST_QUESTION",
    label: "Post",
    kind: "question",
    aliases: ["post", "rasm chiqadimi", "post tayyorlaysizmi"],
  },
  {
    key: "INSTAGRAM",
    label: "Instagram",
    kind: "question",
    aliases: ["instagram", "instada", "insta"],
  },
  {
    key: "TELEGRAM",
    label: "Telegram",
    kind: "question",
    aliases: ["telegram kanal", "kanalga", "telegramda chiqadi"],
  },
  {
    key: "WEBSITE",
    label: "Sayt",
    kind: "question",
    aliases: ["saytda", "sayt manzili", "veb sayt", "saytingiz"],
  },
  {
    key: "ARTICLE_DEADLINE",
    label: "Maqola muddati",
    kind: "question",
    aliases: ["muddati", "deadline", "qancha muddat", "necha kun ichida"],
  },
  {
    key: "EDIT_REQUEST",
    label: "O‘zgartirish",
    kind: "question",
    aliases: ["o‘zgartirsa", "ozgartirsa", "tahrirlash", "to‘g‘rilash", "almashtirsa"],
  },
  {
    key: "REFUND",
    label: "Pulni qaytarish",
    kind: "question",
    aliases: ["pulni qaytar", "refund", "qaytarib berasizmi", "puli qaytadimi"],
  },
  {
    key: "OBJECTION_TOO_EXPENSIVE",
    label: "Qimmat",
    kind: "objection",
    aliases: ["qimmat", "qimmatroq", "arzonroq", "chegirma bo‘ladimi", "chegirma bormi"],
  },
  {
    key: "OBJECTION_TRUST",
    label: "Ishonmayapman",
    kind: "objection",
    aliases: ["ishonmayapman", "ishonmayman", "shubhalanaman", "firibgarlik"],
  },
  {
    key: "OBJECTION_LATER",
    label: "Keyinroq",
    kind: "objection",
    aliases: ["keyinroq", "keyin yozaman", "hozir emas", "bir ozdan keyin"],
  },
  {
    key: "OBJECTION_THINKING",
    label: "O‘ylab ko‘raman",
    kind: "objection",
    aliases: ["o‘ylab ko‘raman", "oylab koraman", "maslahatlashaman", "o‘ylashim kerak"],
  },
  {
    key: "OBJECTION_NO_MONEY",
    label: "Pulim yo‘q",
    kind: "objection",
    aliases: ["pulim yo‘q", "pulim yoq", "imkonim yo‘q", "mablag‘ yo‘q"],
  },
  {
    key: "DOUBT",
    label: "Shubha",
    kind: "objection",
    aliases: ["shubha", "ishonim komil emas", "aniq emas"],
  },
];

const BY_KEY = new Map(KNOWN_INTENTS.map((intent) => [intent.key, intent]));

/** `narx savoli` -> `NARX_SAVOLI`. Kalitni bir shaklga keltiradi. */
export function normalizeIntentKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[‘’'`´]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export interface ResolvedIntent {
  key: string;
  label: string;
  kind: IntentKind;
  /** Lug'atdagi niyatmi. `false` — model yangi niyat topgan. */
  known: boolean;
}

export function resolveIntent(rawKey: string, rawLabel?: string | null): ResolvedIntent | null {
  const key = normalizeIntentKey(rawKey ?? "");
  if (!key) return null;

  const known = BY_KEY.get(key);
  if (known) return { key: known.key, label: known.label, kind: known.kind, known: true };

  return {
    key,
    label: (rawLabel ?? "").trim() || key.replace(/_/g, " ").toLowerCase(),
    // Lug'atda yo'q niyat e'tirozmi yoki savolmi — bilmaymiz; kalit
    // OBJECTION bilan boshlansagina e'tiroz deb belgilanadi.
    kind: key.startsWith("OBJECTION") ? "objection" : "question",
    known: false,
  };
}

/**
 * Leksik zaxira: model kalit bermagan bo'lsa, matnning o'zidan topadi.
 *
 * Eng UZUN mos alias yutadi — "to‘lov nech pul?" da ham "nech pul"
 * (PRICE_QUESTION), ham "to‘lov" bor, lekin narx haqidagi ibora aniqroq.
 */
export function guessIntentFromText(text: string): ResolvedIntent | null {
  const haystack = normalizeForMatch(text);
  let best: { intent: IntentDefinition; length: number } | null = null;

  for (const intent of KNOWN_INTENTS) {
    for (const alias of intent.aliases) {
      const needle = normalizeForMatch(alias);
      if (!haystack.includes(needle)) continue;
      if (!best || needle.length > best.length) best = { intent, length: needle.length };
    }
  }

  if (!best) return null;
  return { key: best.intent.key, label: best.intent.label, kind: best.intent.kind, known: true };
}

/* ------------------------------ klasterlash ------------------------------ */

export interface IntentObservation {
  key: string;
  label: string;
  kind: IntentKind;
  known: boolean;
  conversationId: string;
  /** Mijozning aynan qanday so'ragani (redaksiya qilingan). */
  customerExample: string;
  customerMessageId: string | null;
}

export interface IntentAggregate {
  key: string;
  label: string;
  kind: IntentKind;
  known: boolean;
  /** Nechta savol shu niyatga tegishli. */
  occurrences: number;
  /** Nechta HAR XIL suhbatda uchradi. */
  conversationCount: number;
  conversationIds: string[];
  /** Turli xil so'rash shakllari — klaster haqiqatan bir xilligini ko'rsatadi. */
  examples: string[];
}

const MAX_EXAMPLES = 8;

/**
 * Barcha batch'lardagi kuzatuvlarni bitta kalit ostida birlashtiradi.
 * "narxi qancha?", "qancha turadi?", "nech pul?" — modeldan bir xil kalit
 * kelgani uchun bitta klasterga tushadi.
 */
export function aggregateIntents(
  observations: readonly IntentObservation[],
): IntentAggregate[] {
  const map = new Map<string, IntentAggregate>();

  for (const observation of observations) {
    let entry = map.get(observation.key);
    if (!entry) {
      entry = {
        key: observation.key,
        label: observation.label,
        kind: observation.kind,
        known: observation.known,
        occurrences: 0,
        conversationCount: 0,
        conversationIds: [],
        examples: [],
      };
      map.set(observation.key, entry);
    }

    entry.occurrences += 1;
    if (!entry.conversationIds.includes(observation.conversationId)) {
      entry.conversationIds.push(observation.conversationId);
      entry.conversationCount += 1;
    }

    const example = observation.customerExample.trim();
    if (example && entry.examples.length < MAX_EXAMPLES && !entry.examples.includes(example)) {
      entry.examples.push(example);
    }
  }

  return [...map.values()].sort((a, b) => b.occurrences - a.occurrences);
}

/** Niyatning barcha savollar ichidagi ulushi, foizda (bir kasr xona). */
export function intentShare(occurrences: number, totalOccurrences: number): number {
  if (!Number.isFinite(occurrences) || totalOccurrences <= 0) return 0;
  return Math.round((occurrences / totalOccurrences) * 1000) / 10;
}
