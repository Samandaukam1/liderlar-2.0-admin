import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink, signIntakeFileUrl } from "@/lib/intake/data";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson, originAllowed, readJsonBody } from "@/lib/intake/http";
import { buildPhotoPrompt } from "@/lib/intake/photo-prompt";
import { editIntakePhoto, imageModel } from "@/lib/intake/ai";
import {
  OpenAIImageEditError,
  assertStorageUploadSucceeded,
  photoEditErrorResponse,
} from "@/lib/intake/photo-edit";
import { INTAKE_BUCKET, CLOTHING_TYPES, COLORS, type ClothingType, type PhotoColor, type Gender } from "@/lib/intake/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * POST /api/intake/photo-edit — candidate-side AI portrait generation.
 * Token-gated (same as autosave/submit). The prompt is assembled by the shared
 * buildPhotoPrompt() from photo_prompt_fragments, using the intake's stored
 * gender + the candidate's clothing/color choice.
 */
export async function POST(request: NextRequest) {
  if (!originAllowed(request.headers)) return jsonError(403, "Ruxsat etilmagan manba");

  const body = await readJsonBody(request);
  const rawToken = extractRawToken(request.headers, body.token);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const rl = enforceRateLimit("photo_edit", hashIntakeToken(rawToken));
  if (!rl.ok) return jsonError(429, "Juda ko‘p urinish", { retryAfterSeconds: rl.retryAfterSeconds });

  const clothing = String(body.clothing_type ?? "");
  const color = body.color == null ? null : String(body.color);
  if (!(CLOTHING_TYPES as readonly string[]).includes(clothing)) return jsonError(400, "Kiyim turi noto‘g‘ri");
  if (clothing !== "own_clothes" && !(COLORS as readonly string[]).includes(color ?? "")) {
    return jsonError(400, "Rang noto‘g‘ri");
  }

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

  const db = createSupabaseAdminClient();
  const { data: intake } = await db
    .from("candidate_intakes")
    .select("id, gender")
    .eq("id", resolved.intakeId)
    .maybeSingle();
  if (!intake) return jsonError(404, "Anketa topilmadi");
  const gender = ((intake.gender as Gender) ?? "male") as Gender;

  const { data: source } = await db
    .from("candidate_intake_attachments")
    .select("id, bucket, path, mime_type, file_name")
    .eq("intake_id", resolved.intakeId)
    .eq("is_primary_photo", true)
    .eq("status", "active")
    .maybeSingle();
  if (!source) return jsonError(400, "Avval original rasmni yuklang");

  const prompt = await buildPhotoPrompt({
    gender,
    clothingType: clothing as ClothingType,
    color: clothing === "own_clothes" ? null : (color as PhotoColor),
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
      color: clothing === "own_clothes" ? null : color,
    })
    .select("id")
    .single();
  if (editError || !edit) return jsonError(500, "Rasmni qayta ishlashni boshlashda xatolik yuz berdi");

  try {
    const { data: blob, error: dlErr } = await db.storage
      .from(source.bucket as string)
      .download(source.path as string);
    if (dlErr || !blob) {
      throw new Error(`Source image download failed: ${dlErr?.message || "empty response"}`);
    }

    const result = await editIntakePhoto({
      imageBytes: new Uint8Array(await blob.arrayBuffer()),
      mime: blob.type || (source.mime_type as string) || "image/jpeg",
      prompt,
    });

    const resultPath = `${resolved.intakeId}/photos/edited-${crypto.randomUUID()}.png`;
    const { error: upErr } = await db.storage
      .from(INTAKE_BUCKET)
      .upload(resultPath, result.outputBuffer, { contentType: "image/png", upsert: false });
    assertStorageUploadSucceeded(upErr);

    const { error: completedError } = await db
      .from("candidate_intake_photo_edits")
      .update({ status: "completed", result_bucket: INTAKE_BUCKET, result_path: resultPath, finished_at: new Date().toISOString() })
      .eq("id", edit!.id);
    if (completedError) throw new Error(`Photo edit status update failed: ${completedError.message}`);

    return noStoreJson({ ok: true, edit: { id: edit!.id, status: "completed", url: await signIntakeFileUrl(resultPath) } });
  } catch (error: unknown) {
    const storedError = error instanceof Error ? error.message.slice(0, 400) : "unknown";
    const { error: failedStatusError } = await db
      .from("candidate_intake_photo_edits")
      .update({ status: "failed", error: storedError, finished_at: new Date().toISOString() })
      .eq("id", edit!.id);
    if (failedStatusError) {
      console.error("Photo edit failed-status update failed", {
        editId: edit.id,
        message: failedStatusError.message,
      });
    }
    if (error instanceof OpenAIImageEditError) {
      console.error("OpenAI image edit failed", {
        ...error.details,
        model: imageModel(),
      });
    } else {
      console.error("intake candidate photo-edit failed", { message: storedError });
    }
    const response = photoEditErrorResponse(error);
    return jsonError(response.status, response.message);
  }
}
