/**
 * XOTIRANI MODEL UCHUN MATNGA AYLANTIRISH — SOF MODUL.
 *
 * Bu blok MIJOZGA KO'RINMAYDI. U modelga ikkita savolga javob
 * beradi: "nima allaqachon ma'lum" va "nimani so'rash MUMKIN EMAS".
 *
 * TARTIB ATAYLAB: eng xavfli qoidalar (to'lov, opt-a out, va'da)
 * blok BOSHIDA turadi. Uzun kontekstda model oxirini yaxshiroq
 * eslaydi degan qarash bor, lekin bu yerda ishonchliroq usul —
 * MUHIMINI QISQA QILIB, BOSHIGA QO'YISH.
 */

import {
  canAsk,
  PAYMENT_STATE_LABELS,
  type ConversationMemory,
} from "./conversation-memory.ts";
import { LEAD_TEMPERATURE_LABELS } from "../flow/lead-score.ts";
import { SALES_STAGE_LABELS, type SalesStage } from "../flow/stages.ts";
import { OBJECTION_LABELS, type ObjectionKind } from "../flow/objections.ts";

export interface MemoryBlockInput {
  memory: ConversationMemory;
  stage: SalesStage;
  /** Eski qismning siqilgan mazmuni (aylanma xulosa). */
  summary: string | null;
  /** Salomlashish bo'yicha ko'rsatma. */
  greetingInstruction: string;
}

export function buildMemoryBlock(input: MemoryBlockInput): string {
  const { memory } = input;
  const lines: string[] = ["=== SUHBAT HOLATI (mijozga ko‘rsatilmaydi) ==="];

  lines.push(input.greetingInstruction);

  /* ---------- QAYTA SO'RASH TAQIQLARI — eng muhimi ---------- */
  const forbidden: string[] = [];
  for (const ask of ["payment", "intake", "full_name", "article_interest", "photo"] as const) {
    const verdict = canAsk(memory, ask);
    if (!verdict.allowed) forbidden.push(`${askLabel(ask)} — ${verdict.reason}`);
  }
  if (forbidden.length > 0) {
    lines.push("", "QAYTA SO‘RAMA:");
    for (const item of forbidden) lines.push(`  · ${item}`);
  }

  /* ---------- tranzaksiya holati ---------- */
  lines.push("", `Bosqich: ${SALES_STAGE_LABELS[input.stage]}`);
  lines.push(`To‘lov: ${PAYMENT_STATE_LABELS[memory.paymentStatus]}`);
  lines.push(`Anketa: ${intakeLabel(memory.intakeStatus)}`);
  lines.push(`Harorat: ${LEAD_TEMPERATURE_LABELS[memory.leadTemperature]}`);

  if (memory.knownFacts.fullName) lines.push(`Mijoz ismi: ${memory.knownFacts.fullName}`);
  if (memory.customerGoal) lines.push(`Mijoz maqsadi: ${memory.customerGoal}`);

  /* ---------- javobsiz savol — birinchi javob beriladi ---------- */
  if (memory.pendingQuestions.length > 0) {
    lines.push("", "JAVOBSIZ SAVOLLAR (avval shularga javob ber):");
    for (const question of memory.pendingQuestions) lines.push(`  · ${question.text}`);
  }

  const openPromises = memory.sellerPromises.filter((promise) => !promise.fulfilled);
  if (openPromises.length > 0) {
    lines.push("", "BAJARILMAGAN VA’DALAR (yangi va’da berma, holatni ayt):");
    for (const promise of openPromises) lines.push(`  · ${promise.text}`);
  }

  if (memory.answeredTopics.length > 0) {
    lines.push("", `ALLAQACHON TUSHUNTIRILGAN (takrorlama): ${memory.answeredTopics.join(", ")}`);
  }

  const objections = memory.unresolvedObjections
    .filter((kind): kind is ObjectionKind => kind in OBJECTION_LABELS)
    .map((kind) => OBJECTION_LABELS[kind]);
  if (objections.length > 0) {
    lines.push(`Hal bo‘lmagan e’tirozlar: ${objections.join(", ")}`);
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
  }
  if (memory.lastCta) lines.push(`Oxirgi so‘ralgan qadam: ${memory.lastCta}`);

  if (memory.publicationStatus === "on_hold") {
    lines.push("NASHR MIJOZ SO‘RAGANI UCHUN TO‘XTATILGAN — chiqdi deb ayta olmaysan.");
  }
  if (memory.supportStatus === "open") {
    lines.push("OCHIQ YORDAM MUROJAATI bor — uni hal bo‘ldi deb ayta olmaysan.");
  }

  if (input.summary?.trim()) {
    lines.push("", "=== OLDINGI SUHBAT MAZMUNI ===", input.summary.trim());
  }

  return lines.join("\n");
}

function askLabel(ask: string): string {
  switch (ask) {
    case "payment": return "to‘lov so‘rash";
    case "intake": return "anketa so‘rash";
    case "full_name": return "ism so‘rash";
    case "article_interest": return "maqola xohlaysizmi deb so‘rash";
    case "photo": return "rasm so‘rash";
    default: return ask;
  }
}

function intakeLabel(state: ConversationMemory["intakeStatus"]): string {
  if (state === "submitted") return "TO‘LDIRILGAN";
  if (state === "started") return "boshlangan";
  if (state === "link_sent") return "havola yuborilgan";
  return "yuborilmagan";
}

/**
 * TASDIQLANGAN FAKT MATNLARI — raqam tekshiruvi uchun.
 *
 * Xotiradagi TRANZAKSIYA holati ham fakt manbai: mijoz
 * haqiqatan 38 000 to'lagan bo'lsa, javobda o'sha son
 * "tasdiqlanmagan" deb bloklanmasligi kerak.
 */
export function verifiedFactTextsFrom(memory: ConversationMemory): string[] {
  const texts: string[] = [];
  if (memory.customerGoal) texts.push(memory.customerGoal);
  for (const promise of memory.sellerPromises) texts.push(promise.text);
  for (const commitment of memory.customerCommitments) texts.push(commitment.text);
  return texts;
}
