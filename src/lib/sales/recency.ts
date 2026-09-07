/**
 * Uslub o'rganishdagi "yangilik" og'irliklari.
 *
 * NEGA KERAK: sotuvchining yozish uslubi vaqt bilan o'zgaradi. Ikki yil
 * oldingi suhbat bugungi ohangni bir xil kuch bilan belgilasa, profil
 * eskirgan uslubga tortiladi. Shuning uchun har bir namuna yoshiga qarab
 * og'irlik oladi va o'rtacha OG'IRLANGAN o'rtacha bo'ladi.
 *
 * Standart jadval (texnik topshiriqdan):
 *   0–7 kun    1.00
 *   8–30 kun   0.80
 *   31–90 kun  0.50
 *   91–180 kun 0.30
 *   180+ kun   0.15
 *
 * Qiymatlar KODDA QOTIB QOLMAGAN: `sales_settings.recency_buckets` dagi
 * JSON ustun keladi, bu yerdagisi faqat zaxira. Sozlamalar sahifasi shu
 * jadvalni tahrirlaydi.
 */

export interface RecencyBucket {
  /** Shu kunlar ichidagi (shu kun ham kiradi) namunaga tegishli. */
  maxAgeDays: number | null;
  weight: number;
}

export const DEFAULT_RECENCY_BUCKETS: readonly RecencyBucket[] = [
  { maxAgeDays: 7, weight: 1.0 },
  { maxAgeDays: 30, weight: 0.8 },
  { maxAgeDays: 90, weight: 0.5 },
  { maxAgeDays: 180, weight: 0.3 },
  { maxAgeDays: null, weight: 0.15 },
];

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Ikki sana orasidagi to'liq kunlar. Kelajakdagi sana 0 yosh beradi. */
export function ageInDays(sentAt: string | Date, now: string | Date = new Date()): number {
  const then = sentAt instanceof Date ? sentAt : new Date(sentAt);
  const ref = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(then.getTime()) || Number.isNaN(ref.getTime())) return 0;
  return Math.max(0, Math.floor((ref.getTime() - then.getTime()) / DAY_MS));
}

/**
 * Yoshga mos og'irlik. Bucketlar `maxAgeDays` bo'yicha o'sish tartibida
 * ko'rib chiqiladi; `maxAgeDays: null` — oxirgi, cheksiz bucket.
 */
export function recencyWeight(
  ageDays: number,
  buckets: readonly RecencyBucket[] = DEFAULT_RECENCY_BUCKETS,
): number {
  const ordered = sortBuckets(buckets);
  for (const bucket of ordered) {
    if (bucket.maxAgeDays === null) return bucket.weight;
    if (ageDays <= bucket.maxAgeDays) return bucket.weight;
  }
  // Cheksiz bucket berilmagan bo'lsa — eng eski bucket og'irligi.
  return ordered.length > 0 ? ordered[ordered.length - 1].weight : 0;
}

/** Sana bo'yicha og'irlik — `ageInDays` + `recencyWeight` birgalikda. */
export function weightForDate(
  sentAt: string | Date,
  now: string | Date = new Date(),
  buckets: readonly RecencyBucket[] = DEFAULT_RECENCY_BUCKETS,
): number {
  return recencyWeight(ageInDays(sentAt, now), buckets);
}

/** `maxAgeDays` o'sish bo'yicha; cheksiz (null) bucket doim oxirida. */
function sortBuckets(buckets: readonly RecencyBucket[]): RecencyBucket[] {
  return [...buckets].sort((a, b) => {
    if (a.maxAgeDays === null) return 1;
    if (b.maxAgeDays === null) return -1;
    return a.maxAgeDays - b.maxAgeDays;
  });
}

/**
 * Sozlamalardan kelgan JSON'ni tekshiradi.
 *
 * Nosoz konfiguratsiya uslub tahlilini JIMGINA buzishi mumkin (masalan
 * hamma og'irlik 0 bo'lsa profil bo'sh chiqadi), shuning uchun validatsiya
 * qattiq: yaroqsiz bo'lsa standart jadval qaytadi.
 */
export function parseRecencyBuckets(value: unknown): readonly RecencyBucket[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_RECENCY_BUCKETS;

  const parsed: RecencyBucket[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return DEFAULT_RECENCY_BUCKETS;
    const item = raw as Record<string, unknown>;
    const maxAgeDays = item.maxAgeDays;
    const weight = item.weight;

    const ageOk =
      maxAgeDays === null ||
      (typeof maxAgeDays === "number" && Number.isFinite(maxAgeDays) && maxAgeDays > 0);
    const weightOk =
      typeof weight === "number" && Number.isFinite(weight) && weight >= 0 && weight <= 1;
    if (!ageOk || !weightOk) return DEFAULT_RECENCY_BUCKETS;

    parsed.push({ maxAgeDays: maxAgeDays as number | null, weight: weight as number });
  }

  // Hech bo'lmasa bitta musbat og'irlik bo'lmasa, tahlil ma'nosini yo'qotadi.
  if (!parsed.some((b) => b.weight > 0)) return DEFAULT_RECENCY_BUCKETS;
  return sortBuckets(parsed);
}

/** UI uchun o'qiladigan tavsif: "0–7 kun". */
export function bucketLabel(
  bucket: RecencyBucket,
  buckets: readonly RecencyBucket[] = DEFAULT_RECENCY_BUCKETS,
): string {
  const ordered = sortBuckets(buckets);
  const index = ordered.findIndex(
    (b) => b.maxAgeDays === bucket.maxAgeDays && b.weight === bucket.weight,
  );
  const previous = index > 0 ? ordered[index - 1].maxAgeDays : null;
  const from = previous === null ? 0 : previous + 1;
  if (bucket.maxAgeDays === null) return `${from}+ kun`;
  return `${from}–${bucket.maxAgeDays} kun`;
}
