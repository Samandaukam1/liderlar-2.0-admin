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

/* ======================================================================== *
 * BATCH REJIMI — bir chaqiruvda 10–25 suhbat
 *
 * 500 ta suhbatni bitta promptga solish mumkin emas (kontekst ham,
 * sifat ham yiqiladi). Shuning uchun suhbatlar batch'larga bo'linadi va
 * har batch o'z transkripti bilan alohida yuboriladi.
 *
 * SATR MANZILI `[suhbat.xabar]` shaklida: `[2.7]` — batchdagi 2-suhbatning
 * 7-satri. Shu manzil tufayli model qaytargan har bir element aniq
 * xabarga bog'lanadi va "qaysi savolga qaysi javob" juftligi tekshiriladi.
 * ======================================================================== */

import type { IntentObservation } from "./intents.ts";
import { resolveIntent, guessIntentFromText } from "./intents.ts";
import type { PatternObservation } from "./aggregate.ts";
import type { SalesOutcome } from "./outcome.ts";

export interface BatchConversationInput {
  conversationId: string;
  messages: readonly TranscriptMessage[];
}

export interface BatchLine {
  messageId: string;
  /** REDAKSIYA QILINGAN matn — modelga ketgan va patternga yoziladigan shakl. */
  text: string;
  sentAt: string;
  direction: "incoming" | "outgoing";
}

export interface BatchConversationRef {
  conversationId: string;
  lines: Map<number, BatchLine>;
  lastMessageAt: string;
}

export interface BuiltBatchTranscript {
  text: string;
  conversations: Map<number, BatchConversationRef>;
  redactedKinds: string[];
  messageCount: number;
  lineCount: number;
}

export function buildBatchTranscript(
  items: readonly BatchConversationInput[],
): BuiltBatchTranscript {
  const blocks: string[] = [];
  const conversations = new Map<number, BatchConversationRef>();
  const kinds = new Set<string>();
  let messageCount = 0;
  let lineCount = 0;

  items.forEach((item, conversationIndex) => {
    const lines = new Map<number, BatchLine>();
    const rendered: string[] = [`### SUHBAT ${conversationIndex}`];
    let lastMessageAt = "";

    item.messages.forEach((message, messageIndex) => {
      messageCount += 1;
      if (message.sentAt > lastMessageAt) lastMessageAt = message.sentAt;

      const speaker = message.direction === "incoming" ? "MIJOZ" : "BIZ";
      const address = `${conversationIndex}.${messageIndex}`;
      const raw = message.text?.trim() ?? "";

      if (raw === "") {
        rendered.push(`[${address}] ${speaker}: (${message.messageType})`);
        return;
      }

      const { text, kinds: found } = redactPii(raw);
      for (const kind of found) kinds.add(kind);
      rendered.push(`[${address}] ${speaker}: ${text}`);
      lines.set(messageIndex, {
        messageId: message.id,
        text,
        sentAt: message.sentAt,
        direction: message.direction,
      });
      lineCount += 1;
    });

    blocks.push(rendered.join("\n"));
    conversations.set(conversationIndex, {
      conversationId: item.conversationId,
      lines,
      lastMessageAt: lastMessageAt || new Date().toISOString(),
    });
  });

  return {
    text: blocks.join("\n\n"),
    conversations,
    redactedKinds: [...kinds],
    messageCount,
    lineCount,
  };
}

export const BATCH_EXTRACTION_SYSTEM_PROMPT = `Sen Liderlar.uz sotuv bo'limining tahlilchisisan.
Senga bir nechta Telegram yozishmasi beriladi. Har biri "### SUHBAT N" bilan
boshlanadi, har satr esa [N.M] manzili bilan raqamlangan.

VAZIFANG IKKITA:

A) NIYAT (intent) — mijoz nima so'ragani. Bir xil ma'nodagi savollar
   ("narxi qancha?", "qancha turadi?", "nech pul?") BITTA kalit ostida
   birlashsin. Iloji boricha quyidagi kalitlardan foydalan:
   PRICE_QUESTION, SERVICE_BENEFIT, WHERE_PUBLISHED, ARTICLE_PRICE,
   TRUST_QUESTION, TIMELINE_QUESTION, PAYMENT_METHOD, APPLICATION_PROCESS,
   ELIGIBILITY, AGE_LIMIT, CERTIFICATE, POST_QUESTION, INSTAGRAM, TELEGRAM,
   WEBSITE, ARTICLE_DEADLINE, EDIT_REQUEST, REFUND,
   OBJECTION_TOO_EXPENSIVE, OBJECTION_TRUST, OBJECTION_LATER,
   OBJECTION_THINKING, OBJECTION_NO_MONEY, DOUBT.
   Ro'yxatdagi hech biriga to'g'ri kelmasa — O'ZING yangi kalit ber
   (KATTA_HARF_VA_PASTKI_CHIZIQ shaklida), lekin faqat matnda HAQIQATAN
   bor savol uchun.

B) BILIM (knowledge) — qayta ishlatsa bo'ladigan fakt.
   Turkumlar: ${KNOWLEDGE_CATEGORIES.join(", ")}.

QAT'IY QOIDALAR:
1. Faqat yozishmada HAQIQATAN bor narsani yoz. Fakt yoki savol to'qima.
2. "customerIndex" — MIJOZ satrining M raqami, "responseIndex" — o'sha
   savolga BIZ bergan javob satrining M raqami. Javob bo'lmasa null.
3. Manzillar shu suhbatning o'z satrlariga tegishli bo'lsin.
4. Transkriptdagi [telefon], [karta raqami], [maxfiy] kabi maskalarni
   TIKLAMA va o'rniga hech narsa o'ylab topma.
5. Uslub, ohang yoki emoji haqida BAHO BERMA — bu boshqa tizimning ishi.
6. Sotuv natijasi (to'landimi, ariza yuborildimi) haqida XULOSA CHIQARMA —
   uni tizim o'zi aniqlaydi.
7. Hech narsa topilmasa bo'sh ro'yxat qaytar. Bo'sh javob — to'g'ri javob.
8. Matn o'zbek tilida bo'lsin.

Javobni FAQAT quyidagi JSON shaklida qaytar:
{"conversations": [{
  "conversationIndex": 0,
  "intents": [{"key": "PRICE_QUESTION", "label": "Narx qancha",
               "customerIndex": 0, "responseIndex": 1, "confidence": 0.0-1.0}],
  "knowledge": [{"category": "price", "question": "..." yoki null,
                 "answer": "...", "sourceIndex": 1,
                 "confidence": 0.0-1.0, "tags": ["..."]}]
}]}`;

export function buildBatchPrompt(transcript: string): string {
  return [
    "Quyidagi yozishmalarni tahlil qil:",
    "---",
    transcript,
    "---",
    "JSON qaytar.",
  ].join("\n");
}

/**
 * Model javobining SHAKLINI tekshiradi (mazmunini emas).
 *
 * Orkestrator shu bayroqqa qarab qayta uradi: JSON kelgan-u, kutilgan
 * shaklda bo'lmasa, ikkinchi urinish ko'pincha to'g'ri javob beradi.
 * Shakli to'g'ri bo'lsa-yu bo'sh bo'lsa — bu haqiqiy natija, qayta
 * urilmaydi.
 */
export function isBatchShapeValid(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const list = (raw as { conversations?: unknown }).conversations;
  if (!Array.isArray(list)) return false;
  return list.every(
    (entry) =>
      entry != null &&
      typeof entry === "object" &&
      typeof (entry as { conversationIndex?: unknown }).conversationIndex === "number",
  );
}

export interface BatchNormalizeResult {
  intents: IntentObservation[];
  patterns: PatternObservation[];
  knowledge: KnowledgeDraft[];
  rejected: Array<{ reason: string; detail?: string }>;
}

/**
 * Model javobini haqiqiy xabarlarga bog'laydi.
 *
 * MUHIM: `customerExample` va `responseExample` MODELDAN OLINMAYDI —
 * ular transkriptdagi asl (redaksiya qilingan) satrdan olinadi. Model
 * faqat manzilni ko'rsatadi. Shu sababli response library'da model
 * qayta yozgan emas, biz haqiqatan yozgan javob turadi.
 */
export function normalizeBatchExtraction(
  raw: unknown,
  transcript: BuiltBatchTranscript,
  outcomeByConversation: ReadonlyMap<string, SalesOutcome>,
): BatchNormalizeResult {
  const intents: IntentObservation[] = [];
  const patterns: PatternObservation[] = [];
  const knowledge: KnowledgeDraft[] = [];
  const rejected: BatchNormalizeResult["rejected"] = [];
  const seenKnowledge = new Set<string>();

  if (!isBatchShapeValid(raw)) {
    return { intents, patterns, knowledge, rejected: [{ reason: "javob shakli noto‘g‘ri" }] };
  }

  for (const entry of (raw as { conversations: unknown[] }).conversations) {
    const item = entry as Record<string, unknown>;
    const conversationIndex = item.conversationIndex as number;
    const ref = transcript.conversations.get(conversationIndex);
    if (!ref) {
      rejected.push({ reason: "noma’lum suhbat indeksi", detail: String(conversationIndex) });
      continue;
    }
    const outcome = outcomeByConversation.get(ref.conversationId) ?? "unknown";

    /* --------------------------- niyatlar --------------------------- */
    const rawIntents = Array.isArray(item.intents) ? item.intents : [];
    for (const rawIntent of rawIntents) {
      if (!rawIntent || typeof rawIntent !== "object") {
        rejected.push({ reason: "intent obyekt emas" });
        continue;
      }
      const intentItem = rawIntent as Record<string, unknown>;

      const customerIndex =
        typeof intentItem.customerIndex === "number" ? intentItem.customerIndex : null;
      const customerLine = customerIndex != null ? ref.lines.get(customerIndex) : undefined;

      // Savol satri MIJOZNIKI bo'lishi shart: o'z xabarimizni "mijoz
      // savoli" deb yozib qo'yish butun statistikani buzardi.
      if (!customerLine || customerLine.direction !== "incoming") {
        rejected.push({ reason: "intent mijoz satriga bog‘lanmadi" });
        continue;
      }

      const resolved =
        resolveIntent(String(intentItem.key ?? ""), (intentItem.label as string) ?? null) ??
        guessIntentFromText(customerLine.text);
      if (!resolved) {
        rejected.push({ reason: "intent kaliti aniqlanmadi" });
        continue;
      }

      intents.push({
        key: resolved.key,
        label: resolved.label,
        kind: resolved.kind,
        known: resolved.known,
        conversationId: ref.conversationId,
        customerExample: customerLine.text.slice(0, 300),
        customerMessageId: customerLine.messageId,
      });

      /* ------------------------ response pattern ------------------------ */
      const responseIndex =
        typeof intentItem.responseIndex === "number" ? intentItem.responseIndex : null;
      const responseLine = responseIndex != null ? ref.lines.get(responseIndex) : undefined;
      if (!responseLine) continue;

      // Javob BIZNIKI bo'lishi va savoldan KEYIN kelishi shart.
      if (responseLine.direction !== "outgoing") {
        rejected.push({ reason: "javob bizning satrimiz emas" });
        continue;
      }
      if (responseIndex != null && customerIndex != null && responseIndex <= customerIndex) {
        rejected.push({ reason: "javob savoldan oldin turibdi" });
        continue;
      }

      patterns.push({
        intentKey: resolved.key,
        intentLabel: resolved.label,
        intentKind: resolved.kind,
        conversationId: ref.conversationId,
        customerExample: customerLine.text.slice(0, 300),
        responseExample: responseLine.text.slice(0, 1200),
        customerMessageId: customerLine.messageId,
        responseMessageId: responseLine.messageId,
        outcome,
        observedAt: responseLine.sentAt,
      });
    }

    /* ---------------------------- bilim ----------------------------- */
    const rawKnowledge = Array.isArray(item.knowledge) ? item.knowledge : [];
    for (const rawItem of rawKnowledge) {
      if (!rawItem || typeof rawItem !== "object") {
        rejected.push({ reason: "bilim obyekt emas" });
        continue;
      }
      const knowledgeItem = rawItem as Record<string, unknown>;

      if (!isKnowledgeCategory(knowledgeItem.category)) {
        rejected.push({ reason: "noma’lum turkum", detail: String(knowledgeItem.category) });
        continue;
      }
      const rawAnswer = typeof knowledgeItem.answer === "string" ? knowledgeItem.answer.trim() : "";
      if (rawAnswer === "") {
        rejected.push({ reason: "javob bo‘sh" });
        continue;
      }

      const sourceIndex =
        typeof knowledgeItem.sourceIndex === "number" ? knowledgeItem.sourceIndex : null;
      const sourceLine = sourceIndex != null ? ref.lines.get(sourceIndex) : undefined;
      if (!sourceLine) {
        rejected.push({ reason: "manba xabari topilmadi (sourceIndex)" });
        continue;
      }

      const answer = redactPii(rawAnswer).text.slice(0, MAX_ANSWER);
      const rawQuestion =
        typeof knowledgeItem.question === "string" ? knowledgeItem.question.trim() : "";
      const question = rawQuestion ? redactPii(rawQuestion).text.slice(0, MAX_QUESTION) : null;

      if (!isRedacted(answer) || (question != null && !isRedacted(question))) {
        rejected.push({ reason: "redaksiyadan keyin ham PII qoldi" });
        continue;
      }

      const dedupeKey = knowledgeDedupeKey(knowledgeItem.category, question, answer);
      if (seenKnowledge.has(dedupeKey)) {
        rejected.push({ reason: "shu batchda takrorlandi" });
        continue;
      }
      seenKnowledge.add(dedupeKey);

      const confidence =
        typeof knowledgeItem.confidence === "number" && Number.isFinite(knowledgeItem.confidence)
          ? Math.min(1, Math.max(0, Math.round(knowledgeItem.confidence * 100) / 100))
          : 0.5;

      knowledge.push({
        category: knowledgeItem.category,
        question,
        answer,
        confidence,
        tags: Array.isArray(knowledgeItem.tags)
          ? knowledgeItem.tags
              .filter((t): t is string => typeof t === "string")
              .map((t) => redactPii(t).text.trim().slice(0, 40))
              .filter((t) => t !== "")
              .slice(0, 8)
          : [],
        sourceConversationId: ref.conversationId,
        sourceMessageId: sourceLine.messageId,
        sourceExcerpt: answer.slice(0, 240),
        dedupeKey,
      });
    }
  }

  return { intents, patterns, knowledge, rejected };
}
