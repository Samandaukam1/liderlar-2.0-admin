"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { runLearning } from "@/lib/sales/learning";
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
