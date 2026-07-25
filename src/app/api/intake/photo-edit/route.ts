import { after, type NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink } from "@/lib/intake/data";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson, originAllowed, readJsonBody } from "@/lib/intake/http";
import { buildPhotoPrompt } from "@/lib/intake/photo-prompt";
import { imageModel } from "@/lib/intake/ai";
import {
  CANDIDATE_PHOTO_STALE_MS,
  failStaleCandidatePhotoJob,
  processCandidatePhotoEdit,
} from "@/lib/intake/photo-jobs";
import {
  CLOTHING_TYPES,
  COLORS,
  type ClothingType,
  type PhotoColor,
  type Gender,
} from "@/lib/intake/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

interface ProcessingRow {
  id: string;
  status: "queued" | "processing";
  created_at: string;
}

async function findProcessingJob(params: {
  intakeId: string;
  sourceId: string;
  clothing: string;
  color: string | null;
}): Promise<ProcessingRow | null> {
  const db = createSupabaseAdminClient();
  let query = db
    .from("candidate_intake_photo_edits")
    .select("id, status, created_at")
    .eq("intake_id", params.intakeId)
    .eq("source_attachment_id", params.sourceId)
    .eq("clothing_type", params.clothing)
    .in("status", ["queued", "processing"]);
  query = params.color === null ? query.is("color", null) : query.eq("color", params.color);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as ProcessingRow | null) ?? null;
}

/**
 * Starts candidate portrait generation and returns as soon as the durable job
 * row exists. OpenAI and Storage work continues in a Next.js after() task.
 */
export async function POST(request: NextRequest) {
  if (!originAllowed(request.headers)) return jsonError(403, "Ruxsat etilmagan manba");

  const body = await readJsonBody(request);
  const rawToken = extractRawToken(request.headers, body.token);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const rateLimit = enforceRateLimit("photo_edit", hashIntakeToken(rawToken));
  if (!rateLimit.ok) {
    return jsonError(429, "Juda ko‘p urinish", {
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  const clothing = String(body.clothing_type ?? "");
  const color = body.color == null ? null : String(body.color);
  if (!(CLOTHING_TYPES as readonly string[]).includes(clothing)) {
    return jsonError(400, "Kiyim turi noto‘g‘ri");
  }
  if (clothing !== "own_clothes" && !(COLORS as readonly string[]).includes(color ?? "")) {
    return jsonError(400, "Rang noto‘g‘ri");
  }
  const normalizedColor = clothing === "own_clothes" ? null : color;

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

  const db = createSupabaseAdminClient();
  const [{ data: intake }, { data: source }] = await Promise.all([
    db
      .from("candidate_intakes")
      .select("id, gender")
      .eq("id", resolved.intakeId)
      .maybeSingle(),
    db
      .from("candidate_intake_attachments")
      .select("id")
      .eq("intake_id", resolved.intakeId)
      .eq("is_primary_photo", true)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (!intake) return jsonError(404, "Anketa topilmadi");
  if (!source) return jsonError(400, "Avval original rasmni yuklang");

  const existing = await findProcessingJob({
    intakeId: resolved.intakeId,
    sourceId: source.id as string,
    clothing,
    color: normalizedColor,
  });
  if (existing) {
    const age = Date.now() - new Date(existing.created_at).getTime();
    if (age < CANDIDATE_PHOTO_STALE_MS) {
      return noStoreJson(
        {
          ok: true,
          photoEditId: existing.id,
          status: existing.status,
          existing: true,
        },
        202,
      );
    }
    await failStaleCandidatePhotoJob(existing.id);
  }

  const gender = ((intake.gender as Gender) ?? "male") as Gender;
  const prompt = await buildPhotoPrompt({
    gender,
    clothingType: clothing as ClothingType,
    color: normalizedColor as PhotoColor | null,
  });

  const { data: edit, error: editError } = await db
    .from("candidate_intake_photo_edits")
    .insert({
      intake_id: resolved.intakeId,
      source_attachment_id: source.id,
      prompt,
      model: imageModel(),
      status: "processing",
      gender_snapshot: gender,
      clothing_type: clothing,
      color: normalizedColor,
    })
    .select("id")
    .single();

  if (editError || !edit) {
    // The partial unique index makes simultaneous double-clicks converge on
    // the already-created processing job.
    if (editError?.code === "23505") {
      const concurrent = await findProcessingJob({
        intakeId: resolved.intakeId,
        sourceId: source.id as string,
        clothing,
        color: normalizedColor,
      });
      if (concurrent) {
        return noStoreJson(
          {
            ok: true,
            photoEditId: concurrent.id,
            status: concurrent.status,
            existing: true,
          },
          202,
        );
      }
    }
    return jsonError(500, "Rasmni qayta ishlashni boshlashda xatolik yuz berdi");
  }

  const photoEditId = edit.id as string;
  after(async () => {
    await processCandidatePhotoEdit({
      photoEditId,
      intakeId: resolved.intakeId,
    });
  });

  return noStoreJson(
    {
      ok: true,
      photoEditId,
      status: "processing",
    },
    202,
  );
}
