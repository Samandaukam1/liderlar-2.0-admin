/**
 * To'lov savoli va hisobot matnlari — sof modul.
 *
 * Bu yerda I/O yo'q, shuning uchun callback_data formati, tugma yorliqlari va
 * xabar matnlari haqiqiy unit testlar bilan qoplanadi (source-text assertion
 * emas). Xabarlar ATAYLAB oddiy matn: MarkdownV2 bo'lganda ismdagi bitta
 * nuqta yoki qavs butun yuborishni 400 bilan yiqitadi.
 */

// Relative, not "@/": this module is exercised by the raw node:test runner,
// which resolves no tsconfig path aliases.
import { formatTashkent } from "../tashkent-day.ts";

/** The persistent keyboard button that asks the bot for a status report. */
export const REPORT_BUTTON_LABEL = "📊 Hozirgi hisobot";

export const PAYMENT_YES_LABEL = "✅ Ha, to‘lov qildi";
export const PAYMENT_NO_LABEL = "❌ Yo‘q, hali qilmadi";

/**
 * Callback payload.
 *
 * Telegram caps callback_data at 64 BYTES, so the prefix is kept to four
 * characters: "pay:y:" + a 36-character uuid is 42 bytes, well inside it.
 */
const CALLBACK_PREFIX = "pay:";

export function paymentCallbackData(intakeId: string, paid: boolean): string {
  return `${CALLBACK_PREFIX}${paid ? "y" : "n"}:${intakeId}`;
}

export interface ParsedPaymentCallback {
  intakeId: string;
  paid: boolean;
}

/**
 * Reads a tapped button back into an intake id and an answer.
 *
 * Anything that is not ours — another feature's button, a truncated payload, a
 * malformed id — returns null so the caller can ignore it silently instead of
 * writing a payment status for a garbage id.
 */
export function parsePaymentCallback(data: string | undefined | null): ParsedPaymentCallback | null {
  if (!data || !data.startsWith(CALLBACK_PREFIX)) return null;
  const [, answer, intakeId] = data.split(":");
  if (answer !== "y" && answer !== "n") return null;
  if (!isUuid(intakeId)) return null;
  return { intakeId, paid: answer === "y" };
}

function isUuid(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export interface PaymentQuestionCandidate {
  fullName: string;
  phone: string | null;
  telegramUsername: string | null;
  submittedAt: string | null;
  /** Which round of asking this is — shown so a repeat is obviously a repeat. */
  round: number;
}

export function buildPaymentQuestion(candidate: PaymentQuestionCandidate): string {
  const lines = [
    "💳 TO‘LOV TEKSHIRUVI",
    "",
    `👤 ${candidate.fullName}`,
  ];
  if (candidate.phone) lines.push(`📱 ${candidate.phone}`);
  if (candidate.telegramUsername) {
    lines.push(`💬 ${formatUsername(candidate.telegramUsername)}`);
  }
  lines.push(`🕐 Anketa: ${formatTashkent(candidate.submittedAt)}`);
  if (candidate.round > 1) lines.push(`🔁 ${candidate.round}-so‘rov`);
  lines.push("", "Ushbu nomzod to‘lov qildimi?");
  return lines.join("\n");
}

function formatUsername(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

/** What an answered question's message is rewritten to, in every chat. */
export function buildPaymentAnswerText(
  candidate: Pick<PaymentQuestionCandidate, "fullName">,
  paid: boolean,
  answeredAt: Date = new Date(),
): string {
  const lines = [
    "💳 TO‘LOV TEKSHIRUVI",
    "",
    `👤 ${candidate.fullName}`,
    "",
    paid ? "✅ TO‘LOV QILGAN deb belgilandi" : "❌ To‘lov qilmagan deb belgilandi",
    `🕐 ${formatTashkent(answeredAt)}`,
    "",
    paid
      ? "Maqola nashr qilinib, post tayyorlanmoqda…"
      : "2 soatdan keyin qayta so‘raladi.",
  ];
  return lines.join("\n");
}

export interface BotStatusCounts {
  /** Anketani to'ldirayotganlar (draft). */
  filling: number;
  /** Anketani to'ldirib yuborganlar (submitted va undan keyingi holatlar). */
  submitted: number;
  paid: number;
  unpaid: number;
  /** To'lov holati hali so'ralmagan/javobsiz. */
  paymentUnknown: number;
  /** Post yaratilgan nomzodlar. */
  posts: number;
  /** Saytda chop etilgan nomzodlar. */
  published: number;
}

export interface BotStatusReportInput {
  total: BotStatusCounts;
  today: BotStatusCounts;
  /** Tashkent calendar date the "today" block covers. */
  todayDate: string;
}

export function buildBotStatusReportText(input: BotStatusReportInput): string {
  const { total, today } = input;
  return [
    "📊 HOZIRGI HISOBOT",
    `🕐 ${formatTashkent(new Date())}`,
    "",
    "— JAMI —",
    `✍️ To‘ldirmoqda: ${total.filling}`,
    `📝 To‘ldirib yuborgan: ${total.submitted}`,
    `✅ To‘lov qilgan: ${total.paid}`,
    `⏳ To‘lov qilmagan: ${total.unpaid}`,
    `❔ Javob berilmagan: ${total.paymentUnknown}`,
    `🖼 Postga aylantirilgan: ${total.posts}`,
    `🌐 Saytda chop etilgan: ${total.published}`,
    "",
    `— BUGUN (${input.todayDate}) —`,
    `✍️ To‘ldirmoqda: ${today.filling}`,
    `📝 To‘ldirib yuborgan: ${today.submitted}`,
    `✅ To‘lov qilgan: ${today.paid}`,
    `⏳ To‘lov qilmagan: ${today.unpaid}`,
    `🖼 Postga aylantirilgan: ${today.posts}`,
    `🌐 Saytda chop etilgan: ${today.published}`,
  ].join("\n");
}
