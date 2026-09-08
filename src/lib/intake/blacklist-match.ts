/**
 * Qora ro'yxatda O'XSHASH ismni topish.
 *
 * NEGA KERAK: mavjud qidiruv `blacklistKey` bo'yicha AYNAN mos keladigan
 * yozuvni topadi. Bu "o'sha odam qaytib keldimi?" savoliga javob beradi,
 * lekin moderator tugma orqali ism yozganda boshqa savol tug'iladi:
 * "shunga o'xshash kimdir ro'yxatda bormi?" — familiyasi bir xil, otasining
 * ismi yozilmagan yoki bitta harf xato bo'lsa, aniq moslik hech narsa
 * topmaydi va moderator borni ko'rmay qoladi.
 *
 * SOF MODUL: I/O yo'q, shuning uchun moslik qoidalari testda to'liq
 * qoplanadi va ular "bir xil ismli boshqa odam" bilan chalkashmaydi.
 */

import { blacklistKey } from "./name-key.ts";

export const BLACKLIST_ADD_BUTTON_LABEL = "🚫 Qora ro‘yxatga kiritish";

/**
 * Ism so'raladigan matn.
 *
 * Bot HOLATSIZ: u "bu chat hozir ism kutyapti" degan narsani hech qayerda
 * saqlamaydi. Buning o'rniga savol `force_reply` bilan yuboriladi va
 * javob `reply_to_message` ichida aynan shu matn bilan qaytadi — holat
 * Telegram'ning o'zida yashaydi. Shu sababli bu satr O'ZGARMASLIGI kerak:
 * u ikki tomonni bog'laydigan kalit.
 */
export const BLACKLIST_NAME_PROMPT =
  "🚫 Qora ro‘yxatga kiritish\n\nIsm va familiyani yozib yuboring (masalan: Ravshanova Maryam Rasulovna).";

/** Javob shu savolgami. */
export function isBlacklistPromptReply(replyToText: string | null | undefined): boolean {
  return (replyToText ?? "").trim().startsWith("🚫 Qora ro‘yxatga kiritish");
}

/* ------------------------------- tokenlar ------------------------------- */

const APOSTROPHES = /[ʻʼ‘’'`´]/g;

/**
 * Ismning ma'noli bo'laklari.
 *
 * Apostrof variantlari `name-key.ts` dagi kabi yig'ib tashlanadi —
 * "o'g'li" va "oʻgʻli" bitta so'z.
 */
export function nameTokens(fullName: string | null | undefined): string[] {
  return (fullName ?? "")
    .replace(APOSTROPHES, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

/* ----------------------------- o‘xshashlik ------------------------------ */

/** Klassik tahrir masofasi. Uzun satrlar kesiladi — ism uzun bo'lmaydi. */
export function levenshtein(a: string, b: string): number {
  const s = a.slice(0, 64);
  const t = b.slice(0, 64);
  if (s === t) return 0;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let previous = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[t.length];
}

/** 0–1 oralig'ida o'xshashlik. */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - levenshtein(a, b) / longest;
}

/** Shundan yuqori bo'lsa ikki so'z bir xil ism deb hisoblanadi. */
export const TOKEN_MATCH_THRESHOLD = 0.8;

/** Yozuv o'xshash deb sanaladigan eng past umumiy ball. */
export const SIMILAR_THRESHOLD = 0.5;

export interface BlacklistCandidate {
  nameSlug: string;
  fullName: string;
  reason: string | null;
  createdAt: string;
}

export interface BlacklistMatch extends BlacklistCandidate {
  score: number;
  /** Mos kelgan bo'laklar — moderator nima uchun chiqqanini ko'rsin. */
  matchedTokens: string[];
  kind: "exact" | "similar";
}

/**
 * Ikki ism qanchalik bir xil.
 *
 * IKKI SHART birga: kamida ikkita bo'lak mos kelishi va umumiy ball
 * chegaradan yuqori bo'lishi. Bitta bo'lak yetarli emas — "Maryam"
 * degan ism minglab odamda bor va u bilan chiqadigan ro'yxat foydasiz
 * shovqin bo'lardi. Yagona istisno: ikkala tomon ham bitta so'zdan
 * iborat bo'lsa (taxallus yoki chala yozilgan ism).
 */
export function scoreNameMatch(
  queryTokens: readonly string[],
  entryTokens: readonly string[],
): { score: number; matchedTokens: string[] } {
  if (queryTokens.length === 0 || entryTokens.length === 0) {
    return { score: 0, matchedTokens: [] };
  }

  const used = new Set<number>();
  const matchedTokens: string[] = [];
  let total = 0;

  for (const token of queryTokens) {
    let bestIndex = -1;
    let best = 0;
    entryTokens.forEach((candidate, index) => {
      if (used.has(index)) return;
      const similarity = tokenSimilarity(token, candidate);
      if (similarity > best) {
        best = similarity;
        bestIndex = index;
      }
    });

    if (best >= TOKEN_MATCH_THRESHOLD && bestIndex >= 0) {
      used.add(bestIndex);
      matchedTokens.push(entryTokens[bestIndex]);
      total += best;
    }
  }

  // Maxraj — UZUNROQ ism. Aks holda "Maryam" degan bitta so'z uch
  // bo'lakli har qanday yozuvga 100% mos kelib qolardi.
  const denominator = Math.max(queryTokens.length, entryTokens.length);
  return { score: total / denominator, matchedTokens };
}

export interface FindSimilarOptions {
  limit?: number;
  threshold?: number;
}

/**
 * Ro'yxatdan o'xshashlarini topadi, aniq moslik birinchi bo'lib.
 */
export function findSimilarBlacklisted(
  fullName: string,
  entries: readonly BlacklistCandidate[],
  options: FindSimilarOptions = {},
): BlacklistMatch[] {
  const limit = options.limit ?? 5;
  const threshold = options.threshold ?? SIMILAR_THRESHOLD;

  const queryKey = blacklistKey(fullName);
  const queryTokens = nameTokens(fullName);
  if (queryTokens.length === 0) return [];

  const matches: BlacklistMatch[] = [];

  for (const entry of entries) {
    if (entry.nameSlug === queryKey) {
      matches.push({ ...entry, score: 1, matchedTokens: queryTokens, kind: "exact" });
      continue;
    }

    const entryTokens = nameTokens(entry.fullName);
    const { score, matchedTokens } = scoreNameMatch(queryTokens, entryTokens);

    const bothSingleWord = queryTokens.length === 1 && entryTokens.length === 1;
    const enoughTokens = matchedTokens.length >= 2 || bothSingleWord;
    if (!enoughTokens || score < threshold) continue;

    matches.push({ ...entry, score, matchedTokens, kind: "similar" });
  }

  return matches
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "exact" ? -1 : 1;
      return b.score - a.score;
    })
    .slice(0, limit);
}

/* ------------------------------- xabarlar ------------------------------- */

export const BLACKLIST_REMOVE_PREFIX = "blk:rm:";
/** Telegram callback_data chegarasi. */
const CALLBACK_MAX_BYTES = 64;

export function blacklistRemoveCallbackData(nameSlug: string): string | null {
  const data = `${BLACKLIST_REMOVE_PREFIX}${nameSlug}`;
  // Sig'masa tugma umuman ko'rsatilmaydi: yarim kesilgan kalit boshqa
  // odamni ro'yxatdan chiqarib yuborishi mumkin edi.
  return Buffer.byteLength(data, "utf8") <= CALLBACK_MAX_BYTES ? data : null;
}

export function parseBlacklistRemoveCallback(data: string | undefined | null): string | null {
  if (!data || !data.startsWith(BLACKLIST_REMOVE_PREFIX)) return null;
  const slug = data.slice(BLACKLIST_REMOVE_PREFIX.length).trim();
  return slug === "" ? null : slug;
}

export interface BlacklistResultInput {
  /** Moderator yozgan ism. */
  fullName: string;
  /** Yozuv endi ro'yxatda (yangi qo'shilgan yoki avvaldan bor). */
  added: boolean;
  alreadyListed: boolean;
  matches: readonly BlacklistMatch[];
}

export function buildBlacklistResultMessage(input: BlacklistResultInput): string {
  const lines: string[] = ["🚫 QORA RO‘YXAT", "", `👤 ${input.fullName.trim()}`, ""];

  if (!input.added) {
    lines.push("⚠️ Ism saqlanmadi — matn ism sifatida o‘qilmadi.");
    return lines.join("\n");
  }

  lines.push(
    input.alreadyListed
      ? "ℹ️ Bu ism ALLAQACHON qora ro‘yxatda edi."
      : "✅ Qora ro‘yxatga kiritildi.",
  );

  const similar = input.matches.filter((match) => match.kind === "similar");
  if (similar.length > 0) {
    lines.push("", `🔎 Ro‘yxatda o‘xshash ${similar.length} ta ism bor:`);
    similar.forEach((match, index) => {
      const percent = Math.round(match.score * 100);
      lines.push(`${index + 1}. ${match.fullName} — ${percent}% o‘xshash`);
      if (match.reason) lines.push(`   ${match.reason}`);
    });
    // Ular o'chirilmaydi va birlashtirilmaydi — qaror moderatorda.
    lines.push("", "Bir odamning ikki xil yozilishi bo‘lsa, keraksizini olib tashlang.");
  }

  return lines.join("\n");
}

/** Faqat qidiruv natijasi (hech narsa qo'shilmagan holat). */
export function buildBlacklistLookupMessage(
  fullName: string,
  matches: readonly BlacklistMatch[],
): string {
  if (matches.length === 0) {
    return `🔎 «${fullName.trim()}» — qora ro‘yxatda topilmadi.`;
  }
  const lines = [`🔎 «${fullName.trim()}» bo‘yicha topildi:`, ""];
  matches.forEach((match, index) => {
    const tag = match.kind === "exact" ? "aniq moslik" : `${Math.round(match.score * 100)}% o‘xshash`;
    lines.push(`${index + 1}. ${match.fullName} — ${tag}`);
    if (match.reason) lines.push(`   ${match.reason}`);
  });
  return lines.join("\n");
}
