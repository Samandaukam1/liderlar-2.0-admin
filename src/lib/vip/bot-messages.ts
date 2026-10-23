/**
 * POST BOT: VIP BERISH — MATNLAR, TUGMALAR, CALLBACKLAR. SOF MODUL.
 *
 * Oqim:
 *   1. "👑 VIP berish" tugmasi (yoki /vip) → yo'riqnoma + "🔎 Nomzodni qidirish".
 *   2. Muharrir ismni harf-harf yozadi (Telegram inline rejimi) YOKI saytdagi
 *      biografiya havolasini yuboradi.
 *   3. Nomzod kartasi: akkaunt va VIP holati + tugmalar.
 *      · akkaunt YO'Q — faollashtirish havolasi +1/+2/+3 oy VIP bilan yoki VIPsiz;
 *        VIP akkaunt ochilgan lahzadan hisoblanadi;
 *      · akkaunt BOR — +1/+2/+3 oy VIP darhol (faol bo'lsa uzaytiriladi,
 *        tugagan bo'lsa qayta yoqiladi).
 *
 * Faqat nisbiy `.ts` import: testlar `@/` ni ko'rmaydi.
 */

import { formatTashkent, formatTashkentDate } from "../tashkent-day.ts";
import { vipDisplay, type SubscriptionState, type SubscriptionTimes } from "./subscription-rules.ts";

export const VIP_BUTTON_LABEL = "👑 VIP berish";
export const VIP_COMMAND = "/vip";
export const VIP_SEARCH_BUTTON_LABEL = "🔎 Nomzodni qidirish";

export const VIP_MONTH_OPTIONS = [1, 2, 3] as const;
export type VipMonths = (typeof VIP_MONTH_OPTIONS)[number];

/** 1 oy = 30 kun: VIP kunlarda yuritiladi (`vip_grant_days`), oy uzunligi esa har xil. */
export const DAYS_PER_MONTH = 30;

export function monthsToDays(months: VipMonths): number {
  return months * DAYS_PER_MONTH;
}

/* ========================================================================= *
 * CALLBACK
 *
 * "vip:l2:<uuid>" — VIP bilan havola (2 oy); "vip:l0:<uuid>" — VIPsiz havola;
 * "vip:g1:<uuid>" — akkaunti bor nomzodga darhol +1 oy. 43 bayt — Telegram
 * chegarasi (64) ichida.
 * ========================================================================= */

export type VipCallback =
  | { kind: "link"; months: 0 | VipMonths; candidateId: string }
  | { kind: "grant"; months: VipMonths; candidateId: string };

const CALLBACK = /^vip:([lg])([0-3]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function vipCallbackData(action: VipCallback): string {
  return `vip:${action.kind === "link" ? "l" : "g"}${action.months}:${action.candidateId}`;
}

export function parseVipCallback(data: string | null | undefined): VipCallback | null {
  const match = CALLBACK.exec((data ?? "").trim());
  if (!match) return null;
  const months = Number(match[2]);
  const candidateId = match[3].toLowerCase();
  if (match[1] === "l") return { kind: "link", months: months as 0 | VipMonths, candidateId };
  return months === 0 ? null : { kind: "grant", months: months as VipMonths, candidateId };
}

/* ========================================================================= *
 * XABARDAN NOMZODNI TANISH
 * ========================================================================= */

export type CandidateRef = { kind: "slug"; slug: string } | { kind: "id"; id: string };

/** Saytdagi biografiya: `<domen>/liderlar/<slug>` — domen ahamiyatsiz (preview ham). */
const BIO_LINK = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/liderlar\/([^\s/?#<>"')]+)/i;
/** Inline qidiruv natijasi biografiyasiz nomzod uchun shu belgini yuboradi. */
const ID_TOKEN = /🆔\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
/** Eski sayt postlari nomzodga bog'lanmagan — ulardan nomzodni topib bo'lmaydi. */
const LEGACY_LINK = /[a-z0-9-]+(?:\.[a-z0-9-]+)+\/(?:nomzodlar|tpost)\/[^\s/]+/i;

export function parseCandidateReference(text: string | null | undefined): CandidateRef | null {
  const value = text ?? "";
  const bio = BIO_LINK.exec(value);
  if (bio) {
    let slug = bio[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      /* buzilgan %-kodlash — xom holicha qidiriladi */
    }
    slug = slug.trim();
    if (slug) return { kind: "slug", slug };
  }
  const id = ID_TOKEN.exec(value);
  if (id) return { kind: "id", id: id[1].toLowerCase() };
  return null;
}

export function isLegacyBioLink(text: string | null | undefined): boolean {
  return LEGACY_LINK.test(text ?? "") && !BIO_LINK.test(text ?? "");
}

/* ========================================================================= *
 * KARTA
 * ========================================================================= */

export interface VipCard {
  candidateId: string;
  fullName: string;
  articleUrl: string | null;
  regionName: string | null;
  published: boolean;
  /** Nomzodning saytdagi akkaunti ochilganmi (`candidates.user_id`). */
  linked: boolean;
  /** Profilning ochiq obunasi, bo'lmasa eng oxirgisi. */
  subscription: { state: SubscriptionState; times: SubscriptionTimes } | null;
  /** Ishlatilmagan, amal qiladigan havola; VIP bilan bo'lsa — kunlari. */
  liveLink: { expiresAt: Date; vipDays: number | null } | null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function monthsWord(days: number): string {
  return days % DAYS_PER_MONTH === 0 ? `${days / DAYS_PER_MONTH} oy` : `${days} kun`;
}

/** VIP qachongacha: imtiyoz davri bo'lsa — o'sha. */
function vipEnd(times: SubscriptionTimes): Date | null {
  return times.graceUntil ?? times.currentPeriodEnd;
}

export type VipLineKind = "none" | "active" | "lifetime" | "expired" | "pending" | "suspended" | "cancelled";

export function vipLineKind(card: Pick<VipCard, "subscription">, now: Date): VipLineKind {
  const sub = card.subscription;
  if (!sub) return "none";
  if (sub.state === "suspended") return "suspended";
  if (sub.state === "cancelled") return "cancelled";
  const display = vipDisplay(sub, now);
  if (display.status === "active") return display.daysLeft === null ? "lifetime" : "active";
  if (display.status === "pending") return "pending";
  return "expired";
}

function vipLine(card: VipCard, now: Date): string {
  const sub = card.subscription;
  switch (vipLineKind(card, now)) {
    case "none":
      return "yo‘q";
    case "lifetime":
      return "faol — muddatsiz";
    case "active": {
      const display = vipDisplay(sub!, now);
      return `faol — ${formatTashkentDate(vipEnd(sub!.times))} gacha (${display.daysLeft} kun qoldi)`;
    }
    case "expired":
      return `tugagan — ${formatTashkentDate(vipEnd(sub!.times))}`;
    case "pending":
      return "yaratilgan, hali yoqilmagan";
    case "suspended":
      return "admin tomonidan to‘xtatilgan";
    case "cancelled":
      return "bekor qilingan";
  }
}

/** Akkaunti bor nomzodga VIP qo'shib bo'ladimi. */
export function canGrantNow(card: VipCard, now: Date): boolean {
  if (!card.linked) return false;
  const kind = vipLineKind(card, now);
  // To'xtatilgan obunaga kun qo'shilsa ham u yoqilmaydi — bu admin qarori.
  // Muddatsizga qo'shadigan narsa yo'q.
  return kind !== "suspended" && kind !== "lifetime";
}

export function buildVipCardText(card: VipCard, now: Date = new Date()): string {
  const lines = [`👑 <b>${escapeHtml(card.fullName)}</b>`];
  const place = [card.regionName, card.published ? "chop etilgan" : "chop etilmagan"].filter(Boolean).join(" · ");
  lines.push(`📍 ${escapeHtml(place)}`);
  if (card.articleUrl) lines.push(`🔗 ${escapeHtml(card.articleUrl)}`);
  lines.push("");

  if (!card.linked) {
    lines.push("👤 Akkaunt: <b>ochilmagan</b>");
    lines.push("💎 VIP: yo‘q");
    if (card.liveLink) {
      const vip = card.liveLink.vipDays ? `+${monthsWord(card.liveLink.vipDays)} VIP bilan` : "VIPsiz";
      lines.push(`⏳ Amaldagi havola: ${formatTashkent(card.liveLink.expiresAt)} gacha · ${vip}`);
    }
    lines.push("");
    lines.push("Faollashtirish havolasini tanlang. VIP nomzod akkauntini ochgan paytdan hisoblanadi.");
    if (card.liveLink) lines.push("Yangi havola amaldagisini bekor qiladi.");
    return lines.join("\n");
  }

  lines.push("👤 Akkaunt: <b>ochilgan</b>");
  lines.push(`💎 VIP: ${vipLine(card, now)}`);
  lines.push("");
  const kind = vipLineKind(card, now);
  if (kind === "suspended") {
    lines.push("VIP admin panelida to‘xtatilgan — uni panel orqali tiklang.");
  } else if (kind === "lifetime") {
    lines.push("VIP muddatsiz — qo‘shadigan narsa yo‘q.");
  } else if (kind === "active") {
    lines.push("Necha oy qo‘shamiz? Tugash sanasidan uzaytiriladi.");
  } else {
    lines.push("Necha oy VIP beramiz? Hoziroq yoqiladi.");
  }
  return lines.join("\n");
}

export function buildVipCardKeyboard(
  card: VipCard,
  now: Date = new Date(),
): { text: string; callback_data: string }[][] {
  const id = card.candidateId;
  if (!card.linked) {
    return [
      VIP_MONTH_OPTIONS.map((months) => ({
        text: `👑 ${months} oy VIP bilan`,
        callback_data: vipCallbackData({ kind: "link", months, candidateId: id }),
      })),
      [{ text: "🔗 VIPsiz havola", callback_data: vipCallbackData({ kind: "link", months: 0, candidateId: id }) }],
    ];
  }
  if (!canGrantNow(card, now)) return [];
  return [
    VIP_MONTH_OPTIONS.map((months) => ({
      text: `➕ ${months} oy`,
      callback_data: vipCallbackData({ kind: "grant", months, candidateId: id }),
    })),
  ];
}

/* ========================================================================= *
 * INLINE QIDIRUV NATIJASI
 * ========================================================================= */

/** Natija ostidagi qisqa qator: kim, akkaunt, VIP — tanlashdan oldin ko'rinsin. */
export function inlineDescription(card: VipCard, now: Date = new Date()): string {
  const parts: string[] = [];
  if (card.regionName) parts.push(card.regionName);
  if (!card.published) parts.push("chop etilmagan");

  if (!card.linked) {
    parts.push("akkaunt yo‘q");
    if (card.liveLink?.vipDays) parts.push(`havolada +${monthsWord(card.liveLink.vipDays)} VIP`);
    return parts.join(" · ");
  }

  parts.push("akkaunt bor");
  const sub = card.subscription;
  switch (vipLineKind(card, now)) {
    case "none":
      parts.push("VIP yo‘q");
      break;
    case "lifetime":
      parts.push("VIP muddatsiz");
      break;
    case "active":
      parts.push(`VIP ${formatTashkentDate(vipEnd(sub!.times))} gacha`);
      break;
    case "expired":
      parts.push(`VIP tugagan ${formatTashkentDate(vipEnd(sub!.times))}`);
      break;
    case "pending":
      parts.push("VIP yoqilmagan");
      break;
    case "suspended":
      parts.push("VIP to‘xtatilgan");
      break;
    case "cancelled":
      parts.push("VIP bekor qilingan");
      break;
  }
  return parts.join(" · ");
}

/** Tanlanganda chatga ketadigan matn — bot uni o'zi taniydi va kartani ochadi. */
export function inlineMessageText(card: Pick<VipCard, "candidateId" | "fullName" | "articleUrl">): string {
  return `👑 ${card.fullName}\n${card.articleUrl ?? `🆔 ${card.candidateId}`}`;
}

/* ========================================================================= *
 * JAVOBLAR
 * ========================================================================= */

export const VIP_PROMPT = [
  "👑 <b>VIP berish</b>",
  "",
  `1) «${VIP_SEARCH_BUTTON_LABEL}» tugmasini bosing va ismini yozing — natijalar har harfda yangilanadi. Lotin yoki kirill — farqi yo‘q.`,
  "2) Yoki saytdagi biografiya havolasini shu yerga yuboring.",
  "",
  "Nomzodni tanlang — VIP kartasi ochiladi.",
].join("\n");

export const VIP_LEGACY_LINK_REPLY =
  "Bu eski sayt havolasi — undan nomzodni aniqlab bo‘lmaydi. liderlar.uz/liderlar/… ko‘rinishidagi biografiya havolasini yuboring yoki ism bilan qidiring.";

export const VIP_NOT_FOUND_REPLY =
  "Bu havola bo‘yicha nomzod topilmadi. Havolani tekshiring yoki ism bilan qidiring.";

export const VIP_NOT_OWN_REPLY = "Bu nomzod sizning havolangiz orqali kelmagan — VIP faqat o‘z nomzodlaringizga.";

export const VIP_CARD_USED_REPLY =
  "Bu karta allaqachon ishlatilgan. Yana kerak bo‘lsa, nomzodni qayta qidiring.";

export function buildLinkCreatedText(input: {
  fullName: string;
  vipDays: number | null;
  expiresAt: Date;
  replacedPrevious: boolean;
}): string {
  const lines = [`✅ <b>${escapeHtml(input.fullName)}</b> — havola tayyor`];
  lines.push(
    input.vipDays
      ? `👑 VIP: ${monthsWord(input.vipDays)} (${input.vipDays} kun) — akkaunt ochilgan zahoti yoqiladi`
      : "🔗 VIPsiz havola",
  );
  lines.push(`⏳ ${formatTashkent(input.expiresAt)} gacha amal qiladi, bir martalik.`);
  if (input.replacedPrevious) lines.push("Avvalgi havola bekor qilindi.");
  lines.push("");
  lines.push("Pastdagi xabarni nomzodga yuboring 👇");
  return lines.join("\n");
}

/** Nomzodga yuboriladigan tayyor matn — muharrir uni uzatadi yoki nusxalaydi. */
export function buildCandidateInvitation(input: {
  fullName: string;
  link: string;
  vipDays: number | null;
  expiresAt: Date;
}): string {
  const lines = [
    `Assalomu alaykum, ${input.fullName}!`,
    "",
    "LIDERLAR.UZ dagi shaxsiy akkauntingizni ochish uchun havola:",
    input.link,
  ];
  if (input.vipDays) {
    lines.push("");
    lines.push(`🎁 Sizga ${monthsWord(input.vipDays)}lik VIP sovg‘a qilindi — u akkauntni ochganingiz zahoti yoqiladi.`);
  }
  lines.push("");
  lines.push(`Havola ${formatTashkent(input.expiresAt)} gacha amal qiladi va bir marta ishlaydi.`);
  return lines.join("\n");
}

export function buildGrantDoneText(input: {
  fullName: string;
  months: VipMonths;
  periodEnd: Date | null;
  notified: boolean;
}): string {
  const lines = [`✅ <b>${escapeHtml(input.fullName)}</b> — VIP +${input.months} oy (${monthsToDays(input.months)} kun)`];
  lines.push(`💎 Endi: ${input.periodEnd ? `${formatTashkentDate(input.periodEnd)} gacha` : "muddatsiz"}`);
  lines.push(input.notified ? "🔔 Nomzodga xabar yuborildi." : "Nomzod kabinetida bildirishnoma paydo bo‘ladi.");
  return lines.join("\n");
}

export function buildMemberVipNotice(months: VipMonths, periodEnd: Date | null): { title: string; body: string } {
  return {
    title: `VIP: +${months} oy`,
    body: periodEnd
      ? `Sizga ${months} oylik VIP berildi. VIP ${formatTashkentDate(periodEnd)} gacha amal qiladi.`
      : `Sizga ${months} oylik VIP berildi.`,
  };
}
