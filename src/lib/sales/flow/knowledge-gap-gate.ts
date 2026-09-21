/**
 * "JAVOBSIZ SAVOLLAR" DARVOZASI (6- va 7-band).
 *
 * ILDIZ SABAB (audit): darvoza umuman yo'q edi. `recordKnowledgeGap`
 * modelning `missingKnowledge` diagnostikasiga qarab ishlardi va
 * xabar UMUMAN savol bo'lganmi — hech kim so'ramasdi. Shuning
 * uchun "Hop", "Rahmat", ".", odam ismlari bilim bo'shlig'i
 * bo'lib yozilib ketdi.
 *
 * IKKI XIL "BILMAYMAN" AJRATILADI (7-band):
 *
 *   BILIM BO'SHLIG'I — javob HAMMAGA bir xil. Masalan
 *   "Sertifikat xalqaro bazada tekshiriladimi?". Bu qayta
 *   ishlatiladigan bilim va u ro'yxatga tushadi.
 *
 *   SHAXSIY HOLAT — javob AYNAN SHU mijozga bog'liq. Masalan
 *   "Maqolam tayyor bo'ldimi?". Buni bilim bazasiga yozish
 *   XAVFLI: keyingi mijoz "Ha, tayyor" degan javobni oladi.
 *   Bunday savol odamga topshiriq bo'lib boradi.
 *
 * SOF MODUL — qaror bazaga tegmasdan chiqadi va testda
 * to'liq qoplanadi.
 */

import type { IntentResult, MessageIntent } from "./message-intent.ts";

export const GAP_DECISIONS = ["knowledge_gap", "case_escalation", "none"] as const;
export type GapDecision = (typeof GAP_DECISIONS)[number];

export interface GapGateInput {
  intent: IntentResult;
  /** Model tasdiqlangan bilim topa olmadimi. */
  modelFoundNoKnowledge: boolean;
  /** Xom xabar matni. */
  text: string | null | undefined;
  /**
   * Javob suhbatning o'zida allaqachon berilganmi.
   *
   * Berilgan bo'lsa bu bo'shliq emas — bot o'qimagan, xolos.
   */
  answeredInConversation: boolean;
}

export interface GapGateResult {
  decision: GapDecision;
  /** Nega shunday qaror qilindi — panelda ko'rsatiladi. */
  reason: string;
}

/**
 * Bilim bo'shlig'i bo'la OLMAYDIGAN niyatlar.
 *
 * Ro'yxat "taqiqlangan" tomondan yozilgan: yangi niyat
 * qo'shilganda u avtomatik ravishda bo'shliq bo'lib
 * ketmasligi uchun quyida OQ ro'yxat ham bor.
 */
const NEVER_A_GAP: readonly MessageIntent[] = [
  "greeting",
  "thanks",
  "acknowledgement",
  "confirmation",
  "decline",
  "affirmation",
  "negation",
  "identity_data",
  "form_data",
  "attachment_reference",
  "payment_receipt_reference",
  "action_confirmation",
  "continuation",
  "clarification",
  "complaint",
  "human_request",
  "spam_or_noise",
  "ambiguous",
  "off_topic",
];

/**
 * Bilim bo'shlig'i BO'LISHI MUMKIN bo'lgan yagona niyatlar.
 *
 * OQ RO'YXAT ataylab: qora ro'yxat bo'lsa, yangi niyat
 * qo'shilgan zahoti u jimgina bo'shliqqa aylanardi.
 */
const MAY_BE_A_GAP: readonly MessageIntent[] = [
  "knowledge_question",
  "process_question",
  "price_question",
  "follow_up_question",
];

/** Shaxsiy holat savollari — bilim emas, topshiriq. */
const CASE_SPECIFIC: readonly MessageIntent[] = ["status_question"];

/** Juda qisqa matn qayta ishlatiladigan savol bo'la olmaydi. */
const MIN_QUESTION_LENGTH = 6;

export function decideKnowledgeGap(input: GapGateInput): GapGateResult {
  const text = (input.text ?? "").trim();
  const intent = input.intent.intent;

  /* 6-band, 7-shart: oddiy muloqot hech qachon bo'shliq emas. */
  if (NEVER_A_GAP.includes(intent)) {
    return { decision: "none", reason: `muloqot xabari (${intent})` };
  }

  /* 7-band: shaxsiy holat — odamga topshiriq, bilimga emas. */
  if (CASE_SPECIFIC.includes(intent)) {
    if (!input.modelFoundNoKnowledge && !input.intent.needsSystemState) {
      return { decision: "none", reason: "holat javobi topildi" };
    }
    return {
      decision: "case_escalation",
      reason: "mijozning o‘z holati — umumiy bilim javob bermaydi",
    };
  }

  if (!MAY_BE_A_GAP.includes(intent)) {
    return { decision: "none", reason: `bo‘shliq bo‘la olmaydigan niyat (${intent})` };
  }

  /* 6-band, 3-shart: javob suhbatda allaqachon bor. */
  if (input.answeredInConversation) {
    return { decision: "none", reason: "javob suhbatda allaqachon berilgan" };
  }

  /* 6-band, 4-shart: model tasdiqlangan bilim topdi. */
  if (!input.modelFoundNoKnowledge) {
    return { decision: "none", reason: "bilim bazasidan javob topildi" };
  }

  /* 6-band, 11-shart: shovqin darajasidagi qisqa matn. */
  if (text.length < MIN_QUESTION_LENGTH) {
    return { decision: "none", reason: "matn juda qisqa — qayta ishlatib bo‘lmaydi" };
  }

  /*
   * ISHONCH PAST BO'LSA YOZILMAYDI.
   *
   * "Noaniq" xabarni bo'shliq deb yozish ro'yxatni yana
   * ifloslantirardi — faqat past sifatli yozuvlar bilan.
   */
  if (input.intent.confidence === "low") {
    return { decision: "none", reason: "niyat ishonchi past" };
  }

  return { decision: "knowledge_gap", reason: "javobi topilmagan haqiqiy savol" };
}

/**
 * Bo'shliq TURI — panel uchun.
 *
 * `case` yozuvida "Bilim bazasiga qo'shish" tugmasi
 * KO'RSATILMAYDI (8-band).
 */
export const GAP_KINDS = ["global", "case"] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export function gapKindFor(decision: GapDecision): GapKind | null {
  if (decision === "knowledge_gap") return "global";
  if (decision === "case_escalation") return "case";
  return null;
}
