"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { runLearning } from "@/lib/sales/learning";
import {
  advanceDeepLearning,
  startDeepLearning,
  type DeepLearningSnapshot,
} from "@/lib/sales/deep-learning";
import { generateTestReply, type TestChatResult } from "@/lib/sales/test-chat";
import { confirmPayment, setHumanTakeover } from "@/lib/sales/flow/engine";
import { simulateConversation, type SimulationRun } from "@/lib/sales/flow/simulate";
import { saveSalesSetting } from "@/lib/sales/settings";
import { parseRecencyBuckets } from "@/lib/sales/recency";
import { redactPii, isRedacted } from "@/lib/sales/redact";
import { LEARNING_JOB_KINDS, KNOWLEDGE_CATEGORIES } from "@/lib/sales/types";

/**
 * AI Sotuv server action'lari.
 *
 * 0.1 DA MIJOZGA YOZADIGAN ACTION YO'Q. Bu fayldagi hamma narsa panel
 * ichida qoladi: o'rganishni ishga tushirish, bilimni ko'rib chiqish va
 * sozlamani saqlash.
 */

export interface SalesActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const SALES_PATHS = [
  "/ai-sotuv",
  "/ai-sotuv/suhbatlar",
  "/ai-sotuv/organish",
  "/ai-sotuv/javoblar",
  "/ai-sotuv/sinov",
  "/ai-sotuv/knowledge",
  "/ai-sotuv/uslub",
  "/ai-sotuv/sozlamalar",
];

function revalidateSales(): void {
  for (const path of SALES_PATHS) revalidatePath(path);
}

/* ------------------------------ o'rganish ------------------------------- */

export async function runLearningAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.learn");

  const kindRaw = String(formData.get("kind") ?? "both");
  const kind = (LEARNING_JOB_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as (typeof LEARNING_JOB_KINDS)[number])
    : "both";

  const limitRaw = Number(formData.get("limit") ?? 0);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, limitRaw) : undefined;

  try {
    const result = await runLearning({ actorId: ctx.userId, kind, limit });
    revalidateSales();

    if (result.status === "failed") {
      return { ok: false, error: result.error ?? "O‘rganish amalga oshmadi." };
    }
    return {
      ok: true,
      message:
        `${result.processedConversations} ta suhbat o‘rganildi, ` +
        `${result.knowledgeCreated} ta yangi bilim qo‘shildi` +
        (result.failedConversations > 0
          ? `, ${result.failedConversations} tasida xatolik.`
          : "."),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Kutilmagan xato." };
  }
}

/* --------------------------- bilimni ko'rib chiqish ---------------------- */

const reviewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["approved", "rejected", "draft"]),
  note: z.string().max(500).optional().or(z.literal("")),
});

export async function reviewKnowledgeAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const parsed = reviewSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sales_knowledge")
    .update({
      status: parsed.data.status,
      review_note: parsed.data.note?.trim() || null,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: `sales.knowledge.${parsed.data.status}`,
    entityType: "sales_knowledge",
    entityId: parsed.data.id,
    newValue: { status: parsed.data.status },
  });

  revalidateSales();
  return { ok: true };
}

const editSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(KNOWLEDGE_CATEGORIES),
  question: z.string().max(500).optional().or(z.literal("")),
  answer: z.string().trim().min(1, "Javob bo‘sh bo‘lmasin").max(2000),
});

export async function updateKnowledgeAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const parsed = editSchema.safeParse({
    id: formData.get("id"),
    category: formData.get("category"),
    question: formData.get("question") ?? "",
    answer: formData.get("answer"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  // Qo'lda tahrirlangan matn ham redaksiyadan o'tadi: admin xom
  // yozishmadan telefon raqamini nusxalab qo'yishi mumkin.
  const answer = redactPii(parsed.data.answer).text;
  const question = parsed.data.question?.trim()
    ? redactPii(parsed.data.question).text
    : null;

  if (!isRedacted(answer) || (question != null && !isRedacted(question))) {
    return { ok: false, error: "Matnda shaxsiy ma’lumot qoldi — saqlanmadi." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sales_knowledge")
    .update({
      category: parsed.data.category,
      question,
      answer,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "sales.knowledge.edit",
    entityType: "sales_knowledge",
    entityId: parsed.data.id,
    newValue: { category: parsed.data.category },
  });

  revalidateSales();
  return { ok: true };
}

/* ------------------------------- sozlamalar ----------------------------- */

export async function saveRecencyBucketsAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const raw = String(formData.get("buckets") ?? "");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "JSON o‘qib bo‘lmadi." };
  }

  // `parseRecencyBuckets` nosoz qiymatda standart jadvalni qaytaradi —
  // shuning uchun natija kirish bilan solishtiriladi va admin jimgina
  // "saqlandi" degan xabarni ko'rib qolmaydi.
  const parsed = parseRecencyBuckets(value);
  const requested = Array.isArray(value) ? value.length : 0;
  if (requested !== parsed.length) {
    return {
      ok: false,
      error:
        "Og‘irliklar noto‘g‘ri: har element {\"maxAgeDays\": son yoki null, " +
        "\"weight\": 0–1} shaklida bo‘lsin.",
    };
  }

  try {
    await saveSalesSetting("recency_buckets", parsed, ctx.userId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Saqlanmadi." };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "sales.settings.recency",
    entityType: "sales_settings",
    entityId: "recency_buckets",
    newValue: parsed,
  });

  revalidateSales();
  return { ok: true, message: "Og‘irliklar saqlandi." };
}

const learningSettingsSchema = z.object({
  batchSize: z.coerce.number().int().min(1).max(200),
  minMessagesPerConversation: z.coerce.number().int().min(1).max(100),
});

export async function saveLearningSettingsAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const parsed = learningSettingsSchema.safeParse({
    batchSize: formData.get("batchSize"),
    minMessagesPerConversation: formData.get("minMessagesPerConversation"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  try {
    await saveSalesSetting("learning", parsed.data, ctx.userId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Saqlanmadi." };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "sales.settings.learning",
    entityType: "sales_settings",
    entityId: "learning",
    newValue: parsed.data,
  });

  revalidateSales();
  return { ok: true, message: "Sozlamalar saqlandi." };
}

/* ======================================================================== *
 * CHUQUR O'RGANISH
 *
 * Ikki bosqichli: `start` yugurishni ochadi va batch rejasini yozadi,
 * `advance` esa vaqt byudjeti doirasida batch'larni ishlaydi. Klient
 * tugagunicha `advance` ni qayta chaqiradi — shu sababli 500 ta suhbat
 * bitta serverless chaqiruviga sig'ishi shart emas va uzilish yugurishni
 * yo'qotmaydi.
 * ======================================================================== */

export interface DeepLearningActionResult extends SalesActionResult {
  snapshot?: DeepLearningSnapshot;
  jobId?: string;
}

export async function startDeepLearningAction(
  formData: FormData,
): Promise<DeepLearningActionResult> {
  const ctx = await requirePermission("sales.learn");

  const targetRaw = Number(formData.get("target") ?? 0);
  const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.min(2000, targetRaw) : undefined;
  const batchRaw = Number(formData.get("batchSize") ?? 0);
  const batchSize = Number.isFinite(batchRaw) && batchRaw > 0 ? Math.min(25, batchRaw) : undefined;

  try {
    const started = await startDeepLearning({ actorId: ctx.userId, target, batchSize });

    if (started.targetConversations === 0) {
      return {
        ok: false,
        error:
          "Bazada o‘rganiladigan suhbat yo‘q. Bot Telegram Business akkauntga " +
          "ulanib, yozishmalar yig‘ilgandan keyin qayta urinib ko‘ring.",
      };
    }

    const snapshot = await advanceDeepLearning({ jobId: started.jobId, actorId: ctx.userId });
    revalidateSales();
    return { ok: true, jobId: started.jobId, snapshot };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Kutilmagan xato." };
  }
}

export async function advanceDeepLearningAction(
  formData: FormData,
): Promise<DeepLearningActionResult> {
  const ctx = await requirePermission("sales.learn");

  const jobId = String(formData.get("jobId") ?? "");
  if (!z.string().uuid().safeParse(jobId).success) {
    return { ok: false, error: "Yugurish identifikatori noto‘g‘ri." };
  }

  try {
    const snapshot = await advanceDeepLearning({ jobId, actorId: ctx.userId });
    if (snapshot.finished) revalidateSales();
    return { ok: true, jobId, snapshot };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Kutilmagan xato." };
  }
}

/** Javob shablonini tasdiqlash / rad etish. */
export async function reviewResponsePatternAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const parsed = reviewSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    note: "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sales_response_patterns")
    .update({
      status: parsed.data.status,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: `sales.response_pattern.${parsed.data.status}`,
    entityType: "sales_response_patterns",
    entityId: parsed.data.id,
    newValue: { status: parsed.data.status },
  });

  revalidateSales();
  return { ok: true };
}

/* ======================================================================== *
 * SINOV CHAT
 *
 * Bu action HECH QANDAY outbound chaqiruv qilmaydi: javob faqat admin
 * brauzeriga qaytadi. Telegram transporti import ham qilinmagan.
 *
 * Ruxsat `sales.learn` — chunki har xabar pullik AI chaqiruvi qiladi.
 * Ko'rish (`sales.view`) buning uchun yetarli emas.
 * ======================================================================== */

const testChatTurnSchema = z.object({
  role: z.enum(["customer", "assistant"]),
  text: z.string().min(1).max(2000),
});

const testChatSchema = z.object({
  message: z.string().trim().min(1, "Xabar bo‘sh bo‘lmasin").max(2000),
  history: z.array(testChatTurnSchema).max(20),
});

export interface TestChatActionResult extends SalesActionResult {
  result?: TestChatResult;
}

export async function sendTestChatMessageAction(
  formData: FormData,
): Promise<TestChatActionResult> {
  const ctx = await requirePermission("sales.learn");

  let history: unknown = [];
  try {
    history = JSON.parse(String(formData.get("history") ?? "[]"));
  } catch {
    return { ok: false, error: "Suhbat konteksti o‘qib bo‘lmadi." };
  }

  const parsed = testChatSchema.safeParse({
    message: formData.get("message"),
    history,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  try {
    const result = await generateTestReply({
      message: parsed.data.message,
      history: parsed.data.history,
      actorId: ctx.userId,
    });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Kutilmagan xato." };
  }
}

/* ======================================================================== *
 * QO'LDA BILIM KIRITISH
 *
 * Manba suhbat MAJBURIY EMAS: admin o'zi yozgan bilimning manbasi —
 * adminning o'zi. AI ajratgan bilim uchun esa manba sharti bazada
 * saqlanib qoladi (CHECK sales_knowledge_source_required).
 * ======================================================================== */

const manualKnowledgeSchema = z.object({
  category: z.enum(KNOWLEDGE_CATEGORIES),
  question: z.string().max(500).optional().or(z.literal("")),
  answer: z.string().trim().min(1, "Bilim matni bo‘sh bo‘lmasin").max(4000),
  tags: z.string().max(300).optional().or(z.literal("")),
  priority: z.coerce.number().int().min(0).max(1000),
  status: z.enum(["draft", "approved"]),
});

export async function createManualKnowledgeAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const parsed = manualKnowledgeSchema.safeParse({
    category: formData.get("category"),
    question: formData.get("question") ?? "",
    answer: formData.get("answer"),
    tags: formData.get("tags") ?? "",
    priority: formData.get("priority") ?? 100,
    status: formData.get("status") ?? "draft",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  // Qo'lda yozilgan matn ham redaksiyadan o'tadi: admin xom
  // yozishmadan telefon yoki karta raqamini nusxalab qo'yishi mumkin.
  const answer = redactPii(parsed.data.answer).text;
  const question = parsed.data.question?.trim() ? redactPii(parsed.data.question).text : null;
  if (!isRedacted(answer) || (question != null && !isRedacted(question))) {
    return { ok: false, error: "Matnda shaxsiy ma’lumot qoldi — saqlanmadi." };
  }

  const tags = (parsed.data.tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "")
    .slice(0, 10);

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("sales_knowledge").insert({
    category: parsed.data.category,
    question,
    answer,
    tags,
    confidence: 1.0,
    status: parsed.data.status,
    source_type: "manual",
    priority: parsed.data.priority,
    // Manba suhbat YO'Q — bu ataylab, migratsiyadagi CHECK shunga ruxsat beradi.
    source_conversation_id: null,
    dedupe_key: `manual:${randomUUID()}`,
    created_by: ctx.userId,
    updated_by: ctx.userId,
    reviewed_by: parsed.data.status === "approved" ? ctx.userId : null,
    reviewed_at: parsed.data.status === "approved" ? new Date().toISOString() : null,
  });

  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "sales.knowledge.manual_create",
    entityType: "sales_knowledge",
    newValue: { category: parsed.data.category, status: parsed.data.status },
  });

  revalidateSales();
  return { ok: true, message: "Bilim qo‘shildi." };
}

export async function archiveKnowledgeAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Identifikator noto‘g‘ri." };
  }

  const admin = createSupabaseAdminClient();
  // O'CHIRILMAYDI, arxivlanadi: bu yozuv qaysi javobga asos bo'lganini
  // keyin ham tekshirish kerak bo'lishi mumkin.
  const { error } = await admin
    .from("sales_knowledge")
    .update({ archived_at: new Date().toISOString(), updated_by: ctx.userId, status: "rejected" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "sales.knowledge.archive",
    entityType: "sales_knowledge",
    entityId: id,
  });

  revalidateSales();
  return { ok: true };
}

/* ======================================================================== *
 * SOTUV OQIMI (0.2)
 * ======================================================================== */

export async function confirmPaymentAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");
  const conversationId = String(formData.get("conversationId") ?? "");
  if (!z.string().uuid().safeParse(conversationId).success) {
    return { ok: false, error: "Suhbat identifikatori noto‘g‘ri." };
  }

  const result = await confirmPayment({ conversationId, actorId: ctx.userId });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/ai-sotuv/suhbatlar/${conversationId}`);
  revalidateSales();
  return { ok: true, message: "To‘lov tasdiqlandi." };
}

export async function setHumanTakeoverAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");
  const conversationId = String(formData.get("conversationId") ?? "");
  if (!z.string().uuid().safeParse(conversationId).success) {
    return { ok: false, error: "Suhbat identifikatori noto‘g‘ri." };
  }
  const enabled = String(formData.get("enabled") ?? "") === "true";

  const result = await setHumanTakeover({ conversationId, enabled, actorId: ctx.userId });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/ai-sotuv/suhbatlar/${conversationId}`);
  return {
    ok: true,
    message: enabled ? "Suhbat inson nazoratiga o‘tdi." : "AI qayta yoqildi.",
  };
}

const flowSettingsSchema = z.object({
  autoReplyEnabled: z.boolean(),
  followupOfferReviewMinutes: z.coerce.number().int().min(1).max(1440),
  followupArticleDecisionMinutes: z.coerce.number().int().min(1).max(1440),
  followupLaterMinutes: z.coerce.number().int().min(1).max(10080),
});

export async function saveFlowSettingsAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const parsed = flowSettingsSchema.safeParse({
    autoReplyEnabled: formData.get("autoReplyEnabled") === "on",
    followupOfferReviewMinutes: formData.get("followupOfferReviewMinutes"),
    followupArticleDecisionMinutes: formData.get("followupArticleDecisionMinutes"),
    followupLaterMinutes: formData.get("followupLaterMinutes"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  try {
    await saveSalesSetting("flow", parsed.data, ctx.userId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Saqlanmadi." };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "sales.settings.flow",
    entityType: "sales_settings",
    entityId: "flow",
    newValue: parsed.data,
    // Avto-javobni yoqish — mijozlarga xabar ketishini boshlaydi.
    severity: parsed.data.autoReplyEnabled ? "warning" : "info",
  });

  revalidateSales();
  return { ok: true, message: "Sozlamalar saqlandi." };
}

/** Sinov: ssenariyni bazasiz va Telegramsiz o‘ynab ko‘rish. */
export async function simulateSalesFlowAction(
  formData: FormData,
): Promise<SalesActionResult & { run?: SimulationRun }> {
  await requirePermission("sales.view");

  let inputs: unknown;
  try {
    inputs = JSON.parse(String(formData.get("inputs") ?? "[]"));
  } catch {
    return { ok: false, error: "Ssenariy o‘qib bo‘lmadi." };
  }

  const parsed = z
    .array(z.object({ text: z.string().max(500), messageType: z.string().max(30).optional() }))
    .max(50)
    .safeParse(inputs);
  if (!parsed.success) return { ok: false, error: "Ssenariy shakli noto‘g‘ri." };

  // Sof funksiya: na baza, na Telegram, na AI.
  return { ok: true, run: simulateConversation(parsed.data) };
}
