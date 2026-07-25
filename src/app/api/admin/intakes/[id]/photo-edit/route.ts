import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { editIntakePhoto, imageModel } from "@/lib/intake/ai";
import { signIntakeFileUrl } from "@/lib/intake/data";
import { INTAKE_BUCKET } from "@/lib/intake/constants";
import { logAudit } from "@/lib/audit";

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

  let body: { prompt?: string; idempotency_key?: string; source_attachment_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "So‘rov noto‘g‘ri" }, { status: 400 });
  }
  const prompt = (body.prompt ?? "").trim();
  if (prompt.length < 10) return NextResponse.json({ error: "Prompt juda qisqa" }, { status: 400 });

  const db = createSupabaseAdminClient();

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

  const { data: edit } = await db
    .from("candidate_intake_photo_edits")
    .insert({
      intake_id: intakeId,
      source_attachment_id: source.id,
      prompt,
      model: imageModel(),
      status: "processing",
      idempotency_key: body.idempotency_key ?? null,
      created_by: admin.userId,
    })
    .select("id")
    .single();

  try {
    const { data: blob, error: dlErr } = await db.storage
      .from(source.bucket as string)
      .download(source.path as string);
    if (dlErr || !blob) throw new Error("Original rasmni o‘qib bo‘lmadi");

    const result = await editIntakePhoto({
      imageBytes: new Uint8Array(await blob.arrayBuffer()),
      fileName: (source.file_name as string) || "portrait.png",
      mime: (source.mime_type as string) || "image/png",
      prompt,
    });

    const resultPath = `${intakeId}/photos/edited-${crypto.randomUUID()}.png`;
    const { error: upErr } = await db.storage
      .from(INTAKE_BUCKET)
      .upload(resultPath, Buffer.from(result.b64, "base64"), { contentType: "image/png", upsert: false });
    if (upErr) throw new Error(upErr.message);

    await db
      .from("candidate_intake_photo_edits")
      .update({
        status: "completed",
        result_bucket: INTAKE_BUCKET,
        result_path: resultPath,
        finished_at: new Date().toISOString(),
      })
      .eq("id", edit!.id);

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
  } catch (err) {
    await db
      .from("candidate_intake_photo_edits")
      .update({ status: "failed", error: err instanceof Error ? err.message.slice(0, 400) : "unknown", finished_at: new Date().toISOString() })
      .eq("id", edit!.id);
    console.error("intake photo-edit failed");
    return NextResponse.json({ error: "Rasmni qayta ishlashda xatolik" }, { status: 502 });
  }
}
