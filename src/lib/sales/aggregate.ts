/**
 * Batch natijalarini birlashtirish.
 *
 * 500 ta suhbat bitta promptga sig'maydi, shuning uchun ular 10–25 talik
 * batch'larda o'rganiladi. Har batch o'z kuzatuvlarini qaytaradi, bu modul
 * esa ularni bitta manzaraga yig'adi: qaysi savol necha marta bergan,
 * unga qanday javob berilgan va qaysi javob qanday natija bilan tugagan.
 *
 * SOF MODUL — barcha yig'ish qoidalari testda tekshiriladi.
 */

import { createHash } from "node:crypto";
import {
  aggregateIntents,
  intentShare,
  type IntentAggregate,
  type IntentKind,
  type IntentObservation,
} from "./intents.ts";
import { isSuccessfulOutcome, type SalesOutcome } from "./outcome.ts";
import { DEFAULT_RECENCY_BUCKETS, weightForDate, type RecencyBucket } from "./recency.ts";
import { addUsage, EMPTY_USAGE, type TokenUsage } from "./cost.ts";
import type { StyleSample } from "./style.ts";
import type { KnowledgeDraft } from "./knowledge.ts";

/* ------------------------------- rejalash -------------------------------- */

/**
 * Suhbatlarni batch'larga bo'ladi.
 *
 * KAFOLAT: har suhbat AYNAN BITTA batchga tushadi va birortasi ham
 * tushib qolmaydi. Batch rejasi bazaga yoziladi va uzilgan yugurish
 * aynan shundan davom etadi, shuning uchun bu qoida testda tekshiriladi.
 */
export function chunkIntoBatches<T>(items: readonly T[], batchSize: number): T[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/* ------------------------------ kuzatuvlar ------------------------------ */

export interface PatternObservation {
  intentKey: string;
  intentLabel: string;
  intentKind: IntentKind;
  conversationId: string;
  /** Mijoz aynan qanday so'ragan (redaksiya qilingan). */
  customerExample: string;
  /** Biz aynan qanday javob berganmiz (redaksiya qilingan). */
  responseExample: string;
  customerMessageId: string | null;
  responseMessageId: string | null;
  /** Shu suhbat qanday tugagan — javobning "natijasi". */
  outcome: SalesOutcome;
  observedAt: string;
}

export interface BatchResult {
  batchIndex: number;
  conversationIds: string[];
  messagesProcessed: number;
  intents: IntentObservation[];
  patterns: PatternObservation[];
  knowledge: KnowledgeDraft[];
  styleSamples: StyleSample[];
  outcomes: Array<{ conversationId: string; outcome: SalesOutcome }>;
  usage: TokenUsage;
}

/* ------------------------------- patternlar ------------------------------ */

export interface PatternAggregate {
  dedupeKey: string;
  intentKey: string;
  intentLabel: string;
  intentKind: IntentKind;
  customerExample: string;
  responseExample: string;
  /** Shu javob necha marta ishlatilgan. */
  frequency: number;
  /** Muvaffaqiyatli natija bilan tugagan suhbatlar soni. */
  successCount: number;
  /** Natijasi noma'lum suhbatlar soni. */
  unknownCount: number;
  /**
   * successCount / (frequency - unknownCount).
   * BARCHA natija noma'lum bo'lsa `null` — "0%" deb ko'rsatish
   * "yomon javob" degan yolg'on xulosa berardi.
   */
  successRate: number | null;
  lastSeenAt: string;
  recencyWeight: number;
  conversationIds: string[];
  sourceMessageIds: string[];
}

/** Bir xil javobning kichik farqlari bitta variantga yig'iladi. */
function normalizeResponse(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’'`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,!?;:]+$/g, "")
    .trim()
    .slice(0, 500);
}

export function patternDedupeKey(intentKey: string, responseExample: string): string {
  return createHash("sha256")
    .update(`${intentKey}|${normalizeResponse(responseExample)}`, "utf8")
    .digest("hex")
    .slice(0, 40);
}

export function aggregatePatterns(
  observations: readonly PatternObservation[],
  options: { now?: string | Date; buckets?: readonly RecencyBucket[] } = {},
): PatternAggregate[] {
  const now = options.now ?? new Date();
  const buckets = options.buckets ?? DEFAULT_RECENCY_BUCKETS;
  const map = new Map<string, PatternAggregate>();

  for (const observation of observations) {
    const response = observation.responseExample.trim();
    if (!response) continue;

    const dedupeKey = patternDedupeKey(observation.intentKey, response);
    let entry = map.get(dedupeKey);

    if (!entry) {
      entry = {
        dedupeKey,
        intentKey: observation.intentKey,
        intentLabel: observation.intentLabel,
        intentKind: observation.intentKind,
        customerExample: observation.customerExample.trim(),
        responseExample: response,
        frequency: 0,
        successCount: 0,
        unknownCount: 0,
        successRate: null,
        lastSeenAt: observation.observedAt,
        recencyWeight: 0,
        conversationIds: [],
        sourceMessageIds: [],
      };
      map.set(dedupeKey, entry);
    }

    entry.frequency += 1;
    if (observation.outcome === "unknown") entry.unknownCount += 1;
    else if (isSuccessfulOutcome(observation.outcome)) entry.successCount += 1;

    if (!entry.conversationIds.includes(observation.conversationId)) {
      entry.conversationIds.push(observation.conversationId);
    }
    for (const id of [observation.customerMessageId, observation.responseMessageId]) {
      if (id && !entry.sourceMessageIds.includes(id)) entry.sourceMessageIds.push(id);
    }
    if (observation.observedAt > entry.lastSeenAt) entry.lastSeenAt = observation.observedAt;
  }

  for (const entry of map.values()) {
    const known = entry.frequency - entry.unknownCount;
    entry.successRate = known > 0 ? Math.round((entry.successCount / known) * 1000) / 10 : null;
    entry.recencyWeight = weightForDate(entry.lastSeenAt, now, buckets);
  }

  return [...map.values()].sort((a, b) => b.frequency - a.frequency);
}

/**
/** Saralash uchun yetarli minimum — DB qatori ham, agregat ham mos keladi. */
export interface RankableByOutcome {
  successRate: number | null;
  successCount: number;
  frequency: number;
}

/**
 * Niyat bo'yicha eng yaxshi javob.
 *
 * Faqat chastota bo'yicha saralash "eng ko'p ishlatilgan" javobni beradi,
 * "eng yaxshi ishlagan"ini emas — talab ikkalasini ham so'raydi. Shuning
 * uchun natijasi ma'lum variantlar success rate bo'yicha, natijasi
 * butunlay noma'lumlar esa ULARDAN KEYIN turadi: noma'lum hech qachon
 * "eng yaxshi" bo'lib ko'rinmasligi kerak.
 *
 * Generik — chunki bu qoida ikki joyda kerak: yig'ish bosqichida va
 * admin sahifasida. Ikki nusxa bo'lsa, ular vaqt o'tib ajralib ketardi.
 */
export function rankPatternsByOutcome<T extends RankableByOutcome>(
  patterns: readonly T[],
): T[] {
  return [...patterns].sort((a, b) => {
    const aKnown = a.successRate != null;
    const bKnown = b.successRate != null;
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (aKnown && bKnown && a.successRate !== b.successRate) {
      return (b.successRate ?? 0) - (a.successRate ?? 0);
    }
    if (a.successCount !== b.successCount) return b.successCount - a.successCount;
    return b.frequency - a.frequency;
  });
}

export function groupPatternsByIntent(
  patterns: readonly PatternAggregate[],
): Map<string, PatternAggregate[]> {
  const grouped = new Map<string, PatternAggregate[]>();
  for (const pattern of patterns) {
    const list = grouped.get(pattern.intentKey);
    if (list) list.push(pattern);
    else grouped.set(pattern.intentKey, [pattern]);
  }
  for (const [key, list] of grouped) grouped.set(key, rankPatternsByOutcome(list));
  return grouped;
}

/* ------------------------------- yig‘indi -------------------------------- */

export interface IntentWithShare extends IntentAggregate {
  /** Barcha kuzatilgan savollar ichidagi ulush, foizda. */
  share: number;
}

export interface RunAggregate {
  conversationsProcessed: number;
  messagesProcessed: number;
  intents: IntentWithShare[];
  objections: IntentWithShare[];
  patterns: PatternAggregate[];
  knowledge: KnowledgeDraft[];
  styleSamples: StyleSample[];
  outcomes: Map<string, SalesOutcome>;
  usage: TokenUsage;
  /** Har xil suhbatlar soni — bitta suhbat ikki batchga tushib qolmasin. */
  uniqueConversationIds: string[];
}

export function aggregateBatches(
  batches: readonly BatchResult[],
  options: { now?: string | Date; buckets?: readonly RecencyBucket[] } = {},
): RunAggregate {
  const intentObservations: IntentObservation[] = [];
  const patternObservations: PatternObservation[] = [];
  const knowledge: KnowledgeDraft[] = [];
  const styleSamples: StyleSample[] = [];
  const outcomes = new Map<string, SalesOutcome>();
  const uniqueConversationIds: string[] = [];
  let messagesProcessed = 0;
  let usage = EMPTY_USAGE;

  for (const batch of batches) {
    intentObservations.push(...batch.intents);
    patternObservations.push(...batch.patterns);
    knowledge.push(...batch.knowledge);
    styleSamples.push(...batch.styleSamples);
    messagesProcessed += batch.messagesProcessed;
    usage = addUsage(usage, batch.usage);

    for (const outcome of batch.outcomes) outcomes.set(outcome.conversationId, outcome.outcome);
    for (const id of batch.conversationIds) {
      if (!uniqueConversationIds.includes(id)) uniqueConversationIds.push(id);
    }
  }

  const allIntents = aggregateIntents(intentObservations);
  const totalOccurrences = allIntents.reduce((sum, intent) => sum + intent.occurrences, 0);
  const withShare: IntentWithShare[] = allIntents.map((intent) => ({
    ...intent,
    share: intentShare(intent.occurrences, totalOccurrences),
  }));

  return {
    conversationsProcessed: uniqueConversationIds.length,
    messagesProcessed,
    intents: withShare.filter((i) => i.kind === "question"),
    objections: withShare.filter((i) => i.kind === "objection"),
    patterns: aggregatePatterns(patternObservations, options),
    knowledge,
    styleSamples,
    outcomes,
    usage,
    uniqueConversationIds,
  };
}
