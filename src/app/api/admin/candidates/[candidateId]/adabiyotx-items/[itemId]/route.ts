import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  adabiyotXError,
  CANDIDATE_ADABIYOTX_SELECT,
  ensureCandidateExists,
  parseJsonBody,
  validateUuidParam,
} from "@/lib/adabiyotx/api";
import {
  normalizeAdabiyotXUrl,
  normalizeSafeCoverUrl,
} from "@/lib/adabiyotx/core";
import {
  candidateAdabiyotXCreateSchema,
  candidateAdabiyotXPatchSchema,
  toDatabaseTimestamp,
} from "@/lib/adabiyotx/validation";
import {
  mapCandidateAdabiyotXRow,
  type CandidateAdabiyotXRow,
} from "@/lib/adabiyotx/types";

export const dynamic = "force-dynamic";

type ItemRouteContext = {
  params: Promise<{ candidateId: string; itemId: string }>;
};

export async function PATCH(request: Request, context: ItemRouteContext) {
  const auth = await checkPermission("candidates.edit");
  if (!auth) return adabiyotXError("FORBIDDEN", "Ruxsat yo‘q.", 403);

  const { candidateId, itemId } = await context.params;
  const invalidCandidate = validateUuidParam(candidateId, "Nomzod");
  if (invalidCandidate) return invalidCandidate;
  const invalidItem = validateUuidParam(itemId, "Material");
  if (invalidItem) return invalidItem;
  const candidateError = await ensureCandidateExists(candidateId);
  if (candidateError) return candidateError;

  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const patch = candidateAdabiyotXPatchSchema.safeParse(body.value);
  if (!patch.success) {
    return adabiyotXError(
      "VALIDATION_ERROR",
      patch.error.issues[0]?.message ?? "Ma’lumotlar noto‘g‘ri.",
      400,
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: existingData, error: loadError } = await admin
    .from("candidate_adabiyotx_items")
    .select(CANDIDATE_ADABIYOTX_SELECT)
    .eq("id", itemId)
    .eq("candidate_id", candidateId)
    .maybeSingle();
  if (loadError) {
    return adabiyotXError(
      "ITEM_LOAD_FAILED",
      "Materialni tekshirib bo‘lmadi.",
      500,
    );
  }
  if (!existingData) {
    return adabiyotXError("ITEM_NOT_FOUND", "Material topilmadi.", 404);
  }

  const existing = existingData as unknown as CandidateAdabiyotXRow;
  const value = patch.data;
  const merged = candidateAdabiyotXCreateSchema.safeParse({
    externalId: existing.external_id,
    relationshipType: value.relationshipType ?? existing.relationship_type,
    contentType: value.contentType ?? existing.content_type,
    title: value.title ?? existing.title,
    authorName:
      value.authorName === undefined ? existing.author_name : value.authorName,
    description:
      value.description === undefined ? existing.description : value.description,
    coverUrl: value.coverUrl === undefined ? existing.cover_url : value.coverUrl,
    externalUrl: value.externalUrl ?? existing.external_url,
    publishedAt:
      value.publishedAt === undefined ? existing.published_at : value.publishedAt,
    sortOrder: value.sortOrder ?? existing.sort_order,
    isVisible: value.isVisible ?? existing.is_visible,
    metadata: value.metadata ?? existing.metadata ?? {},
  });
  if (!merged.success) {
    return adabiyotXError(
      "VALIDATION_ERROR",
      merged.error.issues[0]?.message ?? "Ma’lumotlar noto‘g‘ri.",
      400,
    );
  }

  const next = merged.data;
  const externalUrl = normalizeAdabiyotXUrl(next.externalUrl);
  if (!externalUrl) {
    return adabiyotXError(
      "INVALID_EXTERNAL_URL",
      "AdabiyotX havolasi noto‘g‘ri.",
      400,
    );
  }

  const update = {
    relationship_type: next.relationshipType,
    content_type: next.contentType,
    title: next.title,
    author_name: next.authorName || null,
    description: next.description || null,
    cover_url: normalizeSafeCoverUrl(next.coverUrl),
    external_url: externalUrl,
    published_at: toDatabaseTimestamp(next.publishedAt),
    sort_order: next.sortOrder ?? existing.sort_order,
    is_visible: next.isVisible ?? existing.is_visible,
    metadata: next.metadata ?? {},
  };
  const { data, error } = await admin
    .from("candidate_adabiyotx_items")
    .update(update)
    .eq("id", itemId)
    .eq("candidate_id", candidateId)
    .select(CANDIDATE_ADABIYOTX_SELECT)
    .single();

  if (error?.code === "23505") {
    return adabiyotXError(
      "ITEM_ALREADY_LINKED",
      "Bu material nomzodga avval biriktirilgan.",
      409,
    );
  }
  if (error || !data) {
    return adabiyotXError(
      "ITEM_UPDATE_FAILED",
      "Materialni yangilab bo‘lmadi.",
      500,
    );
  }

  const item = mapCandidateAdabiyotXRow(
    data as unknown as CandidateAdabiyotXRow,
  );
  await logAudit({
    actorId: auth.userId,
    action: "candidate.adabiyotx.update",
    entityType: "candidate",
    entityId: candidateId,
    oldValue: {
      item_id: itemId,
      is_visible: existing.is_visible,
      sort_order: existing.sort_order,
    },
    newValue: {
      item_id: itemId,
      is_visible: item.isVisible,
      sort_order: item.sortOrder,
    },
  });
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(_request: Request, context: ItemRouteContext) {
  const auth = await checkPermission("candidates.edit");
  if (!auth) return adabiyotXError("FORBIDDEN", "Ruxsat yo‘q.", 403);

  const { candidateId, itemId } = await context.params;
  const invalidCandidate = validateUuidParam(candidateId, "Nomzod");
  if (invalidCandidate) return invalidCandidate;
  const invalidItem = validateUuidParam(itemId, "Material");
  if (invalidItem) return invalidItem;
  const candidateError = await ensureCandidateExists(candidateId);
  if (candidateError) return candidateError;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("candidate_adabiyotx_items")
    .delete()
    .eq("id", itemId)
    .eq("candidate_id", candidateId)
    .select("id, title")
    .maybeSingle();
  if (error) {
    return adabiyotXError(
      "ITEM_DELETE_FAILED",
      "Materialni olib tashlab bo‘lmadi.",
      500,
    );
  }
  if (!data) {
    return adabiyotXError("ITEM_NOT_FOUND", "Material topilmadi.", 404);
  }

  await logAudit({
    actorId: auth.userId,
    action: "candidate.adabiyotx.delete",
    entityType: "candidate",
    entityId: candidateId,
    oldValue: { item_id: itemId, title: data.title },
  });
  return NextResponse.json({ ok: true });
}
