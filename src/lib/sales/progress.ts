/**
 * O'rganish progressi.
 *
 * ENG MUHIM QOIDA: maxraj — FAQAT shu panelda saqlangan yoki import
 * qilingan suhbatlar. Telegram Bot API ulanishdan oldingi yozishmalarni
 * umuman bermaydi, shuning uchun "Telegram'dagi barcha eski chatlar
 * o'rganildi" degan jumla har doim yolg'on bo'lardi. Progress shuning
 * uchun har joyda "187 / 420" ko'rinishida, ya'ni maxraji ochiq holda
 * ko'rsatiladi.
 */

export interface LearningCounts {
  /** Bazadagi jami suhbat — progressning MAXRAJI. */
  total: number;
  learned: number;
  pending: number;
  learning: number;
  failed: number;
  /** Juda qisqa yoki mazmunsiz — o'rganishga yaroqsiz. */
  skipped: number;
}

export interface LearningProgress extends LearningCounts {
  /** learned / total, bir kasr xonagacha. Maxraj 0 bo'lsa 0. */
  percent: number;
  /** "187 / 420" */
  label: string;
  /** "44.5%" */
  percentLabel: string;
  /** Maxraj nimani anglatishini aytadigan matn — UI da doim yonida turadi. */
  scopeNote: string;
}

/**
 * Maxrajni izohlaydigan matn. Ataylab bitta joyda: UI ham, hisobot ham
 * shu jumlani ishlatadi va hech kim uni "hammasi o'rganildi" ga
 * aylantirib yubormaydi.
 */
export function scopeNote(total: number): string {
  return (
    `Maxraj — panelda saqlangan yoki import qilingan ${total} ta suhbat. ` +
    "Bu Telegram’dagi butun yozishma tarixi EMAS: Bot API ulanishdan " +
    "oldingi xabarlarni bermaydi."
  );
}

export const LEARNING_SCOPE_TITLE = "O‘rganish qamrovi";

/** Foizni bir kasr xonaga yaxlitlaydi (44.523 -> 44.5). */
export function percentOf(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function computeLearningProgress(counts: Partial<LearningCounts>): LearningProgress {
  const learned = Math.max(0, counts.learned ?? 0);
  const pending = Math.max(0, counts.pending ?? 0);
  const learning = Math.max(0, counts.learning ?? 0);
  const failed = Math.max(0, counts.failed ?? 0);
  const skipped = Math.max(0, counts.skipped ?? 0);
  // Maxraj berilmagan bo'lsa holatlar yig'indisidan tiklanadi — lekin
  // berilgani ustun: bazada holati noma'lum qator ham bo'lishi mumkin.
  const total = Math.max(
    0,
    counts.total ?? learned + pending + learning + failed + skipped,
  );

  const percent = percentOf(learned, total);

  return {
    total,
    learned,
    pending,
    learning,
    failed,
    skipped,
    percent,
    label: `${learned} / ${total}`,
    percentLabel: `${percent.toFixed(1)}%`,
    scopeNote: scopeNote(total),
  };
}
