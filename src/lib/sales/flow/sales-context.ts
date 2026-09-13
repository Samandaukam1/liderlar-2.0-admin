/**
 * SOTUV KONTEKSTI (4-band) — javobdan OLDIN o'ylash.
 *
 * MUAMMO: javob faqat oxirgi xabardan yasalsa, AI suhbatni
 * eslamaydi. U ismni ikki marta so'raydi, narxni qayta tushuntiradi,
 * mijoz "ha" degandan keyin ham "maqola xohlaysizmi?" deb so'raydi.
 * Mijoz uchun bu bitta narsani anglatadi: bu yerda meni tinglashmayapti.
 *
 * SHUNING UCHUN har javobdan oldin ixcham kontekst quriladi —
 * ixcham, chunki butun suhbatni har safar modelga yuborish ham
 * qimmat, ham foydasiz: model 200 xabardan kerakligini topa olmaydi.
 *
 * SOF MODUL — matn quradi, hech qayerga bormaydi.
 */

import { OBJECTION_LABELS, type ObjectionKind } from "./objections.ts";
import { LEAD_TEMPERATURE_LABELS, type LeadTemperature } from "./lead-score.ts";
import { SALES_STAGE_LABELS, type SalesStage } from "./stages.ts";
import { MINOR_GUIDANCE } from "./minor.ts";

export interface SalesContextInput {
  customer: {
    fullName: string | null;
    region: string | null;
    telegramUsername: string | null;
    isMinor: boolean;
  };
  conversation: {
    stage: SalesStage;
    /** Eski qismning siqilgan mazmuni. */
    summary: string | null;
    /** Mijozning javobsiz qolgan savoli. */
    openQuestion: string | null;
    /** AI bergan va hali bajarilmagan va'da. */
    pendingPromise: string | null;
    /** AI allaqachon tushuntirgan mavzular — takrorlamaslik uchun. */
    explained: readonly string[];
  };
  sales: {
    temperature: LeadTemperature;
    objections: readonly string[];
    lastCta: string | null;
    followupPending: boolean;
  };
  transaction: {
    intakeSubmitted: boolean;
    intakeLinkSent: boolean;
    paymentStatus: string;
    paymentEvidenceReceived: boolean;
  };
}

/**
 * Model uchun kontekst bloki.
 *
 * BU MIJOZGA KO'RINMAYDI. Model bundan "nima allaqachon aytilgan"
 * va "keyingi eng kichik foydali qadam nima" degan savollarga javob
 * oladi.
 */
export function buildSalesContextBlock(input: SalesContextInput): string {
  const lines: string[] = ["=== SUHBAT HOLATI ==="];

  const name = input.customer.fullName?.trim();
  lines.push(`Mijoz: ${name || "ismi hali noma’lum"}`);
  if (input.customer.region?.trim()) lines.push(`Hudud: ${input.customer.region.trim()}`);
  lines.push(`Bosqich: ${SALES_STAGE_LABELS[input.conversation.stage]}`);
  lines.push(`Harorat: ${LEAD_TEMPERATURE_LABELS[input.sales.temperature]}`);

  const objections = input.sales.objections
    .filter((kind): kind is ObjectionKind => kind in OBJECTION_LABELS)
    .map((kind) => OBJECTION_LABELS[kind]);
  if (objections.length > 0) {
    lines.push(`Mijozning e’tirozlari: ${objections.join(", ")}`);
  }

  /* Tranzaksiya holati — ENG MUHIM qism.
   * Anketa to'ldirgan odamdan anketa so'rash, to'lagan odamdan
   * to'lov so'rash — ishonchni bir zumda yo'qotadi. */
  lines.push(
    `Anketa: ${
      input.transaction.intakeSubmitted
        ? "TO‘LDIRILGAN — qayta so‘rama"
        : input.transaction.intakeLinkSent
          ? "havola yuborilgan, hali to‘ldirilmagan"
          : "havola yuborilmagan"
    }`,
  );
  lines.push(`To‘lov: ${paymentLine(input.transaction)}`);

  if (input.conversation.explained.length > 0) {
    lines.push(
      `ALLAQACHON TUSHUNTIRILGAN (qayta tushuntirma): ${input.conversation.explained.join(", ")}`,
    );
  }
  if (input.sales.lastCta?.trim()) {
    lines.push(`Oxirgi so‘ralgan qadam: ${input.sales.lastCta.trim()}`);
  }
  if (input.conversation.pendingPromise?.trim()) {
    lines.push(`BERILGAN VA’DA (bajarilishi kerak): ${input.conversation.pendingPromise.trim()}`);
  }
  if (input.conversation.openQuestion?.trim()) {
    lines.push(
      `MIJOZNING JAVOBSIZ SAVOLI (avval shunga javob ber): ${input.conversation.openQuestion.trim()}`,
    );
  }
  if (input.conversation.summary?.trim()) {
    lines.push("", "=== OLDINGI SUHBAT MAZMUNI ===", input.conversation.summary.trim());
  }
  if (input.customer.isMinor) {
    lines.push("", MINOR_GUIDANCE);
  }

  return lines.join("\n");
}

function paymentLine(transaction: SalesContextInput["transaction"]): string {
  if (transaction.paymentStatus === "paid") return "TASDIQLANGAN — to‘lov so‘rama, tabriklab qo‘y";
  if (transaction.paymentEvidenceReceived || transaction.paymentStatus === "evidence_received") {
    return "chek kelgan, TEKSHIRUVDA — to‘landi deb ayta olmaysan";
  }
  if (transaction.paymentStatus === "requested") return "so‘ralgan, hali kelmagan";
  return "hali so‘ralmagan";
}

/* ------------------------ rolling summary ------------------------------- */

/**
 * Uzun suhbatni qachon siqish kerak.
 *
 * Butun tarixni har safar yuborish ikki xil zarar beradi: token
 * sarfi chiziqli o'sadi va model kerakli qismni ko'rmay qoladi.
 * Oxirgi N xabar to'liq, undan oldingisi siqilgan holda boradi.
 */
export const RECENT_WINDOW = 12;
export const SUMMARIZE_AFTER = 20;

export function needsSummary(input: {
  totalMessages: number;
  summarizedMessageCount: number;
}): boolean {
  if (input.totalMessages < SUMMARIZE_AFTER) return false;
  // Oxirgi siqishdan keyin yana bir oyna to'lgan bo'lsa qayta siqiladi.
  return input.totalMessages - input.summarizedMessageCount >= RECENT_WINDOW;
}
