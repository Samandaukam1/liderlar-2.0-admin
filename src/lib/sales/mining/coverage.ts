/**
 * QAMROV HISOBI — SOF MODUL.
 *
 * ENG MUHIM QOIDA (45-band): TIZIM O'Z QAMROVI HAQIDA YOLG'ON
 * GAPIRMASLIGI KERAK.
 *
 * Eski chuqur o'rganish `select(...).limit(500)` bilan ishlardi va
 * natijani "o'rganildi" deb ko'rsatardi. Bazada 777 suhbat bo'lsa,
 * 277 tasi HECH QACHON KO'RILMASDI, lekin hisobotda bu ko'rinmasdi.
 * Shu son asosida esa "eng ko'p so'raladigan savol" aniqlanardi.
 *
 * Shuning uchun bu yerda TOPILGAN va ISHLANGAN alohida sanaladi,
 * va `full` faqat quyidagi UCHALA shart bajarilganda beriladi:
 *
 *   1. ishlangan == topilgan;
 *   2. xato batch YO'Q;
 *   3. sahifalash oxirigacha yetgan (kursor tugagan).
 */

export const COVERAGE_STATUSES = ["unknown", "partial", "full"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  unknown: "Noma’lum",
  partial: "QISMAN",
  full: "To‘liq",
};

export interface FailedBatch {
  batchIndex: number;
  reason: string;
  conversationIds: string[];
}

export interface CoverageCounters {
  conversationsDiscovered: number;
  conversationsProcessed: number;
  messagesDiscovered: number;
  messagesProcessed: number;
  incoming: number;
  humanOutbound: number;
  aiOutbound: number;
  system: number;
  mediaOnly: number;
  deleted: number;
  skipped: number;
  earliestMessageAt: string | null;
  latestMessageAt: string | null;
}

export const EMPTY_COUNTERS: CoverageCounters = {
  conversationsDiscovered: 0,
  conversationsProcessed: 0,
  messagesDiscovered: 0,
  messagesProcessed: 0,
  incoming: 0,
  humanOutbound: 0,
  aiOutbound: 0,
  system: 0,
  mediaOnly: 0,
  deleted: 0,
  skipped: 0,
  earliestMessageAt: null,
  latestMessageAt: null,
};

export interface CoverageVerdict {
  status: CoverageStatus;
  note: string;
}

/**
 * Qamrovni BAHOLAYDI.
 *
 * `exhausted` — sahifalash oxiriga yetganmi. Bu ALOHIDA argument
 * ataylab: sanoqlar teng bo'lishi mumkin, lekin yugurish yarmida
 * to'xtagan bo'lsa (vaqt byudjeti tugadi), qamrov to'liq emas.
 */
export function evaluateCoverage(input: {
  counters: CoverageCounters;
  failedBatches: readonly FailedBatch[];
  exhausted: boolean;
}): CoverageVerdict {
  const { counters, failedBatches, exhausted } = input;

  if (!exhausted) {
    return {
      status: "partial",
      note:
        `Sahifalash tugamagan: ${counters.conversationsProcessed} ta suhbat ishlandi, ` +
        "qolgani keyingi yugurishda davom etadi.",
    };
  }

  if (failedBatches.length > 0) {
    const lost = failedBatches.reduce((sum, batch) => sum + batch.conversationIds.length, 0);
    return {
      status: "partial",
      note:
        `${failedBatches.length} ta batch xato bilan tugadi (${lost} ta suhbat ishlanmadi). ` +
        "Natijalar shu suhbatlarsiz hisoblangan.",
    };
  }

  if (counters.conversationsProcessed < counters.conversationsDiscovered) {
    const missing = counters.conversationsDiscovered - counters.conversationsProcessed;
    return {
      status: "partial",
      note: `${missing} ta topilgan suhbat ishlanmadi.`,
    };
  }

  if (counters.conversationsDiscovered === 0) {
    return { status: "unknown", note: "Hech qanday suhbat topilmadi." };
  }

  return {
    status: "full",
    note:
      `Barcha ${counters.conversationsDiscovered} ta suhbat va ` +
      `${counters.messagesProcessed} ta xabar ishlandi.`,
  };
}

/* -------------------------------- ETA ----------------------------------- */

export interface EtaEstimate {
  /** Kuzatilgan tezlik — suhbat/sekund. */
  ratePerSecond: number | null;
  etaSeconds: number | null;
  note: string;
}

/**
 * ETA — FAQAT KUZATILGAN TEZLIKDAN (7-band).
 *
 * "Taxminan 5 daqiqa" deb yozib qo'yish oson, lekin u yolg'on
 * bo'ladi va admin unga ishonib kutadi. Agar hali yetarli
 * o'lchov bo'lmasa — `null` qaytariladi va UI "hisoblanmoqda"
 * deb ko'rsatadi.
 */
export function estimateEta(input: {
  processed: number;
  total: number;
  elapsedMs: number;
  /** Shundan kam ishlangan bo'lsa tezlik ishonchsiz. */
  minSample?: number;
}): EtaEstimate {
  const minSample = input.minSample ?? 5;

  if (input.processed < minSample || input.elapsedMs <= 0) {
    return {
      ratePerSecond: null,
      etaSeconds: null,
      note: "Tezlik hali o‘lchanmadi — ETA ko‘rsatilmaydi.",
    };
  }

  const ratePerSecond = input.processed / (input.elapsedMs / 1000);
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
    return { ratePerSecond: null, etaSeconds: null, note: "Tezlik hisoblab bo‘lmadi." };
  }

  const remaining = Math.max(0, input.total - input.processed);
  return {
    ratePerSecond: Math.round(ratePerSecond * 1000) / 1000,
    etaSeconds: Math.round(remaining / ratePerSecond),
    note: `Kuzatilgan tezlik: ${ratePerSecond.toFixed(2)} suhbat/sek.`,
  };
}

/* ----------------------------- keyset kursori ---------------------------- */

export interface Cursor {
  lastMessageAt: string | null;
  conversationId: string | null;
}

/**
 * KEYSET SAHIFALASH, OFFSET EMAS.
 *
 * `offset` 20 000 qatorda sekin ishlaydi va — muhimrog'i —
 * BARQAROR EMAS: yugurish davomida yangi xabar kelsa tartib
 * siljiydi va bitta suhbat IKKI MARTA yoki UMUMAN ko'rilmay
 * qolishi mumkin. Keyset kursori `(last_message_at, id)`
 * juftligiga tayanadi va u siljimaydi.
 *
 * `id` ikkinchi kalit sifatida SHART: bir necha suhbatning
 * `last_message_at` i bir xil bo'lishi mumkin (bir sekundda
 * import qilingan), u holda faqat vaqt bo'yicha sahifalash
 * cheksiz aylanardi.
 */
export function nextCursor(
  rows: ReadonlyArray<{ id: string; lastMessageAt: string | null }>,
): Cursor | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return { lastMessageAt: last.lastMessageAt, conversationId: last.id };
}

/** Kursor oldinga siljidimi — cheksiz sikldan himoya. */
export function cursorAdvanced(previous: Cursor | null, next: Cursor | null): boolean {
  if (!next) return false;
  if (!previous) return true;
  return (
    previous.conversationId !== next.conversationId ||
    previous.lastMessageAt !== next.lastMessageAt
  );
}
