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
import { getSalesSettings, saveSalesSetting } from "@/lib/sales/settings";
import { ROLLOUT_MODES, ROLLOUT_MODE_LABELS } from "@/lib/sales/flow/rollout";
import { SALES_ALLOWED_UPDATES, setSalesWebhook } from "@/lib/sales/telegram-sales-api";
import { getSiteUrl } from "@/lib/site-url";
import { parseRecencyBuckets } from "@/lib/sales/recency";
import { redactPii, isRedacted } from "@/lib/sales/redact";
import { LEARNING_JOB_KINDS, KNOWLEDGE_CATEGORIES } from "@/lib/sales/types";
import {
  activateStyleProfile,
  advanceMiningRun,
  startMiningRun,
  type RunKind,
  type RunStatus,
} from "@/lib/sales/mining/learning-run";
import { FACT_KINDS } from "@/lib/sales/knowledge-validity";

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
  // 2-faza sahifalari
  "/ai-sotuv/savollar",
  "/ai-sotuv/aql",
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

/* --------------------------- webhook qayta ro'yxat ----------------------- */

/**
 * Sotuv boti webhook'ini QAYTA ro'yxatdan o'tkazadi.
 *
 * NEGA KERAK: `allowed_updates` ro'yxati Telegram tomonida saqlanadi
 * va u FAQAT `setWebhook` chaqirilganda yangilanadi. Kodga yangi
 * update turi qo'shilgani bilan Telegram uni yubormaydi.
 *
 * Amalda bu shunday ko'rinardi: moderator sotuv botiga yozadi, bot
 * javob bermaydi, va hech qayerda xato ham chiqmaydi — chunki
 * update umuman kelmaydi. Shuning uchun bu tugma aniq va ko'rinadigan
 * joyda turadi.
 *
 * `drop_pending_updates` ISHLATILMAYDI: kutib turgan mijoz
 * xabarlarini o'chirib yuborardi.
 */
export async function refreshSalesWebhookAction(): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const url = `${getSiteUrl().replace(/\/+$/, "")}/api/telegram-sales/webhook`;
  try {
    const result = await setSalesWebhook(url);
    if (!result.ok) {
      return { ok: false, error: result.description ?? "Telegram rad etdi" };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Ro‘yxatdan o‘tmadi" };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "sales.webhook.refresh",
    entityType: "sales_settings",
    entityId: "webhook",
    newValue: { allowedUpdates: [...SALES_ALLOWED_UPDATES] },
  });

  revalidateSales();
  return {
    ok: true,
    message: `Webhook yangilandi (${SALES_ALLOWED_UPDATES.length} ta update turi).`,
  };
}

/* ------------------------ bilim bo'shliqlari ----------------------------- */

const answerGapSchema = z.object({
  gapId: z.string().uuid(),
  answer: z.string().trim().min(10, "Javob juda qisqa").max(4000),
});

/**
 * Javobsiz savolga javob yozish (25-band).
 *
 * Javob TASDIQLANGAN bilim sifatida kiritiladi va retrieval uni
 * darhol ishlata boshlaydi — shuning uchun bu yerga faqat odam
 * yozgan matn tushadi. Model taxmini hech qachon avtomatik
 * tasdiqlanmaydi.
 */
export async function answerKnowledgeGapAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const parsed = answerGapSchema.safeParse({
    gapId: formData.get("gapId"),
    answer: formData.get("answer"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  const admin = createSupabaseAdminClient();
  const { data: gap } = await admin
    .from("sales_knowledge_gaps")
    .select("id, question, status, kind, classification")
    .eq("id", parsed.data.gapId)
    .maybeSingle();

  if (!gap) return { ok: false, error: "Savol topilmadi." };
  if (gap.status === "answered") return { ok: false, error: "Bu savolga allaqachon javob berilgan." };

  /*
   * SHAXSIY JAVOB GLOBAL BILIMGA AYLANMAYDI (8-band).
   *
   * "Bo'ldimi?" savoliga "Ha, maqolangiz tayyor" deb javob
   * yozilsa va u bilim bazasiga tushsa, KEYINGI mijoz ham
   * shu javobni olardi — maqolasi tayyor bo'lmasa ham.
   *
   * Taqiq KODDA turadi, faqat interfeysda emas: tugmani
   * yashirish yetarli emas, chunki amal to'g'ridan-to'g'ri
   * chaqirilishi mumkin.
   */
  if (gap.kind === "case") {
    return {
      ok: false,
      error:
        "Bu shaxsiy holat savoli — javobi aynan shu mijozga tegishli. " +
        "Uni bilim bazasiga qo‘shib bo‘lmaydi: keyingi mijoz ham shu javobni olardi. " +
        "«Odam kerak» bo‘limidan holatni yoping.",
    };
  }

  // Qo'lda yozilgan javob ham redaksiyadan o'tadi: admin xom
  // yozishmadan telefon yoki karta raqamini nusxalab qo'yishi mumkin.
  const answer = redactPii(parsed.data.answer).text;
  if (!isRedacted(answer)) {
    return { ok: false, error: "Matnda shaxsiy ma’lumot qoldi — saqlanmadi." };
  }

  const { data: created, error } = await admin
    .from("sales_knowledge")
    .insert({
      // 'faq' — haqiqiy kategoriya. Ilgari bu yerda 'other' turgan edi
      // va u CHECK cheklovidan o'tmasdi: javob saqlanmasdi.
      category: "faq",
      question: gap.question as string,
      answer,
      tags: [],
      confidence: 1.0,
      status: "approved",
      source_type: "manual",
      // Eng yuqori ustunlik: bu savol mijozlardan kelgan va javobi
      // ataylab yozilgan.
      priority: 90,
      source_conversation_id: null,
      dedupe_key: `gap:${parsed.data.gapId}`,
      created_by: ctx.userId,
      updated_by: ctx.userId,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  await admin
    .from("sales_knowledge_gaps")
    .update({
      status: "answered",
      answer,
      answered_by: ctx.userId,
      answered_at: new Date().toISOString(),
      knowledge_id: created?.id ?? null,
    })
    .eq("id", parsed.data.gapId);

  await logAudit({
    actorId: ctx.userId,
    action: "sales.knowledge_gap.answered",
    entityType: "sales_knowledge_gaps",
    entityId: parsed.data.gapId,
    newValue: { knowledgeId: created?.id ?? null },
  });

  revalidateSales();
  return { ok: true, message: "Javob bilim bazasiga qo‘shildi." };
}

/** Savolni yopish — javob yozmasdan. Bilim bazasiga hech narsa tushmaydi. */
export async function ignoreKnowledgeGapAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");
  const gapId = String(formData.get("gapId") ?? "");
  if (!z.string().uuid().safeParse(gapId).success) {
    return { ok: false, error: "Noto‘g‘ri identifikator" };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sales_knowledge_gaps")
    .update({ status: "ignored", answered_by: ctx.userId, answered_at: new Date().toISOString() })
    .eq("id", gapId);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "sales.knowledge_gap.ignored",
    entityType: "sales_knowledge_gaps",
    entityId: gapId,
  });

  revalidateSales();
  return { ok: true, message: "Savol yopildi." };
}

/* ------------------------- chiqarish bosqichi ---------------------------- */

const rolloutSchema = z.object({
  mode: z.enum(ROLLOUT_MODES),
  allowlistChatIds: z.array(z.number().int()).max(500),
  percentage: z.number().int().min(0).max(100),
});

/**
 * Chiqarish bosqichini o'zgartirish (28-band).
 *
 * OFF dan to'g'ridan-to'g'ri FULL ga sakrash — eng qimmat xato turi:
 * noto'g'ri javob bir vaqtning o'zida yuzlab odamga ketadi va uni
 * qaytarib bo'lmaydi. Shuning uchun har o'zgarish audit'ga yoziladi
 * va qamrov kengayishi `warning` darajasida belgilanadi.
 */
export async function saveSalesRolloutAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  // Chat id'lar matn maydonida, har qatorda bittadan yoki vergul bilan.
  const rawIds = String(formData.get("allowlistChatIds") ?? "");
  const allowlistChatIds = rawIds
    .split(/[\s,]+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value !== 0);

  const parsed = rolloutSchema.safeParse({
    mode: String(formData.get("mode") ?? "off"),
    allowlistChatIds,
    percentage: Number(formData.get("percentage") ?? 0),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  const previous = await getSalesSettings();

  try {
    await saveSalesSetting("rollout", parsed.data, ctx.userId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Saqlanmadi." };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "sales.settings.rollout",
    entityType: "sales_settings",
    entityId: "rollout",
    oldValue: previous.rollout,
    newValue: parsed.data,
    // Qamrov kengayishi — diqqat talab qiladigan o'zgarish.
    severity: parsed.data.mode === "full" || parsed.data.mode === "percentage" ? "warning" : "info",
  });

  revalidateSales();

  /*
   * JIM QOLISH — ENG CHALG'ITUVCHI NOSOZLIK.
   *
   * "Tanlangan chatlar" rejimi ro'yxat bo'sh bo'lsa ham
   * muvaffaqiyatli saqlanadi va bot HECH KIMGA javob bermaydi.
   * Admin esa "yoqdim" deb o'ylab yuradi va nima uchun
   * ishlamayotganini topa olmaydi — xato hech qayerda
   * chiqmaydi.
   *
   * Saqlashni rad etmaymiz: ro'yxatni keyin to'ldirish
   * mumkin. Lekin oqibatni OCHIQ aytamiz.
   */
  if (parsed.data.mode === "allowlist" && parsed.data.allowlistChatIds.length === 0) {
    return {
      ok: true,
      message:
        "Saqlandi, lekin ro'yxat BO'SH — bot hozir hech kimga javob bermaydi. " +
        "Suhbat sahifasidagi «Ro'yxatga qo'shish» tugmasi orqali chat qo'shing.",
    };
  }

  if (parsed.data.mode === "percentage" && parsed.data.percentage === 0) {
    return {
      ok: true,
      message: "Saqlandi, lekin foiz 0 — bot hozir hech kimga javob bermaydi.",
    };
  }

  return { ok: true, message: `Chiqarish rejimi: ${ROLLOUT_MODE_LABELS[parsed.data.mode]}` };
}

const allowlistAddSchema = z.object({
  chatId: z.number().int().refine((v) => v !== 0, "Chat id noto'g'ri."),
});

/**
 * Suhbatni "tanlangan chatlar" ro'yxatiga qo'shadi.
 *
 * NEGA ALOHIDA AMAL: chat id faqat suhbat sahifasida
 * ko'rinardi va uni sozlamalardagi matn maydoniga QO'LDA
 * ko'chirish kerak edi. Bir raqamni ikki sahifa orasida
 * ko'chirish — xato qilish uchun ideal joy, va xato jimgina
 * "bot javob bermaydi" ga aylanardi.
 *
 * IDEMPOTENT: allaqachon ro'yxatda bo'lsa dublikat
 * qo'shilmaydi.
 */
export async function addChatToAllowlistAction(chatId: number): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const parsed = allowlistAddSchema.safeParse({ chatId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Chat id noto'g'ri." };
  }

  const settings = await getSalesSettings();
  const current = settings.rollout.allowlistChatIds;

  if (current.includes(parsed.data.chatId)) {
    return { ok: true, message: "Bu chat allaqachon ro'yxatda." };
  }

  const next = {
    ...settings.rollout,
    allowlistChatIds: [...current, parsed.data.chatId],
  };

  try {
    await saveSalesSetting("rollout", next, ctx.userId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Saqlanmadi." };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "sales.settings.allowlist_add",
    entityType: "sales_settings",
    entityId: "rollout",
    oldValue: { count: current.length },
    newValue: { count: next.allowlistChatIds.length },
    severity: "info",
  });

  revalidateSales();

  /*
   * Rejim "tanlangan chatlar" bo'lmasa, qo'shish o'z-o'zidan
   * hech nima bermaydi. Buni ham ochiq aytamiz — aks holda
   * admin "qo'shdim, nega ishlamaydi?" deb qolardi.
   */
  const note =
    settings.rollout.mode === "allowlist"
      ? ""
      : ` Diqqat: hozirgi rejim «${ROLLOUT_MODE_LABELS[settings.rollout.mode]}» — ro'yxat faqat «Tanlangan chatlar» rejimida ishlaydi.`;

  return {
    ok: true,
    message: `Ro'yxatga qo'shildi (${next.allowlistChatIds.length} ta).${note}`,
  };
}

/**
 * FAVQULODDA TO'XTATISH (23-band).
 *
 * Bitta bosish — yangi avtomatik xabarlar to'xtaydi. Ishlar,
 * ma'lumotlar va rollout sozlamasi BUZILMAYDI: faqat `autoReplyEnabled`
 * o'chadi. Shuning uchun qayta yoqishda qamrovni eslab qolish kerak
 * emas — u joyida turadi.
 */
export async function stopSalesAiAction(): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const previous = await getSalesSettings();
  try {
    await saveSalesSetting(
      "flow",
      { ...previous.flow, autoReplyEnabled: false },
      ctx.userId,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "To‘xtatilmadi." };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "sales.emergency_stop",
    entityType: "sales_settings",
    entityId: "flow",
    oldValue: { autoReplyEnabled: previous.flow.autoReplyEnabled },
    newValue: { autoReplyEnabled: false },
    severity: "critical",
  });

  revalidateSales();
  return { ok: true, message: "AI sotuv to‘xtatildi. Yangi avtomatik xabar yuborilmaydi." };
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

/* ======================================================================== */
/*  2-FAZA — SOTUV AQLI (qazish, FAQ, e'tiroz, ziddiyat, uslub)             */
/* ======================================================================== */

export interface MiningRunActionResult extends SalesActionResult {
  runId?: string;
  status?: RunStatus;
}

/**
 * Qazish yugurishini BOSHLAYDI.
 *
 * ADMIN BOSHLAYDI, SAHIFA YUKLASH EMAS (7-band): butun tarixni
 * har sahifa ochilganda qayta o'qish sekin, qimmat va natijani
 * beqaror qiladi.
 */
export async function startMiningRunAction(
  formData: FormData,
): Promise<MiningRunActionResult> {
  const ctx = await requirePermission("sales.learn");

  const kindRaw = String(formData.get("kind") ?? "incremental");
  const kind: RunKind = kindRaw === "full_rebuild" ? "full_rebuild" : "incremental";

  const started = await startMiningRun({ kind, actorId: ctx.userId });
  if (!started.ok || !started.runId) {
    return { ok: false, error: started.error ?? "Yugurishni boshlab bo‘lmadi." };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "sales.mining.start",
    entityType: "sales_mining_run",
    entityId: started.runId,
    metadata: { kind },
  });

  // Birinchi qadam darhol bajariladi — admin natijani kuta boshlaydi.
  const advanced = await advanceMiningRun(started.runId);
  revalidateSales();
  return { ok: advanced.ok, runId: started.runId, status: advanced.status, error: advanced.error };
}

/** Yugurishni davom ettiradi (vaqt byudjeti tugagan bo'lsa). */
export async function advanceMiningRunAction(
  formData: FormData,
): Promise<MiningRunActionResult> {
  await requirePermission("sales.learn");

  const runId = String(formData.get("runId") ?? "");
  if (!z.string().uuid().safeParse(runId).success) {
    return { ok: false, error: "Yugurish identifikatori noto‘g‘ri." };
  }

  const advanced = await advanceMiningRun(runId);
  if (advanced.status === "completed" || advanced.status === "failed") revalidateSales();
  return { ok: advanced.ok, runId, status: advanced.status, error: advanced.error };
}

/** Yugurishni bekor qiladi — yarim natija saqlanadi, qamrov `partial`. */
export async function cancelMiningRunAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.learn");
  const runId = String(formData.get("runId") ?? "");
  if (!z.string().uuid().safeParse(runId).success) {
    return { ok: false, error: "Yugurish identifikatori noto‘g‘ri." };
  }

  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_mining_runs")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
      coverage_status: "partial",
      coverage_note: "Admin bekor qildi — natijalar to‘liq emas.",
    })
    .eq("id", runId)
    .in("status", ["queued", "running"]);

  await logAudit({
    actorId: ctx.userId,
    action: "sales.mining.cancel",
    entityType: "sales_mining_run",
    entityId: runId,
  });

  revalidateSales();
  return { ok: true, message: "Yugurish bekor qilindi." };
}

/**
 * FAQ qoralamasini tasdiqlash / rad etish.
 *
 * TASDIQLASH JAVOBNI TALAB QILADI: javobsiz FAQ tasdiqlangan
 * bo'lsa, bot uni topadi va bo'sh javob yuborardi (14-band).
 */
export async function reviewFaqAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const answer = String(formData.get("answer") ?? "").trim();

  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "FAQ identifikatori noto‘g‘ri." };
  }
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "Noma’lum qaror." };
  }

  const admin = createSupabaseAdminClient();

  if (decision === "reject") {
    await admin
      .from("sales_faq")
      .update({ status: "rejected", approved: false })
      .eq("id", id);
    await logAudit({
      actorId: ctx.userId,
      action: "sales.faq.reject",
      entityType: "sales_faq",
      entityId: id,
    });
    revalidateSales();
    return { ok: true, message: "FAQ rad etildi." };
  }

  if (answer === "") {
    return {
      ok: false,
      error: "Javobsiz FAQ tasdiqlanmaydi — mijozga aytiladigan javobni yozing.",
    };
  }

  // Javob mijozga ketadi, shuning uchun u ham redaksiyadan o'tadi.
  const redacted = redactPii(answer);
  if (!isRedacted(redacted.text)) {
    return { ok: false, error: "Javobda shaxsiy ma’lumot qoldi — tekshiring." };
  }

  await admin
    .from("sales_faq")
    .update({
      status: "approved",
      approved: true,
      answer_status: "approved_answer",
      canonical_answer: redacted.text,
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);

  await logAudit({
    actorId: ctx.userId,
    action: "sales.faq.approve",
    entityType: "sales_faq",
    entityId: id,
    severity: "warning",
  });

  revalidateSales();
  return { ok: true, message: "FAQ tasdiqlandi." };
}

/**
 * Bilim ziddiyatini HAL QILADI.
 *
 * G'olib yozuv tanlanadi; qolganlari `superseded` bo'ladi va
 * javobda ishlatilmaydi. Hech narsa O'CHIRILMAYDI (10-band).
 */
export async function resolveKnowledgeConflictAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const conflictId = String(formData.get("conflictId") ?? "");
  const winnerId = String(formData.get("winnerId") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  if (!z.string().uuid().safeParse(conflictId).success) {
    return { ok: false, error: "Ziddiyat identifikatori noto‘g‘ri." };
  }
  if (!z.string().uuid().safeParse(winnerId).success) {
    return { ok: false, error: "To‘g‘ri javobni tanlang." };
  }

  const admin = createSupabaseAdminClient();
  const { data: conflict } = await admin
    .from("sales_knowledge_conflicts")
    .select("id, members, topic_key")
    .eq("id", conflictId)
    .maybeSingle();

  if (!conflict) return { ok: false, error: "Ziddiyat topilmadi." };

  const memberIds = Array.isArray(conflict.members)
    ? (conflict.members as Array<{ id?: unknown }>)
        .map((member) => (typeof member.id === "string" ? member.id : null))
        .filter((value): value is string => value != null)
    : [];

  if (!memberIds.includes(winnerId)) {
    return { ok: false, error: "Tanlangan javob shu ziddiyatga tegishli emas." };
  }

  const now = new Date().toISOString();
  const losers = memberIds.filter((memberId) => memberId !== winnerId);

  // G'olib yana ishlatiladigan bo'ladi.
  await admin
    .from("sales_knowledge")
    .update({ conflict_status: "resolved", conflict_group: null })
    .eq("id", winnerId);

  // Qolganlari O'CHIRILMAYDI — `superseded` bo'ladi va tarixda qoladi.
  if (losers.length > 0) {
    await admin
      .from("sales_knowledge")
      .update({
        conflict_status: "resolved",
        superseded_at: now,
        supersedes_id: winnerId,
      })
      .in("id", losers);
  }

  await admin
    .from("sales_knowledge_conflicts")
    .update({
      status: "resolved",
      winner_knowledge_id: winnerId,
      resolution_note: note || null,
      resolved_by: ctx.userId,
      resolved_at: now,
    })
    .eq("id", conflictId);

  await logAudit({
    actorId: ctx.userId,
    action: "sales.knowledge.conflict.resolve",
    entityType: "sales_knowledge_conflict",
    entityId: conflictId,
    newValue: { winnerId, superseded: losers.length },
    severity: "warning",
  });

  revalidateSales();
  return { ok: true, message: `Ziddiyat hal qilindi, ${losers.length} ta yozuv almashtirildi.` };
}

/**
 * Bilimning TURINI va amal qilish muddatini belgilaydi.
 *
 * Bu mijozga nima aytilishini bevosita o'zgartiradi, shuning uchun
 * `sales.manage` va audit yozuvi bilan.
 */
export async function classifyKnowledgeAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const id = String(formData.get("id") ?? "");
  const factKind = String(formData.get("factKind") ?? "");
  const validUntilRaw = String(formData.get("validUntil") ?? "").trim();

  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Bilim identifikatori noto‘g‘ri." };
  }
  if (!(FACT_KINDS as readonly string[]).includes(factKind)) {
    return { ok: false, error: "Noma’lum bilim turi." };
  }

  let validUntil: string | null = null;
  if (validUntilRaw !== "") {
    const parsed = Date.parse(validUntilRaw);
    if (!Number.isFinite(parsed)) return { ok: false, error: "Tugash sanasi noto‘g‘ri." };
    validUntil = new Date(parsed).toISOString();
  }

  /*
   * MUDDATLI TAKLIF SANASIZ QABUL QILINMAYDI.
   *
   * Aynan shu tekshiruv "chegirma faqat bugun" ning bir yil
   * davomida aytilishiga yo'l qo'ymaydi.
   */
  if ((factKind === "temporary_offer" || factKind === "customer_specific_offer") && !validUntil) {
    return {
      ok: false,
      error: "Muddatli taklif uchun tugash sanasi majburiy — usiz javobda ishlatilmaydi.",
    };
  }

  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_knowledge")
    .update({
      fact_kind: factKind,
      valid_until: validUntil,
      never_expires: factKind === "permanent_fact" && !validUntil,
    })
    .eq("id", id);

  await logAudit({
    actorId: ctx.userId,
    action: "sales.knowledge.classify",
    entityType: "sales_knowledge",
    entityId: id,
    newValue: { factKind, validUntil },
    severity: "warning",
  });

  revalidateSales();
  return { ok: true, message: "Bilim turi saqlandi." };
}

/**
 * Uslub QORALAMASINI faollashtiradi.
 *
 * ALOHIDA, ODAM QILADIGAN QADAM (22-band). Auditda ko'rilgan
 * "hi" li profil aynan avtomatik faollashuv tufayli jonli botga
 * tushgan edi.
 */
export async function activateStyleProfileAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const profileId = String(formData.get("profileId") ?? "");
  if (!z.string().uuid().safeParse(profileId).success) {
    return { ok: false, error: "Profil identifikatori noto‘g‘ri." };
  }

  const result = await activateStyleProfile({ profileId, actorId: ctx.userId });
  if (!result.ok) return { ok: false, error: result.error };

  revalidateSales();
  return { ok: true, message: "Uslub profili faollashtirildi." };
}

/** E'tiroz strategiyasini tasdiqlaydi. */
export async function reviewObjectionAction(formData: FormData): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "E’tiroz identifikatori noto‘g‘ri." };
  }
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "Noma’lum qaror." };
  }

  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_objections")
    .update({
      status: decision === "approve" ? "approved" : "rejected",
      approved_by: decision === "approve" ? ctx.userId : null,
      approved_at: decision === "approve" ? new Date().toISOString() : null,
    })
    .eq("id", id);

  await logAudit({
    actorId: ctx.userId,
    action: `sales.objection.${decision}`,
    entityType: "sales_objection",
    entityId: id,
  });

  revalidateSales();
  return { ok: true, message: decision === "approve" ? "Strategiya tasdiqlandi." : "Rad etildi." };
}

/* --------------------- javobsiz savollarni tozalash ---------------------- */

/**
 * Tarixiy navbatni tasniflab, savol bo'lmaganlarini arxivlaydi.
 *
 * O'CHIRMAYDI. Har yozuv joyida qoladi, faqat holati
 * `archived` ga o'tadi va eskisi `previous_status` da saqlanadi
 * (38-band).
 */
export async function runGapCleanupAction(): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const { reclassifyKnowledgeGaps } = await import("@/lib/sales/gaps/reclassify-service");
  const result = await reclassifyKnowledgeGaps({ actorId: ctx.userId, note: "panel" });

  await logAudit({
    actorId: ctx.userId,
    action: "sales.knowledge_gap.cleanup",
    entityType: "sales_knowledge_gaps",
    entityId: result.runId ?? "cleanup",
    newValue: { scanned: result.scanned, archived: result.archived, counts: result.counts },
    severity: "warning",
  });

  revalidateSales();

  if (result.error) return { ok: false, error: result.error };
  if (result.scanned === 0) {
    return { ok: true, message: "Tasniflanmagan yozuv qolmadi — navbat toza." };
  }

  return {
    ok: true,
    message:
      `${result.scanned} ta yozuv tasniflandi, ${result.archived} tasi arxivga o‘tdi. ` +
      `Haqiqiy savol: ${result.counts.real_knowledge_gap}, shaxsiy holat: ${result.counts.case_specific}.`,
  };
}

/** Tozalashni qaytaradi — arxivlangan yozuvlar navbatga qaytadi. */
export async function undoGapCleanupAction(): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const { undoReclassification } = await import("@/lib/sales/gaps/reclassify-service");
  const { restored } = await undoReclassification();

  await logAudit({
    actorId: ctx.userId,
    action: "sales.knowledge_gap.cleanup_undo",
    entityType: "sales_knowledge_gaps",
    entityId: "cleanup",
    newValue: { restored },
    severity: "warning",
  });

  revalidateSales();
  return { ok: true, message: `${restored} ta yozuv navbatga qaytarildi.` };
}

/* ---------------------------- odam topshiriqlari -------------------------- */

const resolveEscalationSchema = z.object({
  escalationId: z.string().uuid(),
  resolution: z.string().trim().max(2000).optional(),
  dismiss: z.boolean().optional(),
});

/** Topshiriqni yopadi. Bilim bazasiga HECH NARSA tushmaydi. */
export async function resolveEscalationAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const ctx = await requirePermission("sales.manage");

  const parsed = resolveEscalationSchema.safeParse({
    escalationId: formData.get("escalationId"),
    resolution: formData.get("resolution") ?? undefined,
    dismiss: formData.get("dismiss") === "1",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sales_case_escalations")
    .update({
      status: parsed.data.dismiss ? "dismissed" : "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.userId,
      resolution: parsed.data.resolution?.slice(0, 2000) ?? null,
    })
    .eq("id", parsed.data.escalationId)
    .eq("status", "open");

  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: parsed.data.dismiss
      ? "sales.escalation.dismissed"
      : "sales.escalation.resolved",
    entityType: "sales_case_escalations",
    entityId: parsed.data.escalationId,
  });

  revalidateSales();
  return { ok: true, message: parsed.data.dismiss ? "Yopildi." : "Hal qilindi." };
}
