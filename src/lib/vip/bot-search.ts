/**
 * POST BOT: NOMZODNI ISM BILAN QIDIRISH — SOF MODUL.
 *
 * Muharrir harf-harf yozadi va natija har harfda yangilanadi (Telegram
 * inline rejimi). Qidiruv xotirada: ~3 000 nomzod, har harf uchun bazaga
 * borish shart emas.
 *
 * YOZUV FARQI YO'QOLADI. Ismlarning bir qismi kirillda ("Саидов Сардорбек"),
 * ba'zisi aralash ("Музафаров Отабек Умидovich"), muharrir esa lotinda
 * yozadi. Ikkala tomon ham bitta "skelet"ga keltiriladi:
 *   · kirill → lotin (o'zbek qoidasi: ш→sh, ў→o', қ→q, ғ→g', ҳ→h);
 *   · apostrofning yetti xil belgisi yo'qoladi (o'/oʻ/o‘ → o);
 *   · x / kh / h bitta (Xurshid = Khurshid = Хуршид), q = k (qizi = Кизи);
 *   · -iyev = -иев (Aliyev = Алиев), -ayeva = -аева, ikkilangan harf bitta
 *     (Muhammad = Мухамад).
 * Qolgan farq (rus "У" o'zbek "O'" o'rnida: Уктамов ↔ O'ktamov) bitta
 * harf xatosiga ruxsat bilan qoplanadi.
 *
 * Faqat nisbiy `.ts` import: testlar `@/` ni ko'rmaydi.
 */

import { normalizeApostrophes, transliterateCyrillic } from "../sales/text-normalize.ts";

const MAX_QUERY_TOKENS = 5;
const MAX_QUERY_LENGTH = 80;

/** Ismni qidiruv skeletiga keltiradi. Ikkala tomon ham AYNAN shu funksiyadan o'tadi. */
export function nameSkeleton(text: string): string {
  const latin = transliterateCyrillic(
    normalizeApostrophes(text.normalize("NFKC")).toLowerCase(),
  )
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

  return latin
    .replace(/o'/g, "o")
    .replace(/g'/g, "g")
    .replace(/'/g, "")
    .replace(/kh/g, "h")
    .replace(/x/g, "h")
    .replace(/q/g, "k")
    // Faqat so'z boshida (Джамшид = Jamshid): ichkarida "Xurshid-jon" buzilardi.
    .replace(/(^|[^a-z])dj/g, "$1j")
    .replace(/w/g, "v")
    .replace(/iy(?=[aeiou])/g, "i")
    // Unlidan keyingi "y": Abdullayeva = Абдуллаева, Rayimov = Раимов.
    .replace(/([aeiou])y(?=[ei])/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bye/g, "e")
    .replace(/(.)\1+/g, "$1")
    .trim();
}

export function skeletonTokens(text: string): string[] {
  return nameSkeleton(text).split(" ").filter(Boolean);
}

/** So'rov: ko'pi bilan 5 so'z, 80 belgi — har harfda ishlaydi, chegarasi bo'lsin. */
export function queryTokens(query: string): string[] {
  return skeletonTokens(query.slice(0, MAX_QUERY_LENGTH)).slice(0, MAX_QUERY_TOKENS);
}

export interface SearchEntry {
  id: string;
  fullName: string;
  /** Chop etilganlar teng ballda oldinda turadi. */
  published: boolean;
}

export interface IndexedEntry<T extends SearchEntry> {
  entry: T;
  tokens: string[];
}

/** Skelet bir marta hisoblanadi — har harfda qayta emas. */
export function buildSearchIndex<T extends SearchEntry>(entries: readonly T[]): IndexedEntry<T>[] {
  return entries.map((entry) => ({ entry, tokens: skeletonTokens(entry.fullName) }));
}

/** Levenshtein masofasi, `limit` dan oshsa erta to'xtaydi. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Bitta so'zning bitta ism bo'lagiga mosligi:
 *   4 — aynan; 3 — bo'lak shu bilan boshlanadi (yozish davom etmoqda);
 *   2 — boshlanishi bitta harf farq bilan (4+ harfli so'z: Уктамов ↔ oktam);
 *   1 — bo'lak ichida uchraydi (3+ harf); 0 — mos emas.
 */
function tokenScore(query: string, token: string): number {
  if (token === query) return 4;
  if (token.startsWith(query)) return 3;
  if (query.length >= 4) {
    for (const length of [query.length, query.length - 1, query.length + 1]) {
      if (length <= token.length && editDistance(query, token.slice(0, length), 1) <= 1) return 2;
    }
  }
  if (query.length >= 3 && token.includes(query)) return 1;
  return 0;
}

interface Scored<T> {
  item: T;
  score: number;
  firstPosition: number;
}

/**
 * Har so'z BOSHQA-BOSHQA ism bo'lagiga mos kelishi shart, tartib muhim emas:
 * "sardor saidov" ham "Саидов Сардорбек" ni topadi. Uzun so'z avval joy
 * oladi — qisqasi ("a") uzunining bo'lagini egallab qo'ymasin.
 */
function scoreEntry(query: string[], tokens: string[]): { score: number; firstPosition: number } | null {
  const used = new Set<number>();
  let score = 0;
  let firstPosition = Number.POSITIVE_INFINITY;
  const order = [...query].sort((a, b) => b.length - a.length);

  for (const word of order) {
    let bestIndex = -1;
    let bestScore = 0;
    tokens.forEach((token, index) => {
      if (used.has(index)) return;
      const s = tokenScore(word, token);
      if (s > bestScore) {
        bestScore = s;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) return null;
    used.add(bestIndex);
    score += bestScore;
    firstPosition = Math.min(firstPosition, bestIndex);
  }
  return { score, firstPosition };
}

/**
 * Eng mos `limit` ta nomzod.
 *
 * Tartib: ball → chop etilgan → mos kelgan birinchi bo'lak oldinroq
 * (familiya bo'yicha topilgan yuqorida) → qisqaroq ism → alifbo.
 */
export function searchIndex<T extends SearchEntry>(
  index: readonly IndexedEntry<T>[],
  query: string,
  limit = 20,
): T[] {
  const words = queryTokens(query);
  if (words.length === 0) return [];

  const scored: Scored<T>[] = [];
  for (const { entry, tokens } of index) {
    const match = scoreEntry(words, tokens);
    if (match) scored.push({ item: entry, score: match.score, firstPosition: match.firstPosition });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.item.published) - Number(a.item.published) ||
      a.firstPosition - b.firstPosition ||
      a.item.fullName.length - b.item.fullName.length ||
      a.item.fullName.localeCompare(b.item.fullName),
  );
  return scored.slice(0, limit).map((s) => s.item);
}
