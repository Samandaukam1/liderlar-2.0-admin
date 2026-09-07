import "server-only";
import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getSalesSettings } from "./settings.ts";
import { redactPii } from "./redact.ts";
import {
  buildDialogTurns,
  conversationRangeHash,
  countQuestions,
  pairQuestionResponses,
  type DialogMessage,
} from "./dialog.ts";
import { detectOutcome, type SalesOutcome } from "./outcome.ts";
import {
  BATCH_EXTRACTION_SYSTEM_PROMPT,
  buildBatchPrompt,
  buildBatchTranscript,
  isBatchShapeValid,
  normalizeBatchExtraction,
  parseModelJson,
  type BatchConversationInput,
  type KnowledgeDraft,
  type TranscriptMessage,
} from "./knowledge.ts";
import type { IntentObservation } from "./intents.ts";
import {
  aggregateBatches,
  chunkIntoBatches,
  type BatchResult,
  type PatternObservation,
  type RunAggregate,
} from "./aggregate.ts";
import { analyzeStyle, type StyleSample } from "./style.ts";
import { addUsage, EMPTY_USAGE, estimateCostUsd, type TokenUsage } from "./cost.ts";
import { computeRunProgress, type LearningStage, type RunProgress } from "./progress-tracker.ts";

/**
 * CHUQUR O'RGANISH — oxirgi N ta suhbatning BARCHA xabarlarini tahlil qilish.
 *
 * 0.1 dan farqi uchta:
 *   · bitta xabar emas, SAVOL -> JAVOB -> KEYINGI SAVOL zanjiri;
 *   · bir xil ma'nodagi savollar bitta niyatga klasterlanadi;
 *   · har javobning NATIJASI (ariza/to'lov/yakun) qayd etiladi.
 *
 * ISHLASH SHAKLI: yugurish batch'larga bo'linadi va har chaqiruvda
 * vaqt byudjeti tugaguncha ishlanadi. Sabab — 500 ta suhbat bitta
 * serverless chaqiruviga sig'maydi. Har batch tugaganda checkpoint
 * yoziladi, shuning uchun uzilgan yugurish YO'QOLMAYDI: keyingi chaqiruv
 * `pending` batch'dan davom etadi.
 *
 * 0.1 KABI: bu yerda ham mijozga hech narsa yuborilmaydi. Modul Telegram
 * transportini import qilmaydi.
 */

const DEFAULT_MODEL = "gpt-4o-mini";
/** Bitta chaqiruvda qancha ishlash mumkin (serverless limitidan pastroq). */
const DEFAULT_TIME_BUDGET_MS = 45_000;
/** Model javobi shakli buzilsa nechta qayta urinish. */
const MAX_MODEL_ATTEMPTS = 2;

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY sozlanmagan — chuqur o‘rganish ishlamaydi.");
  }
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

/* ------------------------------ tanlash ------------------------------- */

interface SelectedConversation {
  id: string;
  messageCount: number;
  lastMessageAt: string | null;
  deepLearnedHash: string | null;
  deepLearnedMessageCount: number;
}

/**
 * Eng so'nggi yozishilgan N ta UNIKAL suhbat.
 *
 * `last_message_at desc` — talab shuni aytadi. Baza qatorining o'zi
 * unikal (bitta chat = bitta qator), shuning uchun qo'shimcha
 * deduplikatsiya kerak emas.
 */
async function selectLatestConversations(limit: number): Promise<SelectedConversation[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_conversations")
    .select("id, message_count, last_message_at, deep_learned_hash, deep_learned_message_count")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    messageCount: (row.message_count as number) ?? 0,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    deepLearnedHash: (row.deep_learned_hash as string | null) ?? null,
    deepLearnedMessageCount: (row.deep_learned_message_count as number) ?? 0,
  }));
}

/* ------------------------------- job ochish ----------------------------- */

export interface DeepLearningStart {
  jobId: string;
  targetConversations: number;
  totalMessages: number;
  batchCount: number;
}

export async function startDeepLearning(options: {
  actorId: string | null;
  target?: number;
  batchSize?: number;
  resumeFromJobId?: string | null;
}): Promise<DeepLearningStart> {
  const admin = createSupabaseAdminClient();
  const settings = await getSalesSettings();
  const target = Math.max(1, Math.min(2000, options.target ?? settings.deepLearning.targetConversations));
  const batchSize = Math.max(1, Math.min(25, options.batchSize ?? settings.deepLearning.batchSize));
  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;

  const selected = await selectLatestConversations(target);

  // Bazadagi JAMI suhbat — progressning halol maxraji uchun kerak.
  const { count: totalConversations } = await admin
    .from("sales_conversations")
    .select("id", { count: "exact", head: true });

  // Jami xabarlar suhbat qatoridagi hisoblagichdan yig'iladi (ingest uni
  // har xabarda qayta hisoblaydi), ya'ni bu ham real son.
  const totalMessages = selected.reduce((sum, c) => sum + c.messageCount, 0);

  const { data: job, error } = await admin
    .from("sales_learning_jobs")
    .insert({
      kind: "deep",
      status: "running",
      stage: "loading",
      progress_percent: 0,
      total_conversations: totalConversations ?? 0,
      target_conversations: selected.length,
      selected_conversations: selected.length,
      total_messages: totalMessages,
      batch_size: batchSize,
      model,
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      created_by: options.actorId,
      resumed_from_job_id: options.resumeFromJobId ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  const jobId = job.id as string;

  // Batch rejasi oldindan yoziladi: uzilib qolgan yugurish qaysi
  // suhbatlar qolganini aynan shu yerdan biladi.
  const batches = chunkIntoBatches(selected, batchSize).map((group, index) => ({
    job_id: jobId,
    batch_index: index,
    conversation_ids: group.map((c) => c.id),
    status: "pending",
  }));
  if (batches.length > 0) {
    const { error: batchError } = await admin.from("sales_learning_batches").insert(batches);
    if (batchError) throw new Error(batchError.message);
  }

  return {
    jobId,
    targetConversations: selected.length,
    totalMessages,
    batchCount: batches.length,
  };
}

/* --------------------------- bitta suhbat ishlash ------------------------ */

interface ConversationWork {
  conversationId: string;
  messages: DialogMessage[];
  outcome: SalesOutcome;
  outcomeEvidenceId: string | null;
  outcomeSignals: Record<string, boolean>;
  hash: string;
  styleSamples: StyleSample[];
  unchanged: boolean;
}

/** Bir suhbatning uslub namunalari — javob juftliklari konteksti bilan. */
function buildStyleSamples(
  conversationId: string,
  redacted: readonly DialogMessage[],
): StyleSample[] {
  const turns = buildDialogTurns(redacted);
  const pairs = pairQuestionResponses(turns);
  const samples: StyleSample[] = [];
  const pairedTurnIndexes = new Set<number>();

  for (const pair of pairs) {
    if (!pair.answer || pair.answer.text.trim() === "") continue;
    pairedTurnIndexes.add(pair.answer.index);
    samples.push({
      text: pair.answer.text,
      sentAt: pair.answer.startedAt,
      direction: "outgoing",
      conversationId,
      // Mijoz nima yozganini bilamiz — "qisqa savolga qisqa javob"
      // ko'rsatkichi shundan chiqadi.
      incomingWords: pair.question.text.split(/\s+/).filter(Boolean).length,
      incomingQuestionCount: countQuestions(pair.question.text),
    });
  }

  // Juftsiz chiquvchi navbatlar ham uslub namunasi (masalan follow-up),
  // lekin ularda mijoz konteksti yo'q va u qo'shilmaydi.
  for (const turn of turns) {
    if (turn.speaker !== "us" || pairedTurnIndexes.has(turn.index)) continue;
    if (turn.text.trim() === "") continue;
    samples.push({
      text: turn.text,
      sentAt: turn.startedAt,
      direction: "outgoing",
      conversationId,
    });
  }

  return samples;
}

async function loadConversationMessages(
  conversationIds: readonly string[],
  maxPerConversation: number,
): Promise<Map<string, DialogMessage[]>> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_messages")
    .select("id, conversation_id, direction, message_type, text, sent_at")
    .in("conversation_id", [...conversationIds])
    // O'chirilgan xabar o'rganilmaydi: mijoz uni ataylab olib tashlagan.
    .is("deleted_at", null)
    .order("sent_at", { ascending: true });

  const map = new Map<string, DialogMessage[]>();
  for (const row of data ?? []) {
    const conversationId = row.conversation_id as string;
    const list = map.get(conversationId) ?? [];
    // BARCHA xabarlar olinadi; chegara faqat juda uzun suhbatlar uchun
    // (kontekst limiti) va u yetgani job hisobotida ko'rinadi.
    if (list.length < maxPerConversation) {
      list.push({
        id: row.id as string,
        direction: row.direction as "incoming" | "outgoing",
        messageType: (row.message_type as string) ?? "text",
        text: (row.text as string | null) ?? null,
        sentAt: row.sent_at as string,
      });
    }
    map.set(conversationId, list);
  }
  return map;
}

/* ------------------------------ batch ishlash --------------------------- */

interface StoredObservations {
  intents: IntentObservation[];
  patterns: PatternObservation[];
  knowledge: KnowledgeDraft[];
  hash: string;
}

async function callModel(
  transcriptText: string,
  model: string,
): Promise<{ parsed: unknown; usage: TokenUsage }> {
  let usage = EMPTY_USAGE;
  let lastParsed: unknown = null;

  for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
    const completion = await getOpenAI().chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: BATCH_EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            attempt === 1
              ? buildBatchPrompt(transcriptText)
              : `${buildBatchPrompt(transcriptText)}\n\nOLDINGI JAVOB SHAKLI NOTO‘G‘RI EDI. ` +
                `Faqat {"conversations": [...]} shaklidagi JSON qaytar.`,
        },
      ],
    });

    usage = addUsage(usage, {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      totalTokens: completion.usage?.total_tokens ?? 0,
    });

    lastParsed = parseModelJson(completion.choices[0]?.message?.content);
    if (isBatchShapeValid(lastParsed)) return { parsed: lastParsed, usage };
  }

  // Ikki urinishdan keyin ham shakl buzuq — batch xato deb belgilanadi,
  // qolgan batch'lar davom etadi.
  throw new Error("Model javobi kutilgan JSON shaklida kelmadi (2 urinish).");
}

async function processBatch(
  jobId: string,
  batchIndex: number,
  conversationIds: readonly string[],
  model: string,
  maxPerConversation: number,
): Promise<BatchResult> {
  const admin = createSupabaseAdminClient();

  const { data: rows } = await admin
    .from("sales_conversations")
    .select("id, deep_learned_hash, deep_observations")
    .in("id", [...conversationIds]);

  const stored = new Map<string, { hash: string | null; observations: StoredObservations | null }>();
  for (const row of rows ?? []) {
    const raw = row.deep_observations as StoredObservations | null;
    stored.set(row.id as string, {
      hash: (row.deep_learned_hash as string | null) ?? null,
      observations: raw && Array.isArray(raw.intents) ? raw : null,
    });
  }

  const messagesByConversation = await loadConversationMessages(conversationIds, maxPerConversation);

  const work: ConversationWork[] = [];
  const toExtract: BatchConversationInput[] = [];
  const outcomeByConversation = new Map<string, SalesOutcome>();
  let messagesProcessed = 0;

  for (const conversationId of conversationIds) {
    const messages = messagesByConversation.get(conversationId) ?? [];
    messagesProcessed += messages.length;
    if (messages.length === 0) continue;

    // Natija XOM matndan aniqlanadi: karta raqami maskalangandan keyin
    // "to'lov so'raldi" belgisi yo'qolib ketardi. Natija hech qayerga
    // yuborilmaydi — u faqat bizning bazamizda qoladi.
    const outcomeResult = detectOutcome(messages);
    outcomeByConversation.set(conversationId, outcomeResult.outcome);

    const redacted: DialogMessage[] = messages.map((message) => ({
      ...message,
      text: message.text ? redactPii(message.text).text : null,
    }));

    const hash = conversationRangeHash(conversationId, messages);
    const previous = stored.get(conversationId);
    const unchanged = previous?.hash === hash && previous?.observations != null;

    work.push({
      conversationId,
      messages,
      outcome: outcomeResult.outcome,
      outcomeEvidenceId: outcomeResult.evidenceMessageId,
      outcomeSignals: { ...outcomeResult.signals },
      hash,
      styleSamples: buildStyleSamples(conversationId, redacted),
      unchanged,
    });

    // O'zgarmagan suhbat modelga QAYTA yuborilmaydi.
    if (!unchanged) {
      toExtract.push({
        conversationId,
        messages: redacted.map<TranscriptMessage>((m) => ({
          id: m.id,
          direction: m.direction,
          text: m.text,
          messageType: m.messageType,
          sentAt: m.sentAt,
        })),
      });
    }
  }

  let intents: IntentObservation[] = [];
  let patterns: PatternObservation[] = [];
  let knowledge: KnowledgeDraft[] = [];
  let usage = EMPTY_USAGE;

  if (toExtract.length > 0) {
    const transcript = buildBatchTranscript(toExtract);
    const { parsed, usage: modelUsage } = await callModel(transcript.text, model);
    usage = modelUsage;

    const normalized = normalizeBatchExtraction(parsed, transcript, outcomeByConversation);
    intents = normalized.intents;
    patterns = normalized.patterns;
    knowledge = normalized.knowledge;
  }

  // O'zgarmagan suhbatlarning kuzatuvlari saqlangan joydan qo'shiladi —
  // shu tufayli yig'indi BARCHA tanlangan suhbatlarni qamrab oladi va
  // hech narsa ikki marta sanalmaydi.
  for (const item of work) {
    if (!item.unchanged) continue;
    const previous = stored.get(item.conversationId)?.observations;
    if (!previous) continue;
    intents.push(...(previous.intents ?? []));
    patterns.push(...(previous.patterns ?? []));
    knowledge.push(...(previous.knowledge ?? []));
  }

  // Har suhbatga o'z kuzatuvi va natijasi yoziladi.
  await Promise.all(
    work.map((item) => {
      const own: StoredObservations = {
        hash: item.hash,
        intents: intents.filter((i) => i.conversationId === item.conversationId),
        patterns: patterns.filter((p) => p.conversationId === item.conversationId),
        knowledge: knowledge.filter((k) => k.sourceConversationId === item.conversationId),
      };
      return admin
        .from("sales_conversations")
        .update({
          outcome: item.outcome,
          outcome_detected_at: new Date().toISOString(),
          outcome_evidence_message_id: item.outcomeEvidenceId,
          outcome_signals: item.outcomeSignals,
          deep_learning_status: "learned",
          deep_learned_at: new Date().toISOString(),
          deep_learned_hash: item.hash,
          deep_learned_message_count: item.messages.length,
          deep_learning_job_id: jobId,
          deep_observations: own,
        })
        .eq("id", item.conversationId);
    }),
  );

  return {
    batchIndex,
    conversationIds: [...conversationIds],
    messagesProcessed,
    intents,
    patterns,
    knowledge,
    styleSamples: work.flatMap((item) => item.styleSamples),
    outcomes: work.map((item) => ({ conversationId: item.conversationId, outcome: item.outcome })),
    usage,
  };
}

/* ------------------------------ yugurishni surish ------------------------ */

export interface DeepLearningSnapshot {
  jobId: string;
  status: string;
  stage: LearningStage;
  progress: RunProgress;
  processedConversations: number;
  targetConversations: number;
  processedMessages: number;
  totalMessages: number;
  failedBatches: number;
  pendingBatches: number;
  knowledgeCreated: number;
  usage: TokenUsage;
  estimatedCostUsd: number | null;
  error: string | null;
  finished: boolean;
}

export async function advanceDeepLearning(options: {
  jobId: string;
  actorId: string | null;
  timeBudgetMs?: number;
}): Promise<DeepLearningSnapshot> {
  const admin = createSupabaseAdminClient();
  const budget = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAtMs = Date.now();
  const settings = await getSalesSettings();

  const { data: job } = await admin
    .from("sales_learning_jobs")
    .select(
      "id, status, stage, model, target_conversations, total_messages, processed_conversations, processed_messages, knowledge_created, prompt_tokens, completion_tokens, total_tokens, started_at",
    )
    .eq("id", options.jobId)
    .maybeSingle();

  if (!job) throw new Error("O‘rganish yugurishi topilmadi.");
  const model = (job.model as string) ?? DEFAULT_MODEL;

  const { data: pending } = await admin
    .from("sales_learning_batches")
    .select("id, batch_index, conversation_ids, attempts")
    .eq("job_id", options.jobId)
    .in("status", ["pending", "failed"])
    .order("batch_index", { ascending: true });

  let processedConversations = (job.processed_conversations as number) ?? 0;
  let processedMessages = (job.processed_messages as number) ?? 0;
  let usage: TokenUsage = {
    promptTokens: (job.prompt_tokens as number) ?? 0,
    completionTokens: (job.completion_tokens as number) ?? 0,
    totalTokens: (job.total_tokens as number) ?? 0,
  };
  let firstError: string | null = null;

  for (const batch of pending ?? []) {
    // Vaqt byudjeti — serverless limitiga urilib qolmaslik uchun.
    // Qolgan batch'lar `pending` bo'lib qoladi va keyingi chaqiruv
    // aynan shu yerdan davom etadi.
    if (Date.now() - startedAtMs > budget) break;
    // Ikki marta xato bergan batch qayta urilmaydi — aks holda yugurish
    // bir xil xatoda cheksiz aylanardi.
    if (((batch.attempts as number) ?? 0) >= MAX_MODEL_ATTEMPTS) continue;

    await admin
      .from("sales_learning_batches")
      .update({
        status: "running",
        attempts: ((batch.attempts as number) ?? 0) + 1,
        started_at: new Date().toISOString(),
      })
      .eq("id", batch.id);

    try {
      const result = await processBatch(
        options.jobId,
        batch.batch_index as number,
        (batch.conversation_ids as string[]) ?? [],
        model,
        settings.deepLearning.maxMessagesPerConversation,
      );

      processedConversations += result.conversationIds.length;
      processedMessages += result.messagesProcessed;
      usage = addUsage(usage, result.usage);

      await admin
        .from("sales_learning_batches")
        .update({
          status: "succeeded",
          messages_processed: result.messagesProcessed,
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          result: {
            conversations: result.conversationIds.length,
            intents: result.intents.length,
            patterns: result.patterns.length,
            knowledge: result.knowledge.length,
          },
          error: null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", batch.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      firstError ??= message;
      await admin
        .from("sales_learning_batches")
        .update({
          status: "failed",
          error: message.slice(0, 500),
          finished_at: new Date().toISOString(),
        })
        .eq("id", batch.id);
    }

    await admin
      .from("sales_learning_jobs")
      .update({
        stage: "clustering",
        processed_conversations: processedConversations,
        processed_messages: processedMessages,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        heartbeat_at: new Date().toISOString(),
        progress_percent: computeRunProgress({
          stage: "clustering",
          processedConversations,
          targetConversations: (job.target_conversations as number) ?? 0,
          processedMessages,
          totalMessages: (job.total_messages as number) ?? 0,
          startedAt: (job.started_at as string) ?? null,
        }).percent,
      })
      .eq("id", options.jobId);
  }

  const { count: stillPending } = await admin
    .from("sales_learning_batches")
    .select("id", { count: "exact", head: true })
    .eq("job_id", options.jobId)
    .in("status", ["pending", "running"]);

  const { count: failedBatches } = await admin
    .from("sales_learning_batches")
    .select("id", { count: "exact", head: true })
    .eq("job_id", options.jobId)
    .eq("status", "failed");

  const remaining = stillPending ?? 0;
  if (remaining === 0) {
    return finalizeDeepLearning({ jobId: options.jobId, actorId: options.actorId });
  }

  return buildSnapshot({
    jobId: options.jobId,
    status: "running",
    stage: "clustering",
    processedConversations,
    targetConversations: (job.target_conversations as number) ?? 0,
    processedMessages,
    totalMessages: (job.total_messages as number) ?? 0,
    startedAt: (job.started_at as string) ?? null,
    knowledgeCreated: (job.knowledge_created as number) ?? 0,
    failedBatches: failedBatches ?? 0,
    pendingBatches: remaining,
    usage,
    model,
    error: firstError,
    finished: false,
  });
}

/* -------------------------------- yakunlash ------------------------------ */

async function loadAllBatchResults(jobId: string): Promise<BatchResult[]> {
  const admin = createSupabaseAdminClient();
  const { data: batches } = await admin
    .from("sales_learning_batches")
    .select("batch_index, conversation_ids, messages_processed, prompt_tokens, completion_tokens")
    .eq("job_id", jobId)
    .eq("status", "succeeded")
    .order("batch_index", { ascending: true });

  const conversationIds = (batches ?? []).flatMap((b) => (b.conversation_ids as string[]) ?? []);
  if (conversationIds.length === 0) return [];

  // Kuzatuvlar suhbat qatorlaridan qayta o'qiladi — shu sababli
  // yakunlash uzilgan yugurishdan keyin ham to'liq ishlaydi.
  const observations = new Map<string, StoredObservations>();
  const CHUNK = 100;
  for (let i = 0; i < conversationIds.length; i += CHUNK) {
    const { data } = await admin
      .from("sales_conversations")
      .select("id, deep_observations, outcome")
      .in("id", conversationIds.slice(i, i + CHUNK));
    for (const row of data ?? []) {
      const raw = row.deep_observations as StoredObservations | null;
      if (raw && Array.isArray(raw.intents)) observations.set(row.id as string, raw);
    }
  }

  return (batches ?? []).map((batch) => {
    const ids = (batch.conversation_ids as string[]) ?? [];
    const intents: IntentObservation[] = [];
    const patterns: PatternObservation[] = [];
    const knowledge: KnowledgeDraft[] = [];
    for (const id of ids) {
      const stored = observations.get(id);
      if (!stored) continue;
      intents.push(...(stored.intents ?? []));
      patterns.push(...(stored.patterns ?? []));
      knowledge.push(...(stored.knowledge ?? []));
    }
    return {
      batchIndex: batch.batch_index as number,
      conversationIds: ids,
      messagesProcessed: (batch.messages_processed as number) ?? 0,
      intents,
      patterns,
      knowledge,
      styleSamples: [],
      outcomes: [],
      usage: {
        promptTokens: (batch.prompt_tokens as number) ?? 0,
        completionTokens: (batch.completion_tokens as number) ?? 0,
        totalTokens:
          ((batch.prompt_tokens as number) ?? 0) + ((batch.completion_tokens as number) ?? 0),
      },
    } satisfies BatchResult;
  });
}

export async function finalizeDeepLearning(options: {
  jobId: string;
  actorId: string | null;
}): Promise<DeepLearningSnapshot> {
  const admin = createSupabaseAdminClient();
  const settings = await getSalesSettings();

  const { data: job } = await admin
    .from("sales_learning_jobs")
    .select("id, model, target_conversations, total_messages, started_at")
    .eq("id", options.jobId)
    .maybeSingle();
  const model = (job?.model as string) ?? DEFAULT_MODEL;

  await admin
    .from("sales_learning_jobs")
    .update({ stage: "aggregation", heartbeat_at: new Date().toISOString() })
    .eq("id", options.jobId);

  const batches = await loadAllBatchResults(options.jobId);
  const aggregate = aggregateBatches(batches, { buckets: settings.recencyBuckets });

  const knowledgeCreated = await persistAggregate(options.jobId, aggregate);
  const styleUpdated = await recomputeDeepStyleProfile(options.jobId, options.actorId);

  const { count: failedBatches } = await admin
    .from("sales_learning_batches")
    .select("id", { count: "exact", head: true })
    .eq("job_id", options.jobId)
    .eq("status", "failed");

  const usage = aggregate.usage;
  const cost = estimateCostUsd(model, usage);
  const failed = failedBatches ?? 0;
  const status = failed === 0 ? "succeeded" : batches.length > 0 ? "partial" : "failed";

  const messagesProcessed = batches.reduce((sum, b) => sum + b.messagesProcessed, 0);

  await admin
    .from("sales_learning_jobs")
    .update({
      status,
      stage: "done",
      progress_percent: 100,
      processed_conversations: aggregate.conversationsProcessed,
      processed_messages: messagesProcessed,
      knowledge_created: knowledgeCreated,
      messages_analyzed: messagesProcessed,
      failed_conversations: 0,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: cost,
      finished_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      aggregate: {
        topIntents: aggregate.intents.slice(0, 20).map((i) => ({
          key: i.key,
          label: i.label,
          occurrences: i.occurrences,
          conversationCount: i.conversationCount,
          share: i.share,
        })),
        topObjections: aggregate.objections.slice(0, 10).map((i) => ({
          key: i.key,
          label: i.label,
          occurrences: i.occurrences,
          share: i.share,
        })),
        patternCount: aggregate.patterns.length,
        styleUpdated,
      },
    })
    .eq("id", options.jobId);

  await logAudit({
    actorId: options.actorId,
    action: "sales.deep_learning.finish",
    entityType: "sales_learning_job",
    entityId: options.jobId,
    newValue: {
      conversations: aggregate.conversationsProcessed,
      intents: aggregate.intents.length,
      patterns: aggregate.patterns.length,
      knowledgeCreated,
    },
    severity: failed > 0 ? "warning" : "info",
  });

  return buildSnapshot({
    jobId: options.jobId,
    status,
    stage: "done",
    processedConversations: aggregate.conversationsProcessed,
    targetConversations: (job?.target_conversations as number) ?? aggregate.conversationsProcessed,
    processedMessages: messagesProcessed,
    totalMessages: (job?.total_messages as number) ?? messagesProcessed,
    startedAt: (job?.started_at as string) ?? null,
    knowledgeCreated,
    failedBatches: failed,
    pendingBatches: 0,
    usage,
    model,
    error: null,
    finished: true,
  });
}

/* ----------------------------- saqlash ---------------------------------- */

/** Niyat, javob shabloni va bilimni bazaga yozadi. Bilim soni qaytadi. */
async function persistAggregate(jobId: string, aggregate: RunAggregate): Promise<number> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // --- niyatlar ---
  const allIntents = [...aggregate.intents, ...aggregate.objections];
  if (allIntents.length > 0) {
    const { error } = await admin.from("sales_intents").upsert(
      allIntents.map((intent) => ({
        intent_key: intent.key,
        label: intent.label,
        kind: intent.kind,
        is_known: intent.known,
        // Sanoq HAR SAFAR QAYTA HISOBLANADI, inkrement emas: shu tufayli
        // bir suhbat ikki yugurishda ikki marta sanalmaydi.
        occurrences: intent.occurrences,
        conversation_count: intent.conversationCount,
        share: intent.share,
        examples: intent.examples,
        conversation_ids: intent.conversationIds,
        last_seen_at: now,
        last_job_id: jobId,
      })),
      { onConflict: "intent_key" },
    );
    if (error) throw new Error(error.message);
  }

  const { data: intentRows } = await admin.from("sales_intents").select("id, intent_key");
  const intentIdByKey = new Map(
    (intentRows ?? []).map((row) => [row.intent_key as string, row.id as string]),
  );

  // --- javob shablonlari ---
  if (aggregate.patterns.length > 0) {
    const { error } = await admin.from("sales_response_patterns").upsert(
      aggregate.patterns.map((pattern) => ({
        intent_id: intentIdByKey.get(pattern.intentKey) ?? null,
        intent_key: pattern.intentKey,
        intent_label: pattern.intentLabel,
        intent_kind: pattern.intentKind,
        customer_example: pattern.customerExample,
        response_example: pattern.responseExample,
        frequency: pattern.frequency,
        success_count: pattern.successCount,
        unknown_count: pattern.unknownCount,
        success_rate: pattern.successRate,
        last_seen_at: pattern.lastSeenAt,
        recency_weight: pattern.recencyWeight,
        conversation_ids: pattern.conversationIds,
        source_message_ids: pattern.sourceMessageIds,
        last_job_id: jobId,
        dedupe_key: pattern.dedupeKey,
      })),
      // `status` YUBORILMAYDI: admin tasdiqlagan shablon keyingi
      // yugurishda qoralamaga qaytmaydi (ustun defaulti faqat insertda).
      { onConflict: "dedupe_key" },
    );
    if (error) throw new Error(error.message);
  }

  // --- bilim (0.1 dagi jadval, o'sha qoidalar bilan) ---
  let knowledgeCreated = 0;
  const uniqueKnowledge = new Map(aggregate.knowledge.map((k) => [k.dedupeKey, k]));
  const items = [...uniqueKnowledge.values()];
  const CHUNK = 100;
  for (let i = 0; i < items.length; i += CHUNK) {
    const { data, error } = await admin
      .from("sales_knowledge")
      .upsert(
        items.slice(i, i + CHUNK).map((item) => ({
          category: item.category,
          question: item.question,
          answer: item.answer,
          tags: item.tags,
          confidence: item.confidence,
          status: "draft",
          source_conversation_id: item.sourceConversationId,
          source_message_id: item.sourceMessageId,
          source_excerpt: item.sourceExcerpt,
          job_id: jobId,
          dedupe_key: item.dedupeKey,
        })),
        // Admin tasdiqlagan yozuv qoralamaga qaytarilmaydi.
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(error.message);
    knowledgeCreated += data?.length ?? 0;
  }

  return knowledgeCreated;
}

/**
 * Uslub profilini qayta hisoblaydi — endi juftlik konteksti bilan.
 *
 * Namunalar suhbat qatorlaridan emas, XABARLARDAN olinadi va har javob
 * o'zi javob bergan mijoz xabari bilan birga keladi. Shu sababli
 * "mijoz qisqa yozsa biz qanday javob beramiz" ko'rsatkichi paydo bo'ladi.
 */
async function recomputeDeepStyleProfile(
  jobId: string,
  actorId: string | null,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const settings = await getSalesSettings();

  const { data: conversations } = await admin
    .from("sales_conversations")
    .select("id")
    .eq("deep_learning_status", "learned")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(settings.deepLearning.targetConversations);

  const ids = (conversations ?? []).map((row) => row.id as string);
  if (ids.length === 0) return false;

  const samples: StyleSample[] = [];
  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const messages = await loadConversationMessages(
      ids.slice(i, i + CHUNK),
      settings.deepLearning.maxMessagesPerConversation,
    );
    for (const [conversationId, list] of messages) {
      const redacted = list.map((message) => ({
        ...message,
        text: message.text ? redactPii(message.text).text : null,
      }));
      samples.push(...buildStyleSamples(conversationId, redacted));
    }
  }

  const analysis = analyzeStyle(samples, { buckets: settings.recencyBuckets });

  await admin.from("sales_style_profiles").update({ is_active: false }).eq("is_active", true);
  const { error } = await admin.from("sales_style_profiles").insert({
    name: "Chuqur uslub profili",
    is_active: true,
    sample_conversation_count: analysis.sampleConversationCount,
    sample_message_count: analysis.sampleMessageCount,
    weighted_sample: analysis.weightedSample,
    profile: analysis.profile,
    recency_buckets: settings.recencyBuckets,
    job_id: jobId,
    computed_at: new Date().toISOString(),
    created_by: actorId,
  });
  if (error) throw new Error(error.message);
  return true;
}

/* ------------------------------- snapshot -------------------------------- */

function buildSnapshot(input: {
  jobId: string;
  status: string;
  stage: LearningStage;
  processedConversations: number;
  targetConversations: number;
  processedMessages: number;
  totalMessages: number;
  startedAt: string | null;
  knowledgeCreated: number;
  failedBatches: number;
  pendingBatches: number;
  usage: TokenUsage;
  model: string;
  error: string | null;
  finished: boolean;
}): DeepLearningSnapshot {
  return {
    jobId: input.jobId,
    status: input.status,
    stage: input.stage,
    progress: computeRunProgress({
      stage: input.stage,
      processedConversations: input.processedConversations,
      targetConversations: input.targetConversations,
      processedMessages: input.processedMessages,
      totalMessages: input.totalMessages,
      startedAt: input.startedAt,
    }),
    processedConversations: input.processedConversations,
    targetConversations: input.targetConversations,
    processedMessages: input.processedMessages,
    totalMessages: input.totalMessages,
    failedBatches: input.failedBatches,
    pendingBatches: input.pendingBatches,
    knowledgeCreated: input.knowledgeCreated,
    usage: input.usage,
    estimatedCostUsd: estimateCostUsd(input.model, input.usage),
    error: input.error,
    finished: input.finished,
  };
}
