import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  adabiyotXError,
  ensureCandidateExists,
  parseJsonBody,
  validateUuidParam,
} from "@/lib/adabiyotx/api";
import { candidateAdabiyotXReorderSchema } from "@/lib/adabiyotx/validation";

export const dynamic = "force-dynamic";

type CandidateRouteContext = {
  params: Promise<{ candidateId: string }>;
};

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
  const parsed = candidateAdabiyotXReorderSchema.safeParse(body.value);
  if (!parsed.success) {
    return adabiyotXError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Tartib ma’lumotlari noto‘g‘ri.",
      400,
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("reorder_candidate_adabiyotx_items", {
    p_candidate_id: candidateId,
    p_items: parsed.data.items.map((item) => ({
      id: item.id,
      sort_order: item.sortOrder,
    })),
  });
  if (error) {
    return adabiyotXError(
      "ITEMS_REORDER_FAILED",
      "Materiallar tartibini saqlab bo‘lmadi.",
      400,
    );
  }

  await logAudit({
    actorId: auth.userId,
    action: "candidate.adabiyotx.reorder",
    entityType: "candidate",
    entityId: candidateId,
    metadata: { item_count: parsed.data.items.length },
  });
  return NextResponse.json({ ok: true });
}
