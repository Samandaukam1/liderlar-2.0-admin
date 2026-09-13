/**
 * AYLANMA XULOSA — SOF MODUL.
 *
 * MUAMMO: 100 xabarli suhbatni har javobda to'liq modelga
 * yuborish ikki xil zarar beradi — token sarfi va modelning
 * uzun matnda kerakli qismni yo'qotishi.
 *
 * YECHIM: oxirgi N xabar TO'LIQ boradi, undan oldingisi
 * XULOSA bo'lib boradi.
 *
 * ENG MUHIM QOIDA: XULOSA FAKT TO'QIMAYDI.
 *
 * Shuning uchun bu yerda MODEL ISHLATILMAYDI. Xulosa
 * TUZILMALI XOTIRADAN va kuzatilgan belgilardan yig'iladi.
 * Model chaqirilsa, u "mijoz qiziqqan ko'rinadi" kabi
 * tekshirilmagan gaplarni qo'shib yuborardi va ular keyingi
 * javoblarda FAKT bo'lib ishlatilardi.
 *
 * Nima bo'lishidan qat'i nazar YO'QOLMAYDIGANLAR (25-band):
 * to'lov holati, opt-out, shikoyat, so'ralgan qayta aloqa
 * vaqti, javobsiz savol, va'da, nashr to'xtatilishi,
 * insonga o'tkazish va oxirgi CTA.
 */

import {
  PAYMENT_STATE_LABELS,
  type ConversationMemory,
} from "./conversation-memory.ts";

/** Oxirgi shuncha xabar to'liq ko'rinadi. */
export const RECENT_WINDOW = 12;
/** Suhbat shundan uzun bo'lsa xulosa kerak. */
export const SUMMARIZE_AFTER = 20;

export function needsSummary(input: {
  totalMessages: number;
  summarizedMessageCount: number;
}): boolean {
  if (input.totalMessages < SUMMARIZE_AFTER) return false;
  return input.totalMessages - input.summarizedMessageCount >= RECENT_WINDOW;
}

export interface SummaryInput {
  memory: ConversationMemory;
  /** Xulosa qamragan xabarlar soni. */
  summarizedMessageCount: number;
  totalMessages: number;
}

/**
 * XAVFSIZLIK: xulosaga TUSHISHI SHART bo'lgan holatlar.
 *
 * Test shu ro'yxat bo'yicha tekshiradi — bittasi tushib qolsa
 * test yiqiladi. Sabab: bu holatlarning yo'qolishi mijozga
 * to'g'ridan-to'g'ri zarar yetkazadi (to'lagan odamdan pul
 * so'rash, opt-out qilgan odamga yozish).
 */
export const CRITICAL_KEYS = [
  "payment",
  "optOut",
  "humanTakeover",
  "pendingQuestions",
  "sellerPromises",
  "followupPreference",
  "publicationStatus",
  "supportStatus",
  "lastCta",
] as const;

export interface BuiltSummary {
  text: string;
  /** Xulosada qaysi kritik holatlar bor — tekshiruv uchun. */
  includedKeys: string[];
  summarizedMessageCount: number;
}

/**
 * Xulosani QURADI.
 *
 * Har satr xotiradagi ANIQ qiymatga tayanadi. Bo'sh qiymat
 * satr yaratmaydi — "noma'lum" deb yozish ham taxmin bo'lardi.
 */
export function buildRollingSummary(input: SummaryInput): BuiltSummary {
  const { memory } = input;
  const lines: string[] = [];
  const included: string[] = [];

  if (memory.customerGoal) {
    lines.push(`Mijoz maqsadi (o‘z so‘zi): ${memory.customerGoal}`);
  }

  if (memory.knownFacts.fullName) {
    lines.push(`Ism ma’lum: ${memory.knownFacts.fullName} — qayta so‘ralmaydi.`);
  }

  // --- TO'LOV: har doim yoziladi, hatto "so'ralmagan" bo'lsa ham ---
  lines.push(`To‘lov holati: ${PAYMENT_STATE_LABELS[memory.paymentStatus]}.`);
  included.push("payment");
  if (memory.paymentStatus === "confirmed") {
    lines.push("TO‘LOV TASDIQLANGAN — qayta to‘lov so‘ralmaydi.");
  }

  if (memory.intakeStatus !== "none") {
    lines.push(`Anketa: ${intakeLabel(memory.intakeStatus)}.`);
  }

  if (memory.optOut) {
    lines.push("MIJOZ YOZISHNI TO‘XTATISHNI SO‘RAGAN — avtomatik xabar yuborilmaydi.");
    included.push("optOut");
  }

  if (memory.humanTakeover) {
    lines.push("SUHBATNI INSON OLGAN — AI javob bermaydi.");
    included.push("humanTakeover");
  }

  if (memory.pendingQuestions.length > 0) {
    lines.push(
      `Javobsiz savollar: ${memory.pendingQuestions.map((q) => q.text).join(" | ")}`,
    );
    included.push("pendingQuestions");
  }

  const openPromises = memory.sellerPromises.filter((promise) => !promise.fulfilled);
  if (openPromises.length > 0) {
    lines.push(
      `BAJARILMAGAN VA’DALAR: ${openPromises.map((promise) => promise.text).join(" | ")}`,
    );
    included.push("sellerPromises");
  }

  if (memory.customerCommitments.length > 0) {
    lines.push(
      `Mijoz aytgan: ${memory.customerCommitments
        .map((c) => (c.timeHint ? `${c.text} (${c.timeHint})` : c.text))
        .join(" | ")}`,
    );
  }

  if (memory.followupPreference) {
    lines.push(`Mijoz so‘ragan aloqa vaqti: ${memory.followupPreference}`);
    included.push("followupPreference");
  }

  if (memory.unresolvedObjections.length > 0) {
    lines.push(`Hal bo‘lmagan e’tirozlar: ${memory.unresolvedObjections.join(", ")}`);
  }

  if (memory.answeredTopics.length > 0) {
    lines.push(
      `Allaqachon tushuntirilgan (qayta tushuntirilmaydi): ${memory.answeredTopics.join(", ")}`,
    );
  }

  if (memory.publicationStatus !== "none") {
    lines.push(`Nashr: ${publicationLabel(memory.publicationStatus)}.`);
    included.push("publicationStatus");
  }
  if (memory.photoStatus !== "none") {
    lines.push(`Rasm: ${photoLabel(memory.photoStatus)}.`);
  }
  if (memory.certificateStatus !== "none") {
    lines.push(`Sertifikat: ${memory.certificateStatus === "issued" ? "berilgan" : "va’da qilingan"}.`);
  }
  if (memory.supportStatus !== "none") {
    lines.push(`Yordam murojaati: ${memory.supportStatus === "open" ? "OCHIQ" : "yopilgan"}.`);
    included.push("supportStatus");
  }

  if (memory.lastCta) {
    lines.push(`Oxirgi so‘ralgan qadam: ${memory.lastCta}`);
    included.push("lastCta");
  }

  return {
    text: lines.join("\n"),
    includedKeys: included,
    // Faqat OYNADAN TASHQARIDAGI xabarlar xulosaga kiradi.
    summarizedMessageCount: Math.max(0, input.totalMessages - RECENT_WINDOW),
  };
}

function intakeLabel(state: ConversationMemory["intakeStatus"]): string {
  if (state === "submitted") return "TO‘LDIRILGAN — qayta so‘ralmaydi";
  if (state === "started") return "boshlangan, tugallanmagan";
  if (state === "link_sent") return "havola yuborilgan";
  return "yuborilmagan";
}

function publicationLabel(state: ConversationMemory["publicationStatus"]): string {
  if (state === "published") return "chiqqan";
  if (state === "on_hold") return "MIJOZ SO‘RAGANI UCHUN TO‘XTATILGAN";
  if (state === "queued") return "navbatda";
  return "yo‘q";
}

function photoLabel(state: ConversationMemory["photoStatus"]): string {
  if (state === "approved") return "tasdiqlangan";
  if (state === "rework") return "qayta ishlanmoqda";
  if (state === "received") return "kelgan";
  if (state === "requested") return "so‘ralgan";
  return "yo‘q";
}

/**
 * Xulosa kritik holatni YO'QOTMAGANINI tekshiradi.
 *
 * Chaqiruvchi uchun emas, TEST uchun: xulosa qurish qoidasi
 * kelajakda o'zgarsa va biror holat tushib qolsa, shu funksiya
 * buni darhol ko'rsatadi.
 */
export function missingCriticalKeys(
  memory: ConversationMemory,
  summary: BuiltSummary,
): string[] {
  const required: string[] = ["payment"];
  if (memory.optOut) required.push("optOut");
  if (memory.humanTakeover) required.push("humanTakeover");
  if (memory.pendingQuestions.length > 0) required.push("pendingQuestions");
  if (memory.sellerPromises.some((promise) => !promise.fulfilled)) required.push("sellerPromises");
  if (memory.followupPreference) required.push("followupPreference");
  if (memory.publicationStatus !== "none") required.push("publicationStatus");
  if (memory.supportStatus !== "none") required.push("supportStatus");
  if (memory.lastCta) required.push("lastCta");

  return required.filter((key) => !summary.includedKeys.includes(key));
}
