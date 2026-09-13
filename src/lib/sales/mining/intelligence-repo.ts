import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CoverageStatus } from "./coverage.ts";
import type { RunKind, RunStatus } from "./run-types.ts";

/**
 * SOTUV AQLI — O'QISH QATLAMI.
 *
 * Admin sahifasi SAQLANGAN natijani ko'rsatadi, qayta hisoblamaydi
 * (7-band). Shu sabab har sahifa yuklashda 20 000 xabar o'qilmaydi
 * va ko'rsatilgan son qaysi yugurishdan kelgani aniq bo'ladi.
 */

export interface MiningRunRow {
  id: string;
  kind: RunKind;
  status: RunStatus;
  conversationsDiscovered: number;
  conversationsProcessed: number;
  messagesDiscovered: number;
  messagesProcessed: number;
  incoming: number;
  humanOutbound: number;
  aiOutbound: number;
  mediaOnly: number;
  deleted: number;
  skipped: number;
  earliestMessageAt: string | null;
  latestMessageAt: string | null;
  coverageStatus: CoverageStatus;
  coverageNote: string | null;
  measuredRatePerSec: number | null;
  etaSeconds: number | null;
  durationMs: number | null;
  currentBatch: number;
  failedBatches: Array<{ batchIndex: number; reason: string }>;
  faqClusters: number;
  objectionClusters: number;
  questionsFound: number;
  activated: boolean;
  error: string | null;
  notes: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

function toRun(row: Record<string, unknown>): MiningRunRow {
  const notes = Array.isArray(row.notes)
    ? row.notes.filter((note): note is string => typeof note === "string")
    : [];
  const failed = Array.isArray(row.failed_batches)
    ? (row.failed_batches as Array<Record<string, unknown>>).map((batch) => ({
        batchIndex: Number(batch.batchIndex ?? 0),
        reason: String(batch.reason ?? ""),
      }))
    : [];

  return {
    id: row.id as string,
    kind: (row.kind as RunKind) ?? "incremental",
    status: (row.status as RunStatus) ?? "queued",
    conversationsDiscovered: (row.conversations_discovered as number) ?? 0,
    conversationsProcessed: (row.conversations_processed as number) ?? 0,
    messagesDiscovered: (row.messages_discovered as number) ?? 0,
    messagesProcessed: (row.messages_processed as number) ?? 0,
    incoming: (row.incoming_count as number) ?? 0,
    humanOutbound: (row.human_outbound_count as number) ?? 0,
    aiOutbound: (row.ai_outbound_count as number) ?? 0,
    mediaOnly: (row.media_only_count as number) ?? 0,
    deleted: (row.deleted_count as number) ?? 0,
    skipped: (row.skipped_count as number) ?? 0,
    earliestMessageAt: (row.earliest_message_at as string | null) ?? null,
    latestMessageAt: (row.latest_message_at as string | null) ?? null,
    coverageStatus: (row.coverage_status as CoverageStatus) ?? "unknown",
    coverageNote: (row.coverage_note as string | null) ?? null,
    measuredRatePerSec: row.measured_rate_per_sec == null ? null : Number(row.measured_rate_per_sec),
    etaSeconds: (row.eta_seconds as number | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
    currentBatch: (row.current_batch as number) ?? 0,
    failedBatches: failed,
    faqClusters: (row.faq_clusters as number) ?? 0,
    objectionClusters: (row.objection_clusters as number) ?? 0,
    questionsFound: (row.questions_found as number) ?? 0,
    activated: row.activated === true,
    error: (row.error as string | null) ?? null,
    notes,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

const RUN_COLUMNS =
  "id, kind, status, conversations_discovered, conversations_processed, messages_discovered, " +
  "messages_processed, incoming_count, human_outbound_count, ai_outbound_count, media_only_count, " +
  "deleted_count, skipped_count, earliest_message_at, latest_message_at, coverage_status, " +
  "coverage_note, measured_rate_per_sec, eta_seconds, duration_ms, current_batch, failed_batches, " +
  "faq_clusters, objection_clusters, questions_found, activated, error, notes, started_at, " +
  "finished_at, created_at";

export async function listMiningRuns(limit = 10): Promise<MiningRunRow[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_mining_runs")
    .select(RUN_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => toRun(row as unknown as Record<string, unknown>));
}

/** Hozir ishlayotgan yugurish — progress ko'rsatish uchun. */
export async function getActiveMiningRun(): Promise<MiningRunRow | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_mining_runs")
    .select(RUN_COLUMNS)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toRun(data as unknown as Record<string, unknown>) : null;
}

export async function getLatestCompletedRun(): Promise<MiningRunRow | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_mining_runs")
    .select(RUN_COLUMNS)
    .eq("status", "completed")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toRun(data as unknown as Record<string, unknown>) : null;
}

/* ---------------------------------- FAQ ---------------------------------- */

export interface FaqRow {
  id: string;
  normalizedQuestion: string;
  canonicalQuestion: string;
  canonicalAnswer: string | null;
  category: string;
  intentKey: string | null;
  intentKind: string;
  status: string;
  answerStatus: string;
  /** Necha marta yozilgan. */
  messageCount: number;
  /** Nechta BOSHQA suhbatda. Ikkisi turli son — ataylab. */
  conversationCount: number;
  variants: string[];
  examples: Array<{ text: string; askedAt: string | null }>;
  firstSeenAt: string;
  lastSeenAt: string;
}

function toFaq(row: Record<string, unknown>): FaqRow {
  return {
    id: row.id as string,
    normalizedQuestion: row.normalized_question as string,
    canonicalQuestion: row.canonical_question as string,
    canonicalAnswer: (row.canonical_answer as string | null) ?? null,
    category: (row.category as string) ?? "faq",
    intentKey: (row.intent_key as string | null) ?? null,
    intentKind: (row.intent_kind as string) ?? "question",
    status: (row.status as string) ?? "draft",
    answerStatus: (row.answer_status as string) ?? "unanswered",
    messageCount: (row.message_count as number) ?? 0,
    conversationCount: (row.conversation_count as number) ?? 0,
    variants: Array.isArray(row.alternative_phrasings)
      ? (row.alternative_phrasings as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    examples: Array.isArray(row.examples)
      ? (row.examples as Array<Record<string, unknown>>).map((example) => ({
          text: String(example.text ?? ""),
          askedAt: (example.askedAt as string | null) ?? null,
        }))
      : [],
    firstSeenAt: row.first_seen_at as string,
    lastSeenAt: row.last_seen_at as string,
  };
}

const FAQ_COLUMNS =
  "id, normalized_question, canonical_question, canonical_answer, category, intent_key, " +
  "intent_kind, status, answer_status, message_count, conversation_count, " +
  "alternative_phrasings, examples, first_seen_at, last_seen_at";

export async function listFaq(options: {
  status?: string | null;
  onlyUnanswered?: boolean;
  limit?: number;
} = {}): Promise<FaqRow[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("sales_faq")
    .select(FAQ_COLUMNS)
    // TARTIB SUHBAT SONI BO'YICHA: bitta mijozning o'n takrori
    // ro'yxat boshiga chiqmasligi kerak (15-band).
    .order("conversation_count", { ascending: false })
    .order("message_count", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.status) query = query.eq("status", options.status);
  if (options.onlyUnanswered) query = query.eq("answer_status", "unanswered");

  const { data } = await query;
  return (data ?? []).map((row) => toFaq(row as unknown as Record<string, unknown>));
}

export async function countFaq(): Promise<{
  total: number;
  draft: number;
  approved: number;
  unanswered: number;
}> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("sales_faq").select("status, answer_status");
  const rows = data ?? [];
  return {
    total: rows.length,
    draft: rows.filter((row) => row.status === "draft").length,
    approved: rows.filter((row) => row.status === "approved").length,
    unanswered: rows.filter((row) => row.answer_status === "unanswered").length,
  };
}

/* ------------------------------- e'tirozlar ------------------------------ */

export interface ObjectionRow {
  id: string;
  kind: string;
  label: string;
  messageCount: number;
  conversationCount: number;
  examples: string[];
  strategy: string[];
  status: string;
  lastSeenAt: string;
}

export async function listObjections(limit = 40): Promise<ObjectionRow[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_objections")
    .select("id, objection_kind, label, message_count, conversation_count, examples, strategy, status, last_seen_at")
    .order("conversation_count", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.objection_kind as string,
    label: row.label as string,
    messageCount: (row.message_count as number) ?? 0,
    conversationCount: (row.conversation_count as number) ?? 0,
    examples: Array.isArray(row.examples)
      ? (row.examples as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    strategy: Array.isArray(row.strategy)
      ? (row.strategy as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    status: (row.status as string) ?? "draft",
    lastSeenAt: row.last_seen_at as string,
  }));
}

/* ------------------------------- ziddiyatlar ----------------------------- */

export interface ConflictRow {
  id: string;
  topicKey: string;
  topicLabel: string;
  members: Array<{ id: string; stance: string; excerpt: string }>;
  detectionReason: string;
  status: string;
  lastDetectedAt: string;
}

export async function listKnowledgeConflicts(
  status: "open" | "resolved" | "dismissed" | null = "open",
): Promise<ConflictRow[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("sales_knowledge_conflicts")
    .select("id, topic_key, topic_label, members, detection_reason, status, last_detected_at")
    .order("last_detected_at", { ascending: false })
    .limit(50);
  if (status) query = query.eq("status", status);

  const { data } = await query;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    topicKey: row.topic_key as string,
    topicLabel: row.topic_label as string,
    members: Array.isArray(row.members)
      ? (row.members as Array<Record<string, unknown>>).map((member) => ({
          id: String(member.id ?? ""),
          stance: String(member.stance ?? ""),
          excerpt: String(member.excerpt ?? ""),
        }))
      : [],
    detectionReason: row.detection_reason as string,
    status: row.status as string,
    lastDetectedAt: row.last_detected_at as string,
  }));
}

/* --------------------------- muddati o'tgan bilim ------------------------ */

export interface KnowledgeValidityRow {
  id: string;
  question: string | null;
  answer: string;
  factKind: string;
  validUntil: string | null;
  neverExpires: boolean;
  conflictStatus: string;
  supersededAt: string | null;
}

/**
 * Mijozga AYTILMAYDIGAN tasdiqlangan bilimlar.
 *
 * Adminda alohida ro'yxat: "tasdiqlangan, lekin ishlatilmayapti"
 * degan holat ko'rinmasa, odam nega bot javob bermayotganini
 * tushunmaydi.
 */
export async function listQuarantinedKnowledge(limit = 50): Promise<KnowledgeValidityRow[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_knowledge")
    .select("id, question, answer, fact_kind, valid_until, never_expires, conflict_status, superseded_at")
    .eq("status", "approved")
    .is("archived_at", null)
    .or("fact_kind.in.(unclassified,temporary_offer,task_promise,historical_example),conflict_status.eq.conflicted,superseded_at.not.is.null")
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    question: (row.question as string | null) ?? null,
    answer: row.answer as string,
    factKind: (row.fact_kind as string) ?? "unclassified",
    validUntil: (row.valid_until as string | null) ?? null,
    neverExpires: row.never_expires === true,
    conflictStatus: (row.conflict_status as string) ?? "none",
    supersededAt: (row.superseded_at as string | null) ?? null,
  }));
}

/* ------------------------------ uslub profillari ------------------------- */

export interface StyleProfileRow {
  id: string;
  name: string;
  status: string;
  isActive: boolean;
  humanMessageCount: number;
  excludedMessageCount: number;
  excludedReasons: Record<string, number>;
  conversationCount: number;
  datasetStartAt: string | null;
  datasetEndAt: string | null;
  classMetrics: Record<string, unknown>;
  coverageNote: string | null;
  computedAt: string;
}

export async function listStyleProfiles(limit = 10): Promise<StyleProfileRow[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_style_profiles")
    .select("id, name, status, is_active, human_message_count, excluded_message_count, excluded_reasons, sample_conversation_count, dataset_start_at, dataset_end_at, class_metrics, coverage_note, computed_at")
    .order("computed_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string) ?? "Uslub",
    status: (row.status as string) ?? "draft",
    isActive: row.is_active === true,
    humanMessageCount: (row.human_message_count as number) ?? 0,
    excludedMessageCount: (row.excluded_message_count as number) ?? 0,
    excludedReasons: (row.excluded_reasons as Record<string, number>) ?? {},
    conversationCount: (row.sample_conversation_count as number) ?? 0,
    datasetStartAt: (row.dataset_start_at as string | null) ?? null,
    datasetEndAt: (row.dataset_end_at as string | null) ?? null,
    classMetrics: (row.class_metrics as Record<string, unknown>) ?? {},
    coverageNote: (row.coverage_note as string | null) ?? null,
    computedAt: row.computed_at as string,
  }));
}

/* -------------------------------- navbat --------------------------------- */

export interface QueueSnapshot {
  queued: number;
  claimed: number;
  waiting: number;
  failedRetryable: number;
  deadLetter: number;
}

export async function getQueueSnapshot(): Promise<QueueSnapshot> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_ai_jobs")
    .select("status")
    .in("status", ["queued", "claimed", "waiting", "failed_retryable", "dead_letter"]);

  const snapshot: QueueSnapshot = {
    queued: 0,
    claimed: 0,
    waiting: 0,
    failedRetryable: 0,
    deadLetter: 0,
  };
  for (const row of data ?? []) {
    switch (row.status as string) {
      case "queued": snapshot.queued += 1; break;
      case "claimed": snapshot.claimed += 1; break;
      case "waiting": snapshot.waiting += 1; break;
      case "failed_retryable": snapshot.failedRetryable += 1; break;
      case "dead_letter": snapshot.deadLetter += 1; break;
    }
  }
  return snapshot;
}
