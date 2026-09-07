/**
 * Suhbatni DIALOGGA aylantirish.
 *
 * NEGA KERAK: alohida xabarni o'rganish "narxi qancha?" savolini ko'radi,
 * lekin unga QANDAY javob berilganini ko'rmaydi. Sotuv bilimi esa aynan
 * zanjirda: SAVOL -> JAVOB -> KEYINGI SAVOL. Shu modul xabarlar oqimini
 * navbatlarga (turn) bo'lib, savol-javob juftlarini tuzadi.
 *
 * SOF MODUL: baza ham, tarmoq ham, AI ham yo'q — shuning uchun juftlash
 * mantig'i testda to'liq tekshiriladi.
 */

import { createHash } from "node:crypto";
import type { SalesDirection } from "./types.ts";

export interface DialogMessage {
  id: string;
  direction: SalesDirection;
  text: string | null;
  messageType: string;
  sentAt: string;
}

export interface DialogTurn {
  /** Navbatning suhbatdagi tartib raqami (0 dan). */
  index: number;
  speaker: "customer" | "us";
  /** Navbatga kirgan xabarlar — izlanuvchanlik shu id'lar orqali. */
  messageIds: string[];
  text: string;
  startedAt: string;
  endedAt: string;
  /** Matnsiz xabarlar (rasm, ovoz) navbatda bo'lsa. */
  mediaTypes: string[];
}

/**
 * Xabarlarni vaqt bo'yicha tartiblaydi.
 *
 * Baza `order by sent_at` bilan qaytaradi, lekin bir soniyada kelgan ikki
 * xabarning tartibi beqaror bo'lishi mumkin — shuning uchun teng vaqtda
 * `id` bo'yicha barqarorlashtiriladi. Aks holda bir xil suhbat ikki xil
 * transkript (va ikki xil xesh) berardi.
 */
export function ensureChronological(messages: readonly DialogMessage[]): DialogMessage[] {
  return [...messages].sort((a, b) => {
    const ta = new Date(a.sentAt).getTime();
    const tb = new Date(b.sentAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Ketma-ket kelgan bir tomonning xabarlarini bitta navbatga birlashtiradi.
 * Odam fikrini uch xabarga bo'lib yozsa ham, bu bitta gap.
 */
export function buildDialogTurns(messages: readonly DialogMessage[]): DialogTurn[] {
  const ordered = ensureChronological(messages);
  const turns: DialogTurn[] = [];

  for (const message of ordered) {
    const speaker = message.direction === "incoming" ? "customer" : "us";
    const text = message.text?.trim() ?? "";
    const last = turns[turns.length - 1];

    if (last && last.speaker === speaker) {
      last.messageIds.push(message.id);
      if (text) last.text = last.text ? `${last.text}\n${text}` : text;
      if (!text) last.mediaTypes.push(message.messageType);
      last.endedAt = message.sentAt;
      continue;
    }

    turns.push({
      index: turns.length,
      speaker,
      messageIds: [message.id],
      text,
      startedAt: message.sentAt,
      endedAt: message.sentAt,
      mediaTypes: text ? [] : [message.messageType],
    });
  }

  return turns;
}

/** So'roq belgisi yoki o'zbekcha so'roq so'zlari. */
const QUESTION_WORDS =
  /\b(qancha|qanday|qayer|qachon|nima|nega|kim|necha|nech|qaysi|bormi|mumkinmi|kerakmi|qanaqa)\b/i;

export function isQuestionTurn(turn: Pick<DialogTurn, "text">): boolean {
  if (turn.text.includes("?")) return true;
  return QUESTION_WORDS.test(turn.text);
}

/** Bitta navbatdagi savollar soni — "ko'p savol bersa" holatini aniqlash uchun. */
export function countQuestions(text: string): number {
  const marks = (text.match(/\?/g) ?? []).length;
  if (marks > 0) return marks;
  return QUESTION_WORDS.test(text) ? 1 : 0;
}

export interface QaPair {
  /** Mijozning savoli/gapi. */
  question: DialogTurn;
  /** Bizning javobimiz. Mijoz yozib, biz javob bermagan bo'lsak — null. */
  answer: DialogTurn | null;
  /** Javobdan keyin mijoz nima degani — natijani baholash uchun. */
  followUp: DialogTurn | null;
}

/**
 * Savol-javob juftlarini tuzadi.
 *
 * QOIDA: javob — savoldan KEYINGI bizning navbatimiz, va faqat bevosita
 * keyingisi. Uzoqdagi javobni savolga bog'lash "biz bu savolga shunday
 * javob berganmiz" degan yolg'on xulosa berardi.
 */
export function pairQuestionResponses(turns: readonly DialogTurn[]): QaPair[] {
  const pairs: QaPair[] = [];

  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn.speaker !== "customer") continue;

    const next = turns[i + 1];
    const answer = next && next.speaker === "us" ? next : null;
    const after = answer ? turns[i + 2] : null;
    const followUp = after && after.speaker === "customer" ? after : null;

    pairs.push({ question: turn, answer, followUp });
  }

  return pairs;
}

/** Javobi bor va savol bo'lgan juftlar — pattern o'rganish uchun asos. */
export function answeredQuestionPairs(turns: readonly DialogTurn[]): QaPair[] {
  return pairQuestionResponses(turns).filter(
    (pair) => pair.answer !== null && pair.question.text.trim() !== "" && isQuestionTurn(pair.question),
  );
}

/**
 * Xabarlar oralig'ining barqaror xesh'i — IDEMPOTENTLIK kaliti.
 *
 * Suhbatga yangi xabar qo'shilmagan va mavjudlari tahrirlanmagan bo'lsa
 * xesh o'zgarmaydi, ya'ni suhbat modelga ikkinchi marta yuborilmaydi va
 * takroriy javob shabloni yaratilmaydi. Xabar matni UZUNLIGI ham xeshga
 * kiradi: xabarlar soni o'zgarmasa-yu mazmun tahrirlangan bo'lsa, suhbat
 * qayta o'rganilishi kerak.
 *
 * Sof funksiya — `deep-learning.ts` dagi baza qatlamidan ATAYLAB ajratilgan,
 * shunda idempotentlik qoidasi testda to'g'ridan-to'g'ri tekshiriladi.
 */
export function conversationRangeHash(
  conversationId: string,
  messages: readonly DialogMessage[],
): string {
  const ordered = ensureChronological(messages);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const payload = [
    conversationId,
    ordered.length,
    first?.id ?? "",
    last?.id ?? "",
    last?.sentAt ?? "",
    ordered.map((m) => `${m.id}:${(m.text ?? "").length}`).join("|"),
  ].join("#");
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 48);
}
