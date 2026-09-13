/**
 * TAKRORLANISHNING OLDINI OLISH (9-band).
 *
 * MUAMMO: mijoz narxni ikkinchi marta so'rasa, AI xuddi o'sha
 * jumlani qaytarardi. Odam bunday gapirmaydi — u "yuqorida
 * aytganimdek" deydi yoki boshqacha ifodalaydi. Bir xil matnning
 * ikkinchi marta kelishi suhbatni bir zumda "avtojavob" qilib
 * ko'rsatadi va mijoz javob o'qishni to'xtatadi.
 *
 * AYNAN BIR XIL MATN tekshiruvi YETARLI EMAS: model bitta so'zni
 * o'zgartirib qo'yadi va tekshiruv o'tib ketadi, mijoz uchun esa
 * xabar o'sha-o'sha bo'lib qolaveradi. Shuning uchun MA'NO
 * darajasida solishtiriladi.
 *
 * USUL: so'z uchliklari (trigram) to'plamining Jaccard o'xshashligi.
 * Nega trigram: alohida so'zlar to'plami juda ko'p noto'g'ri moslik
 * beradi (ikki javobda ham "narx", "so'm", "maqola" bo'ladi), butun
 * jumla esa bitta so'z farqidan buziladi. Uchlik ikkisining
 * o'rtasida: u so'zlar TARTIBINI ham hisobga oladi.
 *
 * MUHIM CHEGARA: bir xil FAKTNI qayta aytish taqiqlanmaydi. Narx
 * ikkinchi marta ham o'sha narx. Taqiqlanadigan narsa — XABARNING
 * o'zini nusxalash.
 *
 * SOF MODUL.
 */

import { normalizeForMatch } from "../text-normalize.ts";

/**
 * Shu chegaradan yuqori o'xshashlik — takror.
 *
 * 0.72 tajriba bilan tanlangan o'rta nuqta: bir xil mazmunni
 * boshqacha ifodalash odatda 0.3–0.55 beradi, nusxa esa 0.85+.
 * Pastroq qo'yilsa halol qayta ifodalash ham rad etilardi va model
 * cheksiz qayta yozishga tushardi.
 */
export const REPETITION_THRESHOLD = 0.72;

/** Solishtirishda nechta oxirgi AI xabari ko'riladi. */
export const REPETITION_WINDOW = 6;

/** Juda qisqa xabarlar solishtirilmaydi — "Ha, albatta" takror emas. */
const MIN_WORDS_FOR_CHECK = 8;

function words(text: string): string[] {
  return normalizeForMatch(text)
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

/** So'z uchliklari to'plami. Matn uchtadan qisqa bo'lsa — so'zlarning o'zi. */
export function trigrams(text: string): Set<string> {
  const tokens = words(text);
  if (tokens.length < 3) return new Set(tokens);

  const set = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    set.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return set;
}

/** 0–1. Bir xil matn uchun 1, umuman boshqa matn uchun 0. */
export function similarity(a: string, b: string): number {
  const first = trigrams(a);
  const second = trigrams(b);
  if (first.size === 0 || second.size === 0) return 0;

  let shared = 0;
  for (const gram of first) if (second.has(gram)) shared += 1;

  const union = first.size + second.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface RepetitionCheck {
  repeated: boolean;
  /** Eng o'xshash oldingi xabar — qayta yozish ko'rsatmasida ishlatiladi. */
  closest: string | null;
  score: number;
}

/**
 * Yangi javob oldingilaridan birini takrorlayaptimi.
 *
 * Faqat AI YOZGAN xabarlar bilan solishtiriladi: mijozning gapini
 * takrorlash (masalan uning savolini qaytarish) mutlaqo normal.
 */
export function checkRepetition(
  candidate: string,
  previousAssistantMessages: readonly string[],
): RepetitionCheck {
  const body = (candidate ?? "").trim();
  if (body === "" || words(body).length < MIN_WORDS_FOR_CHECK) {
    return { repeated: false, closest: null, score: 0 };
  }

  let best = 0;
  let closest: string | null = null;

  for (const previous of previousAssistantMessages.slice(-REPETITION_WINDOW)) {
    const score = similarity(body, previous);
    if (score > best) {
      best = score;
      closest = previous;
    }
  }

  return { repeated: best >= REPETITION_THRESHOLD, closest, score: best };
}

/**
 * Modelga qayta yozish ko'rsatmasi.
 *
 * FAKTNI O'ZGARTIRISHNI SO'RAMAYDI — bu muhim. Narx o'sha narx
 * bo'lib qolishi kerak; o'zgarishi kerak bo'lgan narsa faqat
 * IFODA. "Boshqacha ayt" deyilsa model faktni ham o'zgartirib
 * yuborishi mumkin edi.
 */
export function buildRewriteInstruction(previous: string): string {
  return [
    "OLDINGI JAVOBING BILAN DEYARLI BIR XIL BO‘LDI. Mana o‘sha javob:",
    `“${previous.slice(0, 400)}”`,
    "",
    "Qaytadan yoz. FAKTLAR O‘ZGARMAYDI — narx, muddat va shartlar o‘sha-o‘sha.",
    "O‘zgarishi kerak bo‘lgan narsa — IFODA. Mijoz buni allaqachon",
    "eshitganini tan ol (masalan “yuqorida aytganimdek”) va qisqaroq,",
    "boshqacha tuzilgan javob ber.",
  ].join("\n");
}

/**
 * Kontekst bloki uchun: bu chatda ALLAQACHON aytilgan narsalar.
 *
 * Model buni ko'rsa, o'zi ham takrorlamaslikka harakat qiladi —
 * ya'ni tekshiruv oxirgi himoya bo'lib qoladi, birinchisi emas.
 */
export function buildAlreadySaidBlock(
  previousAssistantMessages: readonly string[],
  maxChars = 600,
): string {
  const recent = previousAssistantMessages.slice(-REPETITION_WINDOW);
  if (recent.length === 0) return "";

  const lines = ["=== BU CHATDA ALLAQACHON YOZGANSAN (takrorlama) ==="];
  let used = 0;
  for (const message of recent) {
    const snippet = message.replace(/\s+/g, " ").trim().slice(0, 120);
    if (used + snippet.length > maxChars) break;
    lines.push(`- ${snippet}${message.length > 120 ? "…" : ""}`);
    used += snippet.length;
  }
  return lines.join("\n");
}
