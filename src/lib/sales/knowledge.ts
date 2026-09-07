/**
 * Bilim (FAKT) ajratish — suhbatdan savol-javob, narx, e'tiroz va h.k.
 *
 * BU MODUL USLUB O'RGANMAYDI. Ohang, emoji, gap uzunligi — hammasi
 * `style.ts` da. Ajratishning sababi jadval izohida: fakt tasdiqlanadi va
 * eskiradi, uslub esa o'lchanadi va o'rtachalanadi.
 *
 * MAXFIYLIK: transkript AI'ga yuborilishidan OLDIN redaksiya qilinadi va
 * saqlashdan oldin YANA tekshiriladi. Ikki bosqich ataylab: model o'zi
 * ham matn to'qib, redaksiya qilingan raqamni "tiklab" yuborishi mumkin.
 *
 * IZLANUVCHANLIK: manba suhbatsiz bilim yozuvi yaratilmaydi. Model
 * qaytargan har bir element `sourceIndex` orqali aniq xabarga bog'lanadi.
 */

import { createHash } from "node:crypto";
import { redactPii, isRedacted } from "./redact.ts";
import {
  isKnowledgeCategory,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  type KnowledgeCategory,
} from "./types.ts";

/* ------------------------------ transkript ------------------------------ */

export interface TranscriptMessage {
  id: string;
  direction: "incoming" | "outgoing";
  text: string | null;
  messageType: string;
  sentAt: string;
}

export interface BuiltTranscript {
  /** Modelga yuboriladigan, REDAKSIYA QILINGAN matn. */
  text: string;
  /** Satr indeksidan xabar id'siga — model javobini bog'lash uchun. */
  indexToMessageId: Map<number, string>;
  /** Transkriptda topilgan PII toifalari — audit uchun. */
  redactedKinds: string[];
  /** Matnli satrlar soni. */
  lineCount: number;
}

/**
 * Xabarlardan raqamlangan transkript yasaydi.
 *
 * Matnsiz xabar (rasm, stiker) satr sifatida qoladi, chunki suhbat
 * ritmini tushunish uchun "bu yerda rasm yuborilgan" fakti muhim; lekin
 * unga bilim bog'lanmaydi.
 */
export function buildTranscript(messages: readonly TranscriptMessage[]): BuiltTranscript {
  const lines: string[] = [];
  const indexToMessageId = new Map<number, string>();
  const kinds = new Set<string>();
  let lineCount = 0;

  messages.forEach((message, i) => {
    const speaker = message.direction === "incoming" ? "MIJOZ" : "BIZ";
    const raw = message.text?.trim() ?? "";

    if (raw === "") {
      lines.push(`[${i}] ${speaker}: (${message.messageType})`);
      return;
    }

    const { text, kinds: found } = redactPii(raw);
    for (const kind of found) kinds.add(kind);
    lines.push(`[${i}] ${speaker}: ${text}`);
    indexToMessageId.set(i, message.id);
    lineCount += 1;
  });

  return {
    text: lines.join("\n"),
    indexToMessageId,
    redactedKinds: [...kinds],
    lineCount,
  };
}

/**
 * Transkriptning barqaror xesh'i. Suhbatga yangi xabar qo'shilmagan bo'lsa
 * xesh o'zgarmaydi va suhbat AI'ga ikkinchi marta yuborilmaydi.
 */
export function transcriptHash(transcript: string): string {
  return createHash("sha256").update(transcript, "utf8").digest("hex");
}

/* -------------------------------- promt --------------------------------- */

export const EXTRACTION_SYSTEM_PROMPT = `Sen Liderlar.uz sotuv bo'limining tahlilchisisan.
Senga bitta mijoz bilan bo'lgan Telegram yozishmasi beriladi. Vazifang — undan
QAYTA ISHLATSA BO'LADIGAN BILIMNI ajratib olish.

TURKUMLAR (faqat shu ro'yxatdan tanla):
${KNOWLEDGE_CATEGORIES.map((c) => `- ${c} — ${KNOWLEDGE_CATEGORY_LABELS[c]}`).join("\n")}

QAT'IY QOIDALAR:
1. Faqat yozishmada HAQIQATAN bor narsani yoz. Fakt to'qima.
2. Har bir element uchun "sourceIndex" — o'sha bilim olingan satrning
   kvadrat qavsdagi raqami. Raqamsiz element YAROQSIZ.
3. Transkriptdagi [telefon], [karta raqami], [maxfiy] kabi maskalarni
   TIKLAMA va o'rniga hech narsa o'ylab topma. Ular shundayligicha qolsin.
4. Shaxsiy ma'lumot (telefon, karta, pasport, chek rekviziti) yozma.
5. "answer" — mazmunning o'zi, qisqa va tushunarli. "question" — agar bu
   savol-javob bo'lsa, savolning o'zi; aks holda null.
6. Uslub, ohang yoki emoji haqida BAHO BERMA — bu boshqa tizimning ishi.
7. Hech narsa topilmasa bo'sh ro'yxat qaytar. Bo'sh javob — to'g'ri javob.
8. Matn o'zbek tilida bo'lsin.

Javobni FAQAT quyidagi JSON shaklida qaytar:
{"items": [{"category": "...", "question": "..." yoki null, "answer": "...",
  "sourceIndex": 0, "confidence": 0.0-1.0, "tags": ["..."]}]}`;

export function buildExtractionPrompt(transcript: string): string {
  return [
    "Quyidagi yozishmadan bilim ajrat:",
    "---",
    transcript,
    "---",
    "JSON qaytar.",
  ].join("\n");
}

/* ------------------------------ normalizatsiya --------------------------- */

export interface KnowledgeDraft {
  category: KnowledgeCategory;
  question: string | null;
  answer: string;
  confidence: number;
  tags: string[];
  sourceConversationId: string;
  sourceMessageId: string | null;
  sourceExcerpt: string | null;
  dedupeKey: string;
}

export interface NormalizeResult {
  items: KnowledgeDraft[];
  /** Nega tashlab yuborildi — job hisobotida ko'rinadi. */
  rejected: Array<{ reason: string; category?: string }>;
}

/**
 * Dedupe kaliti. Bir xil savol-javob boshqa suhbatda takrorlansa ham
 * bitta yozuv qoladi: kalit turkum + normallashtirilgan matndan.
 */
export function knowledgeDedupeKey(
  category: string,
  question: string | null,
  answer: string,
): string {
  // TARTIB MUHIM: bo'shliq oxirgi tinish belgisidan KEYIN turgan bo'lsa
  // ("narxi qancha? "), avval trim qilinmasa `$` langari tinish belgisiga
  // yetib bormaydi va bir xil mazmun ikki xil kalit oladi.
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[‘’'`´]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.,!?;:]+$/g, "")
      .trim();

  const payload = `${category}|${normalize(question ?? "")}|${normalize(answer)}`;
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 40);
}

const MAX_ANSWER = 2000;
const MAX_QUESTION = 500;

/**
 * Model javobini tekshiradi, redaksiya qiladi va manbaga bog'laydi.
 *
 * TASHLAB YUBORILADI: noma'lum turkum, bo'sh javob, manbasiz element va
 * redaksiyadan keyin ham PII qolgan matn. Oxirgisi eng muhimi — bu
 * modeldan kelgan matn uchun so'nggi to'siq.
 */
export function normalizeExtraction(
  raw: unknown,
  source: { conversationId: string; indexToMessageId: Map<number, string> },
): NormalizeResult {
  const items: KnowledgeDraft[] = [];
  const rejected: NormalizeResult["rejected"] = [];
  const seen = new Set<string>();

  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown })?.items)
      ? ((raw as { items: unknown[] }).items)
      : null;

  if (!list) return { items, rejected: [{ reason: "javobda items ro‘yxati yo‘q" }] };

  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      rejected.push({ reason: "element obyekt emas" });
      continue;
    }
    const item = entry as Record<string, unknown>;

    if (!isKnowledgeCategory(item.category)) {
      rejected.push({ reason: "noma’lum turkum", category: String(item.category) });
      continue;
    }
    const category = item.category;

    const rawAnswer = typeof item.answer === "string" ? item.answer.trim() : "";
    if (rawAnswer === "") {
      rejected.push({ reason: "javob bo‘sh", category });
      continue;
    }

    const rawQuestion = typeof item.question === "string" ? item.question.trim() : "";

    // Modeldan kelgan matn ham redaksiyadan o'tadi.
    const answer = redactPii(rawAnswer).text.slice(0, MAX_ANSWER);
    const question = rawQuestion ? redactPii(rawQuestion).text.slice(0, MAX_QUESTION) : null;

    // So'nggi to'siq: redaksiyadan keyin ham PII qolgan bo'lsa, qoidada
    // teshik bor — yozuv saqlanmaydi.
    if (!isRedacted(answer) || (question != null && !isRedacted(question))) {
      rejected.push({ reason: "redaksiyadan keyin ham PII qoldi", category });
      continue;
    }

    // IZLANUVCHANLIK: sourceIndex mavjud satrga ishora qilishi shart.
    const index = typeof item.sourceIndex === "number" ? item.sourceIndex : null;
    const sourceMessageId = index != null ? (source.indexToMessageId.get(index) ?? null) : null;
    if (sourceMessageId == null) {
      rejected.push({ reason: "manba xabari topilmadi (sourceIndex)", category });
      continue;
    }

    const confidence =
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, Math.round(item.confidence * 100) / 100))
        : 0.5;

    const tags = Array.isArray(item.tags)
      ? item.tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => redactPii(t).text.trim().slice(0, 40))
          .filter((t) => t !== "")
          .slice(0, 8)
      : [];

    const dedupeKey = knowledgeDedupeKey(category, question, answer);
    if (seen.has(dedupeKey)) {
      rejected.push({ reason: "shu yugurishda takrorlandi", category });
      continue;
    }
    seen.add(dedupeKey);

    items.push({
      category,
      question,
      answer,
      confidence,
      tags,
      sourceConversationId: source.conversationId,
      sourceMessageId,
      sourceExcerpt: answer.slice(0, 240),
      dedupeKey,
    });
  }

  return { items, rejected };
}

/** Model javobi JSON emas bo'lsa ham yiqilmaydi. */
export function parseModelJson(content: string | null | undefined): unknown {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    // Ba'zan model JSON'ni matn ichiga o'raydi — birinchi { dan oxirgi } gacha.
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
