import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { editIntakePhoto, imageModel } from "@/lib/intake/ai";
import { signIntakeFileUrl } from "@/lib/intake/data";
import { buildPhotoPrompt } from "@/lib/intake/photo-prompt";
import { INTAKE_BUCKET, CLOTHING_TYPES, type ClothingType, type PhotoColor, type Gender } from "@/lib/intake/constants";
import { logAudit } from "@/lib/audit";
import {
  OpenAIImageEditError,
  assertStorageUploadSucceeded,
  photoEditErrorResponse,
} from "@/lib/intake/photo-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * POST /api/admin/intakes/[id]/photo-edit
 * Runs OpenAI image editing on the original portrait. Idempotency-key + button
 * lock guard against accidental double-charge. The original is never replaced;
 * every result is a new candidate_intake_photo_edits row.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await checkPermission("ai.use");
  if (!admin) return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });
  const { id: intakeId } = await ctx.params;

  let body: {
    prompt?: string;
    idempotency_key?: string;
    source_attachment_id?: string;
    clothing_type?: string;
    color?: string | null;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "So‘rov noto‘g‘ri" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();

  // Structured mode (clothing_type present) builds the prompt via the SHARED
  // buildPhotoPrompt() — same source as the candidate route, never hardcoded.
  // Otherwise fall back to a free-text prompt (backward compatible).
  const structured = !!body.clothing_type && (CLOTHING_TYPES as readonly string[]).includes(body.clothing_type);
  let prompt: string;
  let genderSnapshot: Gender | null = null;
  if (structured) {
    const { data: intakeRow } = await db.from("candidate_intakes").select("gender").eq("id", intakeId).maybeSingle();
    genderSnapshot = ((intakeRow?.gender as Gender) ?? "male") as Gender;
    prompt = await buildPhotoPrompt({
      gender: genderSnapshot,
      clothingType: body.clothing_type as ClothingType,
      color: body.clothing_type === "own_clothes" ? null : ((body.color as PhotoColor) ?? null),
    });
  } else {
    prompt = (body.prompt ?? "").trim();
    if (prompt.length < 10) return NextResponse.json({ error: "Prompt juda qisqa" }, { status: 400 });
  }

  if (body.idempotency_key) {
    const { data: prior } = await db
      .from("candidate_intake_photo_edits")
      .select("id, status, result_path")
      .eq("idempotency_key", body.idempotency_key)
      .maybeSingle();
    if (prior?.status === "completed" && prior.result_path) {
      return NextResponse.json({
        ok: true,
        cached: true,
        edit: { id: prior.id, status: "completed", url: await signIntakeFileUrl(prior.result_path as string) },
      });
    }
  }

  // Source = specified attachment or the active primary photo.
  const srcQuery = db
    .from("candidate_intake_attachments")
    .select("id, bucket, path, mime_type, file_name")
    .eq("intake_id", intakeId)
    .eq("status", "active");
  const { data: source } = body.source_attachment_id
    ? await srcQuery.eq("id", body.source_attachment_id).maybeSingle()
    : await srcQuery.eq("is_primary_photo", true).maybeSingle();
  if (!source) return NextResponse.json({ error: "Original rasm topilmadi" }, { status: 404 });

  const { data: edit, error: editError } = await db
    .from("candidate_intake_photo_edits")
    .insert({
      intake_id: intakeId,
      source_attachment_id: source.id,
      prompt,
      model: imageModel(),
      status: "processing",
      idempotency_key: body.idempotency_key ?? null,
      created_by: admin.userId,
      gender_snapshot: genderSnapshot,
      clothing_type: structured ? body.clothing_type : null,
      color: structured && body.clothing_type !== "own_clothes" ? body.color ?? null : null,
    })
    .select("id")
    .single();
  if (editError || !edit) {
    return NextResponse.json({ error: "Rasmni qayta ishlashni boshlashda xatolik" }, { status: 500 });
  }

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

    const resultPath = `${intakeId}/photos/edited-${crypto.randomUUID()}.png`;
    const { error: upErr } = await db.storage
      .from(INTAKE_BUCKET)
      .upload(resultPath, result.outputBuffer, { contentType: "image/png", upsert: false });
    assertStorageUploadSucceeded(upErr);

    const { error: completedError } = await db
      .from("candidate_intake_photo_edits")
      .update({
        status: "completed",
        result_bucket: INTAKE_BUCKET,
        result_path: resultPath,
        finished_at: new Date().toISOString(),
      })
      .eq("id", edit!.id);
    if (completedError) throw new Error(`Photo edit status update failed: ${completedError.message}`);

    await db.from("candidate_intake_ai_runs").insert({
      intake_id: intakeId,
      kind: "photo_edit",
      status: "completed",
      model: imageModel(),
      idempotency_key: body.idempotency_key ?? null,
      input_summary: { source_attachment: source.id, prompt_chars: prompt.length },
      created_by: admin.userId,
      finished_at: new Date().toISOString(),
    });
    await logAudit({
      actorId: admin.userId,
      action: "intake.photo.edit",
      entityType: "candidate_intake",
      entityId: intakeId,
      metadata: { model: imageModel() },
    });

    return NextResponse.json({
      ok: true,
      edit: { id: edit!.id, status: "completed", url: await signIntakeFileUrl(resultPath) },
    });
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
      console.error("intake photo-edit failed", { message: storedError });
    }
    const response = photoEditErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
