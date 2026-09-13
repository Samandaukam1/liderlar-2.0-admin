/**
 * JAVOB SAMARADORLIGI TAHLILI — SOF MODUL.
 *
 * ── NIMA UCHUN EHTIYOTKOR (37-band) ──────────────────────────────
 *
 * Mavjud `sales_response_patterns` jadvalida `success_rate` bor
 * edi, lekin NAMUNA HAJMI yo'q edi. Natijada 1/1 = 100% va
 * 340/400 = 85% admin panelida bir xil ko'rinardi va birinchisi
 * ikkinchisidan "yaxshiroq" bo'lib chiqardi.
 *
 * IKKI QAT'IY QOIDA:
 *
 *   1. FOIZ HECH QACHON NAMUNA HAJMISIZ KO'RSATILMAYDI.
 *   2. SABABIYAT DA'VO QILINMAYDI. "Bu javobdan keyin sotuv
 *      bo'lgan" ≠ "bu javob sotuvga olib kelgan". Mijoz
 *      allaqachon qaror qilgan bo'lishi mumkin.
 *
 * Shuningdek STRATEGIYA va FAKT ajratiladi: eski javobda yaxshi
 * yondashuv bo'lishi, lekin narxi eskirgan bo'lishi mumkin.
 */

export const OUTCOME_BUCKETS = [
  "positive_followup",
  "intake_submitted",
  "payment_confirmed",
  "dropoff",
  "unknown",
] as const;
export type OutcomeBucket = (typeof OUTCOME_BUCKETS)[number];

export const OUTCOME_BUCKET_LABELS: Record<OutcomeBucket, string> = {
  positive_followup: "Mijoz javob berdi",
  intake_submitted: "Anketa topshirildi",
  payment_confirmed: "To‘lov TASDIQLANDI",
  dropoff: "Uzildi",
  unknown: "Noma’lum",
};

export interface PatternObservation {
  strategyKey: string;
  intentKey: string | null;
  objectionKind: string | null;
  stage: string | null;
  outcome: OutcomeBucket;
  conversationId: string;
}

export interface PatternStats {
  strategyKey: string;
  intentKey: string | null;
  objectionKind: string | null;
  stage: string | null;
  sampleN: number;
  conversationN: number;
  positiveFollowupN: number;
  intakeSubmittedN: number;
  paymentConfirmedN: number;
  dropoffN: number;
  unknownN: number;
  /** Kuzatuv oynasi — necha kunlik ma'lumot. */
  observationWindowDays: number | null;
  confidence: ConfidenceLevel;
  confidenceNote: string;
}

export const CONFIDENCE_LEVELS = ["insufficient", "low", "moderate"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  insufficient: "Namuna yetarli emas",
  low: "Past ishonch",
  moderate: "O‘rtacha ishonch",
};

/**
 * NAMUNA CHEGARALARI.
 *
 * `high` darajasi ATAYLAB YO'Q. Kuzatuv tajribasi emas —
 * bu o'tmishdagi yozishmalar; unda nazorat guruhi ham,
 * tasodifiylashtirish ham yo'q. Shuning uchun eng yuqori
 * daraja "o'rtacha ishonch" bo'lib qoladi.
 */
const MIN_SAMPLE_LOW = 10;
const MIN_SAMPLE_MODERATE = 40;

export function confidenceFor(sampleN: number): {
  level: ConfidenceLevel;
  note: string;
} {
  if (sampleN < MIN_SAMPLE_LOW) {
    return {
      level: "insufficient",
      note: `Faqat ${sampleN} ta kuzatuv — foiz ko‘rsatilmaydi.`,
    };
  }
  if (sampleN < MIN_SAMPLE_MODERATE) {
    return {
      level: "low",
      note: `${sampleN} ta kuzatuv — yo‘nalish sifatida qaralsin, isbot sifatida emas.`,
    };
  }
  return {
    level: "moderate",
    note: `${sampleN} ta kuzatuv. Sababiyat ISBOTLANMAGAN — bu faqat birgalikda uchrash.`,
  };
}

export function aggregatePatterns(
  observations: readonly PatternObservation[],
  options: { observationWindowDays?: number | null } = {},
): PatternStats[] {
  const groups = new Map<string, { stats: PatternStats; conversations: Set<string> }>();

  for (const observation of observations) {
    const key = [
      observation.strategyKey,
      observation.intentKey ?? "-",
      observation.objectionKind ?? "-",
      observation.stage ?? "-",
    ].join("|");

    let group = groups.get(key);
    if (!group) {
      group = {
        stats: {
          strategyKey: observation.strategyKey,
          intentKey: observation.intentKey,
          objectionKind: observation.objectionKind,
          stage: observation.stage,
          sampleN: 0,
          conversationN: 0,
          positiveFollowupN: 0,
          intakeSubmittedN: 0,
          paymentConfirmedN: 0,
          dropoffN: 0,
          unknownN: 0,
          observationWindowDays: options.observationWindowDays ?? null,
          confidence: "insufficient",
          confidenceNote: "",
        },
        conversations: new Set(),
      };
      groups.set(key, group);
    }

    group.stats.sampleN += 1;
    group.conversations.add(observation.conversationId);

    switch (observation.outcome) {
      case "positive_followup": group.stats.positiveFollowupN += 1; break;
      case "intake_submitted": group.stats.intakeSubmittedN += 1; break;
      case "payment_confirmed": group.stats.paymentConfirmedN += 1; break;
      case "dropoff": group.stats.dropoffN += 1; break;
      case "unknown": group.stats.unknownN += 1; break;
    }
  }

  const rows: PatternStats[] = [];
  for (const group of groups.values()) {
    group.stats.conversationN = group.conversations.size;
    const confidence = confidenceFor(group.stats.sampleN);
    group.stats.confidence = confidence.level;
    group.stats.confidenceNote = confidence.note;
    rows.push(group.stats);
  }

  return rows.sort((a, b) => b.sampleN - a.sampleN);
}

/**
 * Foizni FAQAT namuna yetarli bo'lganda beradi.
 *
 * `null` — "ko'rsatilmaydi" degani, "nol" emas. UI buni
 * "namuna yetarli emas" deb chiqaradi.
 */
export function rateOrNull(numerator: number, sampleN: number): number | null {
  if (sampleN < MIN_SAMPLE_LOW) return null;
  return Math.round((numerator / sampleN) * 1000) / 10;
}

/** Foizni matn qilib beradi — namuna hajmi BILAN BIRGA. */
export function formatRate(numerator: number, sampleN: number): string {
  const rate = rateOrNull(numerator, sampleN);
  if (rate == null) return `namuna yetarli emas (n=${sampleN})`;
  return `${rate}% (${numerator}/${sampleN})`;
}
