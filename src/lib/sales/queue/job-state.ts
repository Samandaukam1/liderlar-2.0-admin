/**
 * BARDOSHLI NAVBAT HOLAT MASHINASI — SOF MODUL.
 *
 * MUAMMO (27-band): `handleIncomingMessage()` qulfni ololmasa
 * `null` qaytarardi, webhook esa 200 berardi. Ya'ni xabar
 * SAQLANGAN, lekin unga javob berish ishi JIMGINA YO'QOLARDI.
 *
 * Mijoz ketma-ket uchta savol yozsa (bu juda oddiy holat),
 * ikkinchisi va uchinchisi qulfga urilib, hech qachon javob
 * olmasligi mumkin edi.
 *
 * YECHIM: qulf olinmasa ish NAVBATGA qo'yiladi. Navbat bazada,
 * shuning uchun serverless funksiya o'lsa ham yo'qolmaydi.
 *
 * BU MODUL SOF: qaror qoidalari shu yerda, baza `queue-store.ts` da.
 * Sabab — poyga holatlarini test bilan qoplash uchun qoidalar
 * I/O dan ajratilgan bo'lishi kerak.
 */

export const JOB_STATES = [
  "queued",
  "claimed",
  "waiting",
  "succeeded",
  "failed_retryable",
  "dead_letter",
  "skipped",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const JOB_STATE_LABELS: Record<JobState, string> = {
  queued: "Navbatda",
  claimed: "Olingan",
  waiting: "Kutmoqda",
  succeeded: "Bajarilgan",
  failed_retryable: "Xato — qayta urinadi",
  dead_letter: "Bajarilmadi (dead-letter)",
  skipped: "O‘tkazib yuborilgan",
};

/** Terminal holatlar — bulardan chiqilmaydi. */
const TERMINAL: readonly JobState[] = ["succeeded", "dead_letter", "skipped"];

export function isTerminal(state: JobState): boolean {
  return TERMINAL.includes(state);
}

/** Olish mumkin bo'lgan holatlar. */
const CLAIMABLE: readonly JobState[] = ["queued", "waiting", "failed_retryable"];

export function isClaimable(state: JobState): boolean {
  return CLAIMABLE.includes(state);
}

/* ------------------------------- retry ---------------------------------- */

/** Standart urinishlar chegarasi. Shundan keyin dead-letter. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Eksponensial backoff, yuqori chegarasi bilan.
 *
 * Chegara SHART: chegarasiz 10-urinish kunlar keyin bo'lardi va
 * mijoz javobni umuman olmasdi. 15 daqiqa — Telegram vaqtinchalik
 * xatolari odatda undan tez tuzaladi.
 */
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

export function backoffMs(attempts: number): number {
  const base = 5_000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(MAX_BACKOFF_MS, base);
}

export interface JobSnapshot {
  state: JobState;
  attempts: number;
  maxAttempts: number;
}

export interface FailureDecision {
  state: JobState;
  attempts: number;
  /** Keyingi urinish qachondan mumkin. */
  availableAt: Date | null;
  reason: string;
}

/**
 * Xatodan keyingi qaror.
 *
 * URINISHLAR CHEKLANGAN: cheksiz qayta urinish bir buzuq xabar
 * tufayli butun navbatni bloklardi va model xarajatini
 * cheksiz oshirardi.
 */
export function decideAfterFailure(
  job: JobSnapshot,
  options: { now?: Date; permanent?: boolean } = {},
): FailureDecision {
  const now = options.now ?? new Date();
  const attempts = job.attempts + 1;

  // Doimiy xato (masalan mijoz bloklagan) — qayta urinish foydasiz.
  if (options.permanent) {
    return {
      state: "dead_letter",
      attempts,
      availableAt: null,
      reason: "qaytarib bo‘lmaydigan xato",
    };
  }

  if (attempts >= job.maxAttempts) {
    return {
      state: "dead_letter",
      attempts,
      availableAt: null,
      reason: `urinishlar chegarasi (${job.maxAttempts}) tugadi`,
    };
  }

  return {
    state: "failed_retryable",
    attempts,
    availableAt: new Date(now.getTime() + backoffMs(attempts)),
    reason: `${Math.round(backoffMs(attempts) / 1000)} soniyadan keyin qayta urinadi`,
  };
}

/* ------------------------------- lease ---------------------------------- */

/**
 * Lease muddati.
 *
 * Worker o'lsa ish `claimed` holatida qolib ketardi va SUHBAT
 * BUTUNLAY BLOKLANARDI. Lease muddati o'tgach ish qaytadan
 * olinadi. 2 daqiqa — bitta javob yaratish + yuborishdan
 * sezilarli uzunroq.
 */
export const LEASE_MS = 2 * 60 * 1000;

export function leaseExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + LEASE_MS);
}

export function isLeaseExpired(leaseExpiresAt: string | null, now: Date = new Date()): boolean {
  if (!leaseExpiresAt) return true;
  const expires = Date.parse(leaseExpiresAt);
  return !Number.isFinite(expires) || expires <= now.getTime();
}

/* ---------------------------- tartib va idempotentlik -------------------- */

export interface QueuedJobRow {
  id: string;
  conversationId: string;
  messageId: string | null;
  state: JobState;
  enqueuedAt: string;
  priority: number;
  availableAt: string;
}

/**
 * Bitta suhbatdan FAQAT BITTA ish olinadi.
 *
 * SABAB: ikkita ish parallel bajarilsa, ikkinchi javob
 * birinchisidan OLDIN ketib qolishi mumkin va mijoz suhbatni
 * teskari tartibda o'qiydi. Bundan tashqari ikkalasi ham bir xil
 * kontekstni ko'rib, bir xil javob yozishi mumkin.
 */
export function selectNextJobs(
  rows: readonly QueuedJobRow[],
  options: { now?: Date; limit?: number } = {},
): QueuedJobRow[] {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 10;

  const ready = rows
    .filter((row) => isClaimable(row.state))
    .filter((row) => {
      const availableAt = Date.parse(row.availableAt);
      return !Number.isFinite(availableAt) || availableAt <= now.getTime();
    })
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Date.parse(a.enqueuedAt) - Date.parse(b.enqueuedAt) ||
        a.id.localeCompare(b.id),
    );

  const chosen: QueuedJobRow[] = [];
  const seenConversations = new Set<string>();
  for (const row of ready) {
    if (seenConversations.has(row.conversationId)) continue;
    seenConversations.add(row.conversationId);
    chosen.push(row);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

/**
 * IDEMPOTENTLIK KALITI.
 *
 * Telegram bitta update'ni bir necha marta yetkazishi MUMKIN
 * (bu ularning hujjatlashtirilgan xatti-harakati). Kalit
 * xabar identifikatoriga bog'langani uchun takroriy update
 * yangi ish YARATMAYDI va mijoz ikkita javob olmaydi.
 */
export function jobIdempotencyKey(input: {
  conversationId: string;
  messageId: string | null;
  kind: string;
}): string {
  return input.messageId
    ? `msg:${input.messageId}`
    : `conv:${input.conversationId}:${input.kind}`;
}
