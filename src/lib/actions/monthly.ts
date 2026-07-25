"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  buildTelegramMessage,
  buildUpdateLink,
  generateRawToken,
  hashToken,
} from "@/lib/tokens";
import type { MonthlyUpdateStatus } from "@/lib/types";

export interface TokenCreated {
  ok: boolean;
  error?: string;
  candidateName?: string;
  link?: string;
  telegramMessage?: string;
  expiresAt?: string;
}

const DEFAULT_TTL_DAYS = 14;

/** Creates a monthly-update token. The raw link is returned ONCE — only the
 *  SHA-256 hash is stored. Any previous active token is revoked. */
export async function createTokenAction(
  candidateId: string,
  ttlDays: number = DEFAULT_TTL_DAYS,
): Promise<TokenCreated> {
  const ctx = await requirePermission("tokens.manage");
  const admin = createSupabaseAdminClient();

  const { data: candidate } = await admin
    .from("candidates")
    .select("id, full_name")
    .eq("id", candidateId)
    .maybeSingle();
  if (!candidate) return { ok: false, error: "Nomzod topilmadi" };

  await admin
    .from("monthly_update_tokens")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("candidate_id", candidateId)
    .eq("status", "active");

  const raw = generateRawToken();
  const ttl = Math.min(Math.max(ttlDays, 1), 90);
  const expiresAt = new Date(Date.now() + ttl * 86400000).toISOString();

  const { error } = await admin.from("monthly_update_tokens").insert({
    candidate_id: candidateId,
    token_hash: hashToken(raw),
    status: "active",
    expires_at: expiresAt,
    created_by: ctx.userId,
  });
  if (error) return { ok: false, error: error.message };

  await admin
    .from("candidates")
    .update({ last_update_requested_at: new Date().toISOString() })
    .eq("id", candidateId);

  await logAudit({
    actorId: ctx.userId,
    action: "token.create",
    entityType: "monthly_update_token",
    entityId: candidateId,
    metadata: { ttl_days: ttl },
  });

  const link = buildUpdateLink(raw);
  revalidatePath("/monthly-links");
  return {
    ok: true,
    candidateName: candidate.full_name,
    link,
    telegramMessage: buildTelegramMessage(candidate.full_name, link),
    expiresAt,
  };
}

export interface BulkTokensResult {
  ok: boolean;
  error?: string;
  tokens?: Array<{ candidateName: string; link: string; telegramMessage: string }>;
}

export async function bulkCreateTokensAction(
  candidateIds: string[],
): Promise<BulkTokensResult> {
  await requirePermission("tokens.manage");
  if (candidateIds.length === 0 || candidateIds.length > 100) {
    return { ok: false, error: "1 dan 100 gacha nomzod tanlang" };
  }
  const tokens: NonNullable<BulkTokensResult["tokens"]> = [];
  for (const id of candidateIds) {
    const res = await createTokenAction(id);
    if (res.ok && res.link && res.candidateName && res.telegramMessage) {
      tokens.push({
        candidateName: res.candidateName,
        link: res.link,
        telegramMessage: res.telegramMessage,
      });
    }
  }
  return { ok: true, tokens };
}

export async function revokeTokenAction(tokenId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermission("tokens.manage");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("monthly_update_tokens")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("status", "active");
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "token.revoke",
    entityType: "monthly_update_token",
    entityId: tokenId,
    severity: "warning",
  });
  revalidatePath("/monthly-links");
  return { ok: true };
}

export async function extendTokenAction(
  tokenId: string,
  extraDays: number,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermission("tokens.manage");
  const days = Math.min(Math.max(extraDays, 1), 90);
  const admin = createSupabaseAdminClient();
  const { data: token } = await admin
    .from("monthly_update_tokens")
    .select("expires_at, status")
    .eq("id", tokenId)
    .maybeSingle();
  if (!token) return { ok: false, error: "Token topilmadi" };
  if (token.status === "revoked" || token.status === "used") {
    return { ok: false, error: "Bekor qilingan yoki ishlatilgan tokenni uzaytirib bo‘lmaydi" };
  }
  const base = token.expires_at ? Math.max(new Date(token.expires_at).getTime(), Date.now()) : Date.now();
  const { error } = await admin
    .from("monthly_update_tokens")
    .update({ expires_at: new Date(base + days * 86400000).toISOString(), status: "active" })
    .eq("id", tokenId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "token.extend",
    entityType: "monthly_update_token",
    entityId: tokenId,
    metadata: { extra_days: days },
  });
  revalidatePath("/monthly-links");
  return { ok: true };
}

/* ------------------------- Monthly updates review ------------------------- */

const REVIEW_TRANSITIONS: Record<string, MonthlyUpdateStatus[]> = {
  submitted: ["under_review", "needs_changes", "approved", "rejected"],
  under_review: ["needs_changes", "approved", "rejected"],
  needs_changes: ["under_review", "approved", "rejected"],
  approved: ["merged", "under_review", "rejected"],
  rejected: ["under_review"],
};

export async function setUpdateStatusAction(
  updateId: string,
  status: MonthlyUpdateStatus,
  comment?: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermission(status === "merged" ? "updates.merge" : "updates.review");
  const admin = createSupabaseAdminClient();
  const { data: current } = await admin
    .from("monthly_updates")
    .select("status, candidate_id")
    .eq("id", updateId)
    .maybeSingle();
  if (!current) return { ok: false, error: "Yangilanish topilmadi" };

  const allowed = REVIEW_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(status)) {
    return { ok: false, error: `“${current.status}” holatidan “${status}” holatiga o‘tib bo‘lmaydi` };
  }

  const { error } = await admin
    .from("monthly_updates")
    .update({
      status,
      reviewer_id: ctx.userId,
      reviewer_comment: comment?.trim() || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", updateId);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: `monthly_update.${status}`,
    entityType: "monthly_update",
    entityId: updateId,
    oldValue: { status: current.status },
    newValue: { status },
    reason: comment?.trim() || null,
  });
  revalidatePath("/monthly-updates");
  revalidatePath(`/monthly-updates/${updateId}`);
  return { ok: true };
}

export async function saveUpdateTextsAction(
  updateId: string,
  fields: { ai_text?: string; final_text?: string },
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermission("updates.review");
  const admin = createSupabaseAdminClient();
  const patch: Record<string, string> = {};
  if (typeof fields.ai_text === "string") patch.ai_text = fields.ai_text;
  if (typeof fields.final_text === "string") patch.final_text = fields.final_text;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await admin.from("monthly_updates").update(patch).eq("id", updateId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "monthly_update.edit_text",
    entityType: "monthly_update",
    entityId: updateId,
  });
  revalidatePath(`/monthly-updates/${updateId}`);
  return { ok: true };
}

const ITEM_TABLE_MAP: Record<string, string | null> = {
  book: "books_read",
  achievement: "achievements",
  certificate: "achievements",
  event: "events",
  project: "events",
  volunteering: "events",
  education: "education",
  work: "work_experiences",
  other: null,
};

/** Merges an approved update into the candidate biography: structured items
 *  are copied into the profile tables and the 30-day cycle restarts. */
export async function mergeUpdateAction(
  updateId: string,
): Promise<{ ok: boolean; error?: string; mergedItems?: number }> {
  const ctx = await requirePermission("updates.merge");
  const admin = createSupabaseAdminClient();

  const { data: update } = await admin
    .from("monthly_updates")
    .select("id, status, candidate_id, final_text, ai_text, free_text")
    .eq("id", updateId)
    .maybeSingle();
  if (!update) return { ok: false, error: "Yangilanish topilmadi" };
  if (update.status !== "approved") {
    return { ok: false, error: "Faqat tasdiqlangan yangilanishni birlashtirish mumkin" };
  }

  const { data: items } = await admin
    .from("monthly_update_items")
    .select("kind, title, description, occurred_at, link_url")
    .eq("update_id", updateId);

  let merged = 0;
  for (const item of items ?? []) {
    const table = ITEM_TABLE_MAP[item.kind as string];
    if (!table) continue;
    const { error } = await admin.from(table).insert({
      candidate_id: update.candidate_id,
      title: item.title,
      description: item.description,
      date_from: item.occurred_at,
      url: item.link_url,
    });
    if (!error) merged++;
  }

  const now = new Date();
  const { error: statusError } = await admin
    .from("monthly_updates")
    .update({
      status: "merged",
      reviewer_id: ctx.userId,
      reviewed_at: now.toISOString(),
    })
    .eq("id", updateId);
  if (statusError) return { ok: false, error: statusError.message };

  await admin
    .from("candidates")
    .update({
      last_updated_at: now.toISOString(),
      next_update_due_at: new Date(now.getTime() + 30 * 86400000).toISOString(),
    })
    .eq("id", update.candidate_id);

  await logAudit({
    actorId: ctx.userId,
    action: "monthly_update.merged",
    entityType: "monthly_update",
    entityId: updateId,
    metadata: { merged_items: merged, candidate_id: update.candidate_id },
  });

  revalidatePath("/monthly-updates");
  revalidatePath(`/monthly-updates/${updateId}`);
  revalidatePath(`/candidates/${update.candidate_id}`);
  return { ok: true, mergedItems: merged };
}
