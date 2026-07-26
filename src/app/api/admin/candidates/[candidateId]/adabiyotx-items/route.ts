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
  stableExternalIdFromUrl,
} from "@/lib/adabiyotx/core";
import {
  candidateAdabiyotXCreateSchema,
  toDatabaseTimestamp,
} from "@/lib/adabiyotx/validation";
import {
  mapCandidateAdabiyotXRow,
  type CandidateAdabiyotXRow,
} from "@/lib/adabiyotx/types";

export const dynamic = "force-dynamic";

type CandidateRouteContext = {
  params: Promise<{ candidateId: string }>;
};

export async function GET(_request: Request, context: CandidateRouteContext) {
  const auth = await checkPermission("candidates.view");
  if (!auth) return adabiyotXError("FORBIDDEN", "Ruxsat yo‘q.", 403);

  const { candidateId } = await context.params;
  const invalidId = validateUuidParam(candidateId, "Nomzod");
  if (invalidId) return invalidId;
  const candidateError = await ensureCandidateExists(candidateId);
  if (candidateError) return candidateError;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("candidate_adabiyotx_items")
    .select(CANDIDATE_ADABIYOTX_SELECT)
    .eq("candidate_id", candidateId)
    .order("relationship_type")
    .order("sort_order")
    .order("created_at");

  if (error) {
    return adabiyotXError(
      "ITEMS_LOAD_FAILED",
      "AdabiyotX materiallarini yuklab bo‘lmadi.",
      500,
    );
  }

  return NextResponse.json({
    ok: true,
    items: ((data ?? []) as unknown as CandidateAdabiyotXRow[]).map(
      mapCandidateAdabiyotXRow,
    ),
  });
}

export async function POST(request: Request, context: CandidateRouteContext) {
  const auth = await checkPermission("candidates.edit");
  if (!auth) return adabiyotXError("FORBIDDEN", "Ruxsat yo‘q.", 403);

  const { candidateId } = await context.params;
  const invalidId = validateUuidParam(candidateId, "Nomzod");
  if (invalidId) return invalidId;
  const candidateError = await ensureCandidateExists(candidateId);
  if (candidateError) return candidateError;

  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = candidateAdabiyotXCreateSchema.safeParse(body.value);
  if (!parsed.success) {
    return adabiyotXError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Ma’lumotlar noto‘g‘ri.",
      400,
    );
  }

  const value = parsed.data;
  const externalUrl = normalizeAdabiyotXUrl(value.externalUrl);
  const externalId =
    value.externalId?.trim() ?? stableExternalIdFromUrl(value.externalUrl);
  if (!externalUrl || !externalId) {
    return adabiyotXError(
      "INVALID_EXTERNAL_URL",
      "AdabiyotX havolasi noto‘g‘ri.",
      400,
    );
  }

  const admin = createSupabaseAdminClient();
  let sortOrder = value.sortOrder;
  if (sortOrder === undefined) {
    const { data: lastItem } = await admin
      .from("candidate_adabiyotx_items")
      .select("sort_order")
      .eq("candidate_id", candidateId)
      .eq("relationship_type", value.relationshipType)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = (lastItem?.sort_order ?? -1) + 1;
  }

  const payload = {
    candidate_id: candidateId,
    external_id: externalId,
    relationship_type: value.relationshipType,
    content_type: value.contentType,
    title: value.title,
    author_name: value.authorName || null,
    description: value.description || null,
    cover_url: normalizeSafeCoverUrl(value.coverUrl),
    external_url: externalUrl,
    published_at: toDatabaseTimestamp(value.publishedAt),
    sort_order: sortOrder,
    is_visible: value.isVisible ?? true,
    metadata: value.metadata ?? {},
    created_by: auth.userId,
  };

  const { data, error } = await admin
    .from("candidate_adabiyotx_items")
    .insert(payload)
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
      "ITEM_CREATE_FAILED",
      "Materialni biriktirib bo‘lmadi.",
      500,
    );
  }

  const item = mapCandidateAdabiyotXRow(
    data as unknown as CandidateAdabiyotXRow,
  );
  await logAudit({
    actorId: auth.userId,
    action: "candidate.adabiyotx.attach",
    entityType: "candidate",
    entityId: candidateId,
    newValue: {
      item_id: item.id,
      relationship_type: item.relationshipType,
      content_type: item.contentType,
      title: item.title,
    },
  });
  return NextResponse.json({ ok: true, item }, { status: 201 });
}
