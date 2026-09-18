/**
 * KOORDINATOR BOTI — matn va tugmalar. SOF MODUL.
 *
 * BITTA BOT BARCHA HUDUDLAR UCHUN. 14 ta alohida bot emas: har
 * biriga token, webhook, deploy va kuzatuv kerak bo'lardi, va
 * koordinator hududi o'zgarganda uni boshqa botga ko'chirish kerak
 * bo'lardi. Bitta bot esa odamni Telegram RAQAMLI id'si bo'yicha
 * tanib, hududini bazadan o'qiydi.
 */

export const COORD_MENU = {
  newLeads: "🆕 Yangi lidlar",
  myClaimed: "📌 Band qilganlarim",
  inProgress: "⏳ Jarayonda",
  waitingPayment: "💳 To‘lov kutilmoqda",
  mySales: "✅ Sotuvlarim",
  report: "📊 Hisobot",
  earnings: "💰 Daromadim",
  leaderboard: "🏆 Reyting",
  notifications: "🔔 Bildirishnomalar",
} as const;

export type CoordMenuKey = keyof typeof COORD_MENU;

export function coordinatorKeyboard(): string[][] {
  return [
    [COORD_MENU.newLeads, COORD_MENU.myClaimed],
    [COORD_MENU.inProgress, COORD_MENU.waitingPayment],
    [COORD_MENU.mySales, COORD_MENU.report],
    [COORD_MENU.earnings, COORD_MENU.leaderboard],
    [COORD_MENU.notifications],
  ];
}

/** Bosilgan tugma matn sifatida keladi — uni kalitga qaytaramiz. */
export const MENU_BY_LABEL: Readonly<Record<string, CoordMenuKey>> = Object.fromEntries(
  (Object.entries(COORD_MENU) as [CoordMenuKey, string][]).map(([key, label]) => [label, key]),
);

/* ------------------------------ callback --------------------------------- */

const CLAIM_PREFIX = "cl:";

export function claimCallbackData(leadId: string): string {
  return `${CLAIM_PREFIX}${leadId}`;
}

/** uuid shakli tekshiriladi: ixtiyoriy matn bazaga so'rov bo'lmasin. */
export function parseClaimCallback(data: string | null | undefined): string | null {
  if (!data || !data.startsWith(CLAIM_PREFIX)) return null;
  const id = data.slice(CLAIM_PREFIX.length).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export const CLAIM_BUTTON_LABEL = "🙋 BAND QILISH";

/* ------------------------------ xabarlar --------------------------------- */

export interface LeadNotification {
  fullName: string;
  regionName: string | null;
  appliedAt: string | null;
  claimWindowMinutes: number;
}

/**
 * Yangi lid xabari.
 *
 * TELEFON RAQAM VA BOSHQA SHAXSIY MA'LUMOT YO'Q. Bu xabar hali
 * hech kimga biriktirilmagan lid haqida va u bir nechta
 * koordinatorga ketishi mumkin. Kontakt band qilingandan KEYIN
 * beriladi — mas'ul aniq bo'lgach.
 */
export function buildLeadNotification(input: LeadNotification): string {
  const lines = [
    "🆕 YANGI LID",
    "",
    `Hudud: ${input.regionName ?? "aniqlanmagan"}`,
    `Nomzod: ${input.fullName}`,
  ];
  if (input.appliedAt) lines.push(`Ariza vaqti: ${formatTime(input.appliedAt)}`);
  lines.push("", `⏱ Band qilish uchun: ${input.claimWindowMinutes} daqiqa`);
  return lines.join("\n");
}

export const CLAIM_WON_REPLY = "✅ Lid sizga biriktirildi.";

/** Yutqazgan koordinatorga — AYNAN sababi bilan, "bo'lmadi" emas. */
export function claimLostReply(reason: string | null): string {
  switch (reason) {
    case "already_claimed":
      return "Bu lid boshqa koordinator tomonidan band qilindi.";
    case "expired":
      return "Band qilish muddati tugagan — lid boshqasiga yo‘naltirildi.";
    case "coordinator_not_eligible":
      return "Hozir sizga yangi lid biriktirilmaydi (holatingiz faol emas).";
    default:
      return "Bu lid hozir mavjud emas.";
  }
}

export const NOT_A_COORDINATOR_REPLY = [
  "Bu bot faqat Liderlar.uz hududiy koordinatorlari uchun.",
  "",
  "Agar siz koordinator bo‘lsangiz, administrator sizni tizimga kiritishi kerak.",
].join("\n");

export const COORDINATOR_PAUSED_REPLY =
  "Holatingiz hozir faol emas — yangi lidlar kelmaydi. Qo‘lingizdagi lidlar o‘zingizda qoladi.";

export function buildStartReply(fullName: string, regionName: string | null): string {
  return [
    `Assalomu alaykum, ${fullName}!`,
    "",
    `Hududingiz: ${regionName ?? "biriktirilmagan"}`,
    "",
    "Quyidagi menyudan foydalaning.",
  ].join("\n");
}

/* ------------------------------- hisobot --------------------------------- */

export interface CoordinatorReport {
  offered: number;
  claimed: number;
  contacted: number;
  inProgress: number;
  waitingPayment: number;
  confirmedSales: number;
  lost: number;
  /** Sekundlarda. Ma'lumot yetarli bo'lmasa null. */
  avgClaimSeconds: number | null;
  earnedToday: number;
  earnedWeek: number;
  earnedMonth: number;
  pendingAmount: number;
  earnedAmount: number;
  paidAmount: number;
  reversedAmount: number;
  attention: string[];
}

/**
 * Hisobot matni.
 *
 * KONVERSIYA MAXRAJI BILAN: "73%" o'zi hech narsa aytmaydi,
 * "8 / 11" aytadi. Maxraj nol bo'lsa foiz UMUMAN ko'rsatilmaydi —
 * "0%" bilan "hali lid yo'q" bir xil narsa emas va birinchisi
 * koordinatorni yomon ishlayotgandek ko'rsatardi.
 */
export function buildReportText(report: CoordinatorReport): string {
  const lines = [
    "📊 HISOBOT — BUGUN",
    "",
    `Yuborilgan lidlar: ${report.offered}`,
    `Band qilingan: ${report.claimed}`,
    `Bog‘lanilgan: ${report.contacted}`,
    `Jarayonda: ${report.inProgress}`,
    `To‘lov kutilmoqda: ${report.waitingPayment}`,
    `Tasdiqlangan sotuv: ${report.confirmedSales}`,
    `Yo‘qotilgan: ${report.lost}`,
  ];

  if (report.claimed > 0) {
    const rate = Math.round((report.confirmedSales / report.claimed) * 100);
    lines.push(`Konversiya: ${report.confirmedSales} / ${report.claimed} = ${rate}%`);
  } else {
    lines.push("Konversiya: hali hisoblab bo‘lmaydi");
  }

  lines.push(
    report.avgClaimSeconds == null
      ? "O‘rtacha band qilish vaqti: ma’lumot yetarli emas"
      : `O‘rtacha band qilish vaqti: ${formatDuration(report.avgClaimSeconds)}`,
  );

  lines.push(
    "",
    "💰 DAROMAD",
    `Bugun: ${formatSom(report.earnedToday)}`,
    `Shu hafta: ${formatSom(report.earnedWeek)}`,
    `Shu oy: ${formatSom(report.earnedMonth)}`,
    "",
    `Kutilmoqda: ${formatSom(report.pendingAmount)}`,
    `Ishlab topilgan: ${formatSom(report.earnedAmount)}`,
    `To‘langan: ${formatSom(report.paidAmount)}`,
  );
  if (report.reversedAmount > 0) {
    lines.push(`Bekor qilingan: ${formatSom(report.reversedAmount)}`);
  }

  if (report.attention.length > 0) {
    /*
     * AYBLOV EMAS, HOLAT.
     *
     * "Eng yomon xodim" degan yorliq odamni himoyalanishga majbur
     * qiladi, muammoni hal qilishga emas — va u raqamlarni
     * yashirishga undaydi.
     */
    lines.push("", "🔔 E’TIBOR TALAB QILADI");
    for (const item of report.attention) lines.push(`• ${item}`);
  }

  return lines.join("\n");
}

export function formatSom(amount: number): string {
  return `${amount.toLocaleString("ru-RU").replace(/ /g, " ")} so‘m`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} soniya`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} daqiqa`;
  return `${Math.round(minutes / 60)} soat`;
}

function formatTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}
