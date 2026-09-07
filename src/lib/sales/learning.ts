import "server-only";
import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getSalesSettings } from "./settings.ts";
import {
  buildExtractionPrompt,
  buildTranscript,
  EXTRACTION_SYSTEM_PROMPT,
  normalizeExtraction,
  parseModelJson,
  transcriptHash,
  type TranscriptMessage,
} from "./knowledge.ts";
import { analyzeStyle, type StyleSample } from "./style.ts";
import type { LearningJobKind, LearningStatus } from "./types.ts";

/**
 * O'rganish yugurishi.
 *
 * 0.1 DA BU YERDA MIJOZGA HECH NARSA YUBORILMAYDI. Modul Telegram
 * transportini umuman import qilmaydi — o'qish, tahlil va saqlashdan
 * boshqa yo'l yo'q.
 *
 * IKKI XIL O'RGANISH ATAYLAB AJRATILGAN:
 *   · `learnKnowledge` — FAKT chiqaradi (AI chaqiruvi, suhbat-suhbat);
 *   · `recomputeStyleProfile` — USLUB o'lchaydi (AI'siz, determinatsiyalangan
 *     hisob-kitob). Uslub uchun model chaqirilmaydi: o'lchov takrorlanuvchi
 *     bo'lishi kerak va bir xil kirishda bir xil natija berishi shart.
 */

const DEFAULT_MODEL = "gpt-4o-mini";
/** Bitta suhbatdan modelga yuboriladigan eng ko'p xabar. */
const MAX_TRANSCRIPT_MESSAGES = 200;
/** Uslub tahliliga olinadigan eng yangi chiquvchi xabarlar soni. */
const MAX_STYLE_SAMPLES = 3000;

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY sozlanmagan — bilim ajratib bo‘lmaydi.");
  }
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export interface LearningRunResult {
  jobId: string;
  status: "succeeded" | "failed" | "partial";
  totalConversations: number;
  selectedConversations: number;
  processedConversations: number;
  failedConversations: number;
  knowledgeCreated: number;
  messagesAnalyzed: number;
  styleUpdated: boolean;
  error: string | null;
}

/* ------------------------------ job yozuvi ------------------------------ */

async function createJob(
  kind: LearningJobKind,
  actorId: string | null,
  totalConversations: number,
  model: string,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_learning_jobs")
    .insert({
      kind,
      status: "running",
      // Maxraj yugurish BOSHIDA muhrlanadi: keyin yangi suhbat kelsa ham
      // shu yugurishning hisoboti o'zgarmaydi.
      total_conversations: totalConversations,
      model,
      started_at: new Date().toISOString(),
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

async function finishJob(
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_learning_jobs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", jobId);
}

/* ------------------------------ fakt o'rganish -------------------------- */

interface ConversationToLearn {
  id: string;
  messageCount: number;
  learningStatus: LearningStatus;
  learnedContentHash: string | null;
}

async function selectConversations(limit: number): Promise<ConversationToLearn[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_conversations")
    .select("id, message_count, learning_status, learned_content_hash")
    // 'failed' ham qayta uriniladi: xato vaqtinchalik (model timeout)
    // bo'lishi mumkin va suhbat abadiy o'rganilmay qolmasligi kerak.
    .in("learning_status", ["pending", "failed"])
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    messageCount: (row.message_count as number) ?? 0,
    learningStatus: (row.learning_status as LearningStatus) ?? "pending",
    learnedContentHash: (row.learned_content_hash as string | null) ?? null,
  }));
}

async function loadTranscriptMessages(conversationId: string): Promise<TranscriptMessage[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_messages")
    .select("id, direction, message_type, text, sent_at")
    // O'chirilgan xabar o'rganilmaydi: mijoz uni ataylab olib tashlagan.
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("sent_at", { ascending: true })
    .limit(MAX_TRANSCRIPT_MESSAGES);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    direction: row.direction as "incoming" | "outgoing",
    text: (row.text as string | null) ?? null,
    messageType: (row.message_type as string) ?? "text",
    sentAt: row.sent_at as string,
  }));
}

async function setConversationStatus(
  conversationId: string,
  status: LearningStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_conversations")
    .update({ learning_status: status, ...extra })
    .eq("id", conversationId);
}

/**
 * Bitta suhbatdan bilim ajratadi.
 * Qaytadi: yaratilgan bilim soni; suhbat o'tkazib yuborilgan bo'lsa null.
 */
async function learnOneConversation(
  conversation: ConversationToLearn,
  jobId: string,
  model: string,
  minMessages: number,
): Promise<{ created: number; analyzed: number; skipped: boolean }> {
  const messages = await loadTranscriptMessages(conversation.id);

  if (messages.length < minMessages) {
    await setConversationStatus(conversation.id, "skipped", {
      last_learning_job_id: jobId,
      learning_error: null,
    });
    return { created: 0, analyzed: messages.length, skipped: true };
  }

  // MAXFIYLIK: transkript modelga chiqishdan oldin redaksiya qilinadi.
  const transcript = buildTranscript(messages);
  const hash = transcriptHash(transcript.text);

  // O'zgarmagan suhbat modelga QAYTA yuborilmaydi — bu ham pul, ham vaqt.
  if (conversation.learnedContentHash === hash) {
    await setConversationStatus(conversation.id, "learned", {
      last_learning_job_id: jobId,
      learning_error: null,
    });
    return { created: 0, analyzed: messages.length, skipped: true };
  }

  if (transcript.lineCount === 0) {
    await setConversationStatus(conversation.id, "skipped", {
      last_learning_job_id: jobId,
      learned_content_hash: hash,
    });
    return { created: 0, analyzed: messages.length, skipped: true };
  }

  await setConversationStatus(conversation.id, "learning", { last_learning_job_id: jobId });

  const completion = await getOpenAI().chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: buildExtractionPrompt(transcript.text) },
    ],
  });

  const parsed = parseModelJson(completion.choices[0]?.message?.content);
  const { items } = normalizeExtraction(parsed, {
    conversationId: conversation.id,
    indexToMessageId: transcript.indexToMessageId,
  });

  let created = 0;
  if (items.length > 0) {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("sales_knowledge")
      .upsert(
        items.map((item) => ({
          category: item.category,
          question: item.question,
          answer: item.answer,
          tags: item.tags,
          confidence: item.confidence,
          // 0.1 da hamma narsa QORALAMA. Admin tasdiqlamaguncha ishlatilmaydi.
          status: "draft",
          source_conversation_id: item.sourceConversationId,
          source_message_id: item.sourceMessageId,
          source_excerpt: item.sourceExcerpt,
          job_id: jobId,
          dedupe_key: item.dedupeKey,
        })),
        // `ignoreDuplicates` MUHIM: admin tasdiqlagan yoki tahrirlagan
        // yozuv keyingi yugurishda qoralamaga qaytarilmaydi.
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id");

    if (error) throw new Error(error.message);
    created = data?.length ?? 0;
  }

  await setConversationStatus(conversation.id, "learned", {
    learned_at: new Date().toISOString(),
    learned_content_hash: hash,
    learning_error: null,
    last_learning_job_id: jobId,
  });

  return { created, analyzed: messages.length, skipped: false };
}

/* ------------------------------ uslub o'rganish ------------------------- */

export async function recomputeStyleProfile(options: {
  actorId: string | null;
  jobId?: string | null;
}): Promise<{ sampleMessageCount: number; weightedSample: number }> {
  const admin = createSupabaseAdminClient();
  const settings = await getSalesSettings();

  // Faqat CHIQUVCHI xabarlar: biz o'z uslubimizni o'rganamiz.
  const { data } = await admin
    .from("sales_messages")
    .select("text, sent_at, direction, conversation_id")
    .eq("direction", "outgoing")
    .is("deleted_at", null)
    .not("text", "is", null)
    .order("sent_at", { ascending: false })
    .limit(MAX_STYLE_SAMPLES);

  const samples: StyleSample[] = (data ?? []).map((row) => ({
    text: (row.text as string | null) ?? null,
    sentAt: row.sent_at as string,
    direction: "outgoing",
    conversationId: (row.conversation_id as string) ?? undefined,
  }));

  const analysis = analyzeStyle(samples, { buckets: settings.recencyBuckets });

  // Bir vaqtda bitta aktiv profil (uq_sales_style_profiles_active).
  await admin
    .from("sales_style_profiles")
    .update({ is_active: false })
    .eq("is_active", true);

  const { error } = await admin.from("sales_style_profiles").insert({
    name: "Asosiy uslub",
    is_active: true,
    sample_conversation_count: analysis.sampleConversationCount,
    sample_message_count: analysis.sampleMessageCount,
    weighted_sample: analysis.weightedSample,
    profile: analysis.profile,
    recency_buckets: settings.recencyBuckets,
    job_id: options.jobId ?? null,
    computed_at: new Date().toISOString(),
    created_by: options.actorId,
  });
  if (error) throw new Error(error.message);

  return {
    sampleMessageCount: analysis.sampleMessageCount,
    weightedSample: analysis.weightedSample,
  };
}

/* -------------------------------- yugurish ------------------------------ */

export async function runLearning(options: {
  actorId: string | null;
  kind: LearningJobKind;
  limit?: number;
}): Promise<LearningRunResult> {
  const admin = createSupabaseAdminClient();
  const settings = await getSalesSettings();
  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const limit = Math.max(1, options.limit ?? settings.learning.batchSize);

  // MAXRAJ — bazadagi jami suhbat. Telegram'dagi butun tarix emas.
  const { count: totalConversations } = await admin
    .from("sales_conversations")
    .select("id", { count: "exact", head: true });

  const jobId = await createJob(options.kind, options.actorId, totalConversations ?? 0, model);

  let processed = 0;
  let failed = 0;
  let knowledgeCreated = 0;
  let messagesAnalyzed = 0;
  let styleUpdated = false;
  let selected = 0;
  let firstError: string | null = null;

  try {
    if (options.kind === "knowledge" || options.kind === "both") {
      const conversations = await selectConversations(limit);
      selected = conversations.length;

      for (const conversation of conversations) {
        try {
          const result = await learnOneConversation(
            conversation,
            jobId,
            model,
            settings.learning.minMessagesPerConversation,
          );
          processed += 1;
          knowledgeCreated += result.created;
          messagesAnalyzed += result.analyzed;
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          firstError ??= message;
          // Bitta suhbatdagi xato butun yugurishni to'xtatmaydi.
          await setConversationStatus(conversation.id, "failed", {
            learning_error: message.slice(0, 500),
            last_learning_job_id: jobId,
          });
        }
      }
    }

    if (options.kind === "style" || options.kind === "both") {
      const style = await recomputeStyleProfile({ actorId: options.actorId, jobId });
      styleUpdated = true;
      messagesAnalyzed += style.sampleMessageCount;
    }

    const status: LearningRunResult["status"] =
      failed === 0 ? "succeeded" : processed > 0 || styleUpdated ? "partial" : "failed";

    await finishJob(jobId, {
      status,
      selected_conversations: selected,
      processed_conversations: processed,
      failed_conversations: failed,
      knowledge_created: knowledgeCreated,
      messages_analyzed: messagesAnalyzed,
      error: firstError,
    });

    await logAudit({
      actorId: options.actorId,
      action: "sales.learning.run",
      entityType: "sales_learning_job",
      entityId: jobId,
      newValue: { kind: options.kind, processed, failed, knowledgeCreated, styleUpdated },
      severity: failed > 0 ? "warning" : "info",
    });

    return {
      jobId,
      status,
      totalConversations: totalConversations ?? 0,
      selectedConversations: selected,
      processedConversations: processed,
      failedConversations: failed,
      knowledgeCreated,
      messagesAnalyzed,
      styleUpdated,
      error: firstError,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJob(jobId, {
      status: "failed",
      selected_conversations: selected,
      processed_conversations: processed,
      failed_conversations: failed,
      knowledge_created: knowledgeCreated,
      messages_analyzed: messagesAnalyzed,
      error: message.slice(0, 1000),
    });
    return {
      jobId,
      status: "failed",
      totalConversations: totalConversations ?? 0,
      selectedConversations: selected,
      processedConversations: processed,
      failedConversations: failed,
      knowledgeCreated,
      messagesAnalyzed,
      styleUpdated,
      error: message,
    };
  }
}
