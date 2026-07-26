import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "./validation";

export function adabiyotXError(
  code: string,
  error: string,
  status: number,
): NextResponse {
  return NextResponse.json({ ok: false, code, error }, { status });
}

export async function parseJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: adabiyotXError(
        "INVALID_JSON",
        "So‘rov tanasi to‘g‘ri JSON emas.",
        400,
      ),
    };
  }
}

export function validateUuidParam(
  value: string,
  label: string,
): NextResponse | null {
  return uuidSchema.safeParse(value).success
    ? null
    : adabiyotXError("INVALID_ID", `${label} ID noto‘g‘ri.`, 400);
}

export async function ensureCandidateExists(
  candidateId: string,
): Promise<NextResponse | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("candidates")
    .select("id")
    .eq("id", candidateId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return adabiyotXError(
      "CANDIDATE_LOOKUP_FAILED",
      "Nomzodni tekshirib bo‘lmadi.",
      500,
    );
  }
  if (!data) {
    return adabiyotXError("CANDIDATE_NOT_FOUND", "Nomzod topilmadi.", 404);
  }
  return null;
}

export const CANDIDATE_ADABIYOTX_SELECT =
  "id, candidate_id, external_id, relationship_type, content_type, title, author_name, description, cover_url, external_url, published_at, sort_order, is_visible, metadata, created_at, updated_at";
