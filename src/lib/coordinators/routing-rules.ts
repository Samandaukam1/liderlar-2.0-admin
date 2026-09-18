/**
 * LID MARSHRUTLASH QOIDALARI — SOF MODUL.
 *
 * Bu yerda baza ham, Telegram ham yo'q: faqat "kimga berish kerak"
 * degan qaror. Shu sababli poyga holatlari va adolat qoidasi
 * haqiqiy testlar bilan qoplanadi — ular bazaga bog'lanmaydi.
 */

/** Taklif oynasi — sozlamadan keladi, bu faqat zaxira. */
export const DEFAULT_CLAIM_WINDOW_MINUTES = 10;

export interface EligibleCoordinator {
  id: string;
  regionId: string | null;
  status: string;
  isActive: boolean;
  backupPriority: number;
  /** Bugun nechta lid TAKLIF qilingan. */
  offeredToday: number;
  /** Hozir qo'lidagi ochiq (yopilmagan) lidlar. */
  openLeads: number;
  /** Bugun tasdiqlangan sotuvlar. */
  confirmedToday: number;
  /** Kunlik chegara. NULL — cheklovsiz. */
  dailyLeadLimit: number | null;
}

/**
 * Koordinator yangi lid OLISHI mumkinmi.
 *
 * `paused`, `offline` va `suspended` — uchtasi ham yangi taklif
 * olmaydi, lekin QO'LIDAGI lidlar o'zida qoladi: ularni tortib
 * olish mijoz bilan boshlangan suhbatni uzib qo'yardi.
 */
export function canReceiveLeads(coordinator: EligibleCoordinator): boolean {
  if (!coordinator.isActive) return false;
  if (coordinator.status !== "active") return false;
  if (
    coordinator.dailyLeadLimit != null &&
    coordinator.offeredToday >= coordinator.dailyLeadLimit
  ) {
    return false;
  }
  return true;
}

/**
 * ADOLATLI TANLOV — TASODIF EMAS.
 *
 * Tartib (texnik topshiriq 22-band):
 *   1. bugun eng kam taklif olgan;
 *   2. ochiq lidlari eng kam;
 *   3. bugun tasdiqlangan sotuvi eng kam;
 *   4. `backup_priority` (kichikroq — oldin);
 *   5. id bo'yicha barqaror tenglik.
 *
 * NEGA TASODIF EMAS: `random()` bilan bir koordinator ketma-ket
 * o'nta lid olib, ikkinchisi bittasini ham olmasligi mumkin va buni
 * hech kim tushuntira olmaydi. Bu tartib esa har doim bir xil
 * natija beradi va uni testda tekshirib bo'ladi.
 *
 * BIRINCHI MEZON "TAKLIF", "BAND QILINGAN" EMAS: aks holda
 * takliflarni e'tiborsiz qoldiradigan koordinator cheksiz yangi
 * lid olib turardi — tizim uni "bo'sh" deb ko'rardi.
 */
export function pickOverflowCoordinator(
  candidates: readonly EligibleCoordinator[],
  options: { excludeIds?: readonly string[] } = {},
): EligibleCoordinator | null {
  const excluded = new Set(options.excludeIds ?? []);
  const eligible = candidates.filter(
    (c) => canReceiveLeads(c) && !excluded.has(c.id),
  );
  if (eligible.length === 0) return null;

  return [...eligible].sort(compareForOverflow)[0];
}

export function compareForOverflow(
  a: EligibleCoordinator,
  b: EligibleCoordinator,
): number {
  if (a.offeredToday !== b.offeredToday) return a.offeredToday - b.offeredToday;
  if (a.openLeads !== b.openLeads) return a.openLeads - b.openLeads;
  if (a.confirmedToday !== b.confirmedToday) return a.confirmedToday - b.confirmedToday;
  if (a.backupPriority !== b.backupPriority) return a.backupPriority - b.backupPriority;
  // Oxirgi mezon — barqaror va takrorlanadigan.
  return a.id.localeCompare(b.id);
}

/**
 * Hududning O'Z koordinatorlari — birinchi navbat.
 *
 * Bir hududda bir nechta koordinator bo'lishi mumkin; ular orasida
 * ham o'sha adolat tartibi ishlaydi.
 */
export function pickRegionalCoordinator(
  candidates: readonly EligibleCoordinator[],
  regionId: string | null,
): EligibleCoordinator | null {
  if (!regionId) return null;
  const regional = candidates.filter((c) => c.regionId === regionId);
  return pickOverflowCoordinator(regional);
}

/** Taklif muddati. */
export function claimDeadline(offeredAt: Date, windowMinutes: number): Date {
  return new Date(offeredAt.getTime() + windowMinutes * 60_000);
}

export function isExpired(deadline: string | Date | null, now: Date = new Date()): boolean {
  if (!deadline) return false;
  const at = typeof deadline === "string" ? Date.parse(deadline) : deadline.getTime();
  return Number.isFinite(at) && at <= now.getTime();
}

/* ---------------------------- Toshkent kuni ------------------------------ */

/**
 * Ish kuni TOSHKENT bo'yicha (57-band).
 *
 * UTC yarim tuni bu yerda noto'g'ri: u Toshkentda soat 05:00, ya'ni
 * ish kuni allaqachon boshlangan bo'ladi. Ertalab 04:00 da qilingan
 * sotuv UTC bo'yicha "kecha" ga tushib, kunlik reyting va talab
 * hisobini buzardi.
 */
export const TASHKENT_OFFSET_HOURS = 5;

export function businessDate(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + TASHKENT_OFFSET_HOURS * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

/** Toshkent kunining UTC chegaralari — so'rovlar uchun. */
export function businessDayRange(date: string): { startIso: string; endIso: string } {
  const start = new Date(`${date}T00:00:00.000Z`).getTime() - TASHKENT_OFFSET_HOURS * 3_600_000;
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + 86_400_000).toISOString(),
  };
}
