/**
 * KUNLIK TALAB, NOMINATSIYA VA KOMISSIYA — SOF MODUL.
 *
 * Hammasi hisob-kitob: kirish ma'lumoti berilsa, natija har doim bir
 * xil. Shuning uchun "kim g'olib" degan savol testda tekshiriladi,
 * jonli bazada emas.
 */

import { businessDate } from "./routing-rules.ts";

/* ------------------------------- TALAB ----------------------------------- */

export interface DailyTargetRow {
  /** NULL — standart (barcha kunlar). */
  targetDate: string | null;
  /** NULL — milliy; to'ldirilgan bo'lsa shu hudud uchun. */
  regionId: string | null;
  targetSales: number;
}

/**
 * Shu SANAGA va shu HUDUDGA tegishli talab.
 *
 * Aniqlikdan umumiyga: sana+hudud → sana → hudud → standart.
 *
 * NEGA SANA BO'YICHA: talab ertaga 10 dan 15 ga o'zgarsa, KECHAGI
 * natija kechagi talab bilan baholanishi kerak. Faqat "hozirgi"
 * qiymat saqlansa, tarix har o'zgarishda qayta yozilardi va
 * "o'sha kuni talabni bajarganmiz" degan gap ma'nosini yo'qotardi.
 */
export function resolveTarget(
  rows: readonly DailyTargetRow[],
  date: string,
  regionId: string | null,
): number | null {
  const match = (d: string | null, r: string | null) =>
    rows.find((row) => row.targetDate === d && row.regionId === r);

  const found =
    (regionId ? match(date, regionId) : undefined) ??
    match(date, null) ??
    (regionId ? match(null, regionId) : undefined) ??
    match(null, null);

  return found?.targetSales ?? null;
}

export const TARGET_STATES = [
  "no_data",
  "no_target",
  "below_target",
  "near_target",
  "target_met",
  "top_performer",
] as const;
export type TargetState = (typeof TARGET_STATES)[number];

export const TARGET_STATE_LABELS: Record<TargetState, string> = {
  no_data: "Ma’lumot yo‘q",
  no_target: "Talab belgilanmagan",
  below_target: "Talabdan past",
  near_target: "Talabga yaqin",
  target_met: "Talab darajasida",
  top_performer: "Talabdan yuqori",
};

/** "Yaqin" chegarasi — talabning shuncha ulushi. */
export const NEAR_TARGET_RATIO = 0.7;
/** Shundan yuqori — alohida ta'kidlanadi. */
export const TOP_PERFORMER_RATIO = 1.3;

/**
 * Hudud holati.
 *
 * "Ma'lumot yo'q" va "nol sotuv" AJRATILADI: birinchisi hali hech
 * narsa bo'lmaganini, ikkinchisi esa haqiqatan sotuv bo'lmaganini
 * bildiradi. Ikkalasini "0" deb ko'rsatish xaritani yolg'on
 * qizilga bo'yardi.
 */
export function targetState(input: {
  confirmedSales: number | null;
  target: number | null;
}): TargetState {
  if (input.confirmedSales == null) return "no_data";
  if (input.target == null || input.target === 0) return "no_target";

  const ratio = input.confirmedSales / input.target;
  if (ratio >= TOP_PERFORMER_RATIO) return "top_performer";
  if (ratio >= 1) return "target_met";
  if (ratio >= NEAR_TARGET_RATIO) return "near_target";
  return "below_target";
}

/** Foiz — butun songa yaxlitlangan. Talab yo'q bo'lsa null. */
export function targetProgress(confirmed: number, target: number | null): number | null {
  if (target == null || target === 0) return null;
  return Math.round((confirmed / target) * 100);
}

/* ---------------------------- NOMINATSIYALAR ----------------------------- */

export interface CoordinatorDayStats {
  coordinatorId: string;
  coordinatorName: string;
  regionId: string | null;
  /** Band qilingan lidlar — konversiya MAXRAJI. */
  claimedLeads: number;
  confirmedSales: number;
  /**
   * Talabni kesib o'tgan sotuvning vaqti. Talab bajarilmagan bo'lsa
   * null. Hozirgi jami sondan CHIQARIB BO'LMAYDI — shuning uchun u
   * alohida yoziladi.
   */
  targetReachedAt: string | null;
}

export interface Nomination<T> {
  winners: T[];
  /** Nega shu natija — adminda ko'rsatiladi. */
  explanation: string;
  /** Teng natijalar bo'lsa — hammasi ko'rsatiladi, tasodifan tanlanmaydi. */
  tied: boolean;
}

/**
 * 🏁 ENG BIRINCHI TALABNI BAJARGAN.
 *
 * Talabni KESIB O'TGAN sotuvning vaqti bo'yicha, hozirgi jami son
 * bo'yicha emas. Farqi muhim: kun oxirida 20 ta sotgan odam
 * talabni 18:00 da, 10 ta sotgan esa 11:00 da bajargan bo'lishi
 * mumkin. "Birinchi" — vaqt haqidagi savol.
 */
export function firstToTarget(
  stats: readonly CoordinatorDayStats[],
): Nomination<CoordinatorDayStats> {
  const reached = stats.filter((s) => s.targetReachedAt != null);
  if (reached.length === 0) {
    return { winners: [], explanation: "Bugun talabni hech kim bajarmadi", tied: false };
  }

  const earliest = reached.reduce((best, current) =>
    Date.parse(current.targetReachedAt!) < Date.parse(best.targetReachedAt!) ? current : best,
  );
  const winners = reached.filter((s) => s.targetReachedAt === earliest.targetReachedAt);

  return {
    winners,
    explanation: `Talabni birinchi bo‘lib bajargan vaqt: ${formatTime(earliest.targetReachedAt!)}`,
    tied: winners.length > 1,
  };
}

/** 🏆 ENG KO'P SOTUV — tasdiqlangan sotuvlar soni bo'yicha. */
export function mostSales(
  stats: readonly CoordinatorDayStats[],
): Nomination<CoordinatorDayStats> {
  const withSales = stats.filter((s) => s.confirmedSales > 0);
  if (withSales.length === 0) {
    return { winners: [], explanation: "Bugun tasdiqlangan sotuv yo‘q", tied: false };
  }

  const max = Math.max(...withSales.map((s) => s.confirmedSales));
  const winners = withSales.filter((s) => s.confirmedSales === max);

  return {
    winners,
    // Teng natijada HAMMASI ko'rsatiladi: tasodifan bittasini tanlash
    // qolganlarining ishini ko'rinmas qilardi.
    explanation: `${max} ta tasdiqlangan sotuv`,
    tied: winners.length > 1,
  };
}

/**
 * ⚡ ENG SAMARALI — konversiya bo'yicha, LEKIN eng kam namuna bilan.
 *
 * MINIMAL MAXRAJSIZ BU KO'RSATKICH MA'NOSIZ: bitta lid olib bittasini
 * sotgan odam 100% bilan, 10 tadan 9 tasini sotganni (90%) yengardi.
 * Birinchisi omad, ikkinchisi ish.
 *
 * Chegara SOZLANADI va u statistik jihatdan "optimal" emas — shunchaki
 * ma'noli eng kichik namuna. Buni yashirmaslik kerak.
 */
export function mostEfficient(
  stats: readonly CoordinatorDayStats[],
  minimumLeads: number,
): Nomination<CoordinatorDayStats> {
  const eligible = stats.filter((s) => s.claimedLeads >= minimumLeads);
  if (eligible.length === 0) {
    return {
      winners: [],
      explanation: `Kamida ${minimumLeads} ta band qilingan lid kerak — bugun hech kimda yetmadi`,
      tied: false,
    };
  }

  const rate = (s: CoordinatorDayStats) => s.confirmedSales / s.claimedLeads;
  const best = Math.max(...eligible.map(rate));
  const winners = eligible.filter((s) => rate(s) === best);

  const sample = winners[0];
  return {
    winners,
    // MAXRAJ KO'RSATILADI: "90%" o'zi hech narsa aytmaydi, "9 / 10"
    // aytadi.
    explanation:
      `${sample.confirmedSales} / ${sample.claimedLeads} = ${Math.round(best * 100)}% ` +
      `(kamida ${minimumLeads} ta lid)`,
    tied: winners.length > 1,
  };
}

function formatTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}

/* ----------------------------- KOMISSIYA --------------------------------- */

export const COMMISSION_STATUSES = ["pending", "earned", "paid", "reversed"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/**
 * Komissiya YOZILADIMI.
 *
 * FAQAT `payment_confirmed`. Mijozning "to'ladim" degani, chek
 * yuborilgani yoki to'lov so'ralgani — hech biri pul kelganini
 * bildirmaydi. Ular bilan komissiya yozilsa, tizim bo'lmagan
 * daromadni hisoblab, koordinatorga qarz bo'lib qolardi.
 */
export function shouldCreateCommission(leadState: string): boolean {
  return leadState === "payment_confirmed" || leadState === "won";
}

export interface CommissionInput {
  leadState: string;
  coordinatorId: string | null;
  amountUzs: number;
  at?: Date;
}

export interface CommissionDraft {
  coordinatorId: string;
  amountUzs: number;
  businessDate: string;
  status: CommissionStatus;
}

export function buildCommission(input: CommissionInput): CommissionDraft | null {
  if (!shouldCreateCommission(input.leadState)) return null;
  if (!input.coordinatorId) return null;
  if (input.amountUzs <= 0) return null;

  return {
    coordinatorId: input.coordinatorId,
    amountUzs: input.amountUzs,
    // Toshkent kuni — kunlik daromad shu bo'yicha yig'iladi.
    businessDate: businessDate(input.at ?? new Date()),
    // To'lov tasdiqlangan, ya'ni ishlab topilgan. `pending` bu yerda
    // ortiqcha bosqich bo'lardi.
    status: "earned",
  };
}
