import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { editIntakePhoto } from "@/lib/intake/ai";
import {
  OpenAIImageEditError,
  assertStorageUploadSucceeded,
  serializePhotoEditError,
} from "@/lib/intake/photo-edit";
import { INTAKE_BUCKET } from "@/lib/intake/constants";
import { signIntakeFileUrl } from "@/lib/intake/data";

export type CandidatePhotoJobStatus = "queued" | "processing" | "completed" | "failed";
export type CandidatePhotoSelectionKind = "original" | "ai";
export const CANDIDATE_PHOTO_STALE_MS = 5 * 60 * 1000;

export interface CandidatePhotoState {
  job: {
    id: string;
    status: CandidatePhotoJobStatus;
    createdAt: string;
    finishedAt: string | null;
  } | null;
  completed: {
    id: string;
    url: string | null;
    createdAt: string;
  } | null;
  selection: {
    kind: CandidatePhotoSelectionKind | null;
    editId: string | null;
    confirmedAt: string | null;
  };
}

interface PhotoEditRow {
  id: string;
  status: CandidatePhotoJobStatus;
  result_path: string | null;
  is_selected: boolean;
  created_at: string;
  finished_at: string | null;
}

/** Canonical, refresh-safe candidate view of the current primary photo's jobs. */
export async function loadCandidatePhotoState(intakeId: string): Promise<CandidatePhotoState> {
  const db = createSupabaseAdminClient();
  const [{ data: intake }, { data: source }] = await Promise.all([
    db
      .from("candidate_intakes")
      .select("selected_photo_kind, photo_confirmed_at")
      .eq("id", intakeId)
      .maybeSingle(),
    db
      .from("candidate_intake_attachments")
      .select("id")
      .eq("intake_id", intakeId)
      .eq("is_primary_photo", true)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  let rows: PhotoEditRow[] = [];
  if (source?.id) {
    const { data } = await db
      .from("candidate_intake_photo_edits")
      .select("id, status, result_path, is_selected, created_at, finished_at")
      .eq("intake_id", intakeId)
      .eq("source_attachment_id", source.id)
      .order("created_at", { ascending: false })
      .limit(20);
    rows = (data ?? []) as PhotoEditRow[];
  }

  const latest = rows[0] ?? null;
  if (
    latest &&
    ["queued", "processing"].includes(latest.status) &&
    Date.now() - new Date(latest.created_at).getTime() >= CANDIDATE_PHOTO_STALE_MS
  ) {
    await failStaleCandidatePhotoJob(latest.id);
    latest.status = "failed";
    latest.finished_at = new Date().toISOString();
  }
  const completed = rows.find((row) => row.status === "completed" && !!row.result_path) ?? null;
  const selected = rows.find((row) => row.is_selected && row.status === "completed") ?? null;
  const selectedKind =
    intake?.selected_photo_kind === "original" || intake?.selected_photo_kind === "ai"
      ? (intake.selected_photo_kind as CandidatePhotoSelectionKind)
      : null;

  return {
    job: latest
      ? {
          id: latest.id,
          status: latest.status,
          createdAt: latest.created_at,
          finishedAt: latest.finished_at,
        }
      : null,
    completed: completed
      ? {
          id: completed.id,
          url: await signIntakeFileUrl(completed.result_path!),
          createdAt: completed.created_at,
        }
      : null,
    selection: {
      kind: selectedKind,
      editId: selectedKind === "ai" ? selected?.id ?? null : null,
      confirmedAt: (intake?.photo_confirmed_at as string | null) ?? null,
    },
  };
}

/** Marks a job abandoned by a terminated background invocation. */
export async function failStaleCandidatePhotoJob(photoEditId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("candidate_intake_photo_edits")
    .update({
      status: "failed",
      error: "background_timeout",
      finished_at: new Date().toISOString(),
    })
    .eq("id", photoEditId)
    .in("status", ["queued", "processing"]);
}

/**
 * Background worker registered through Next.js after(). It reloads every input
 * from trusted database rows, never captures or logs the candidate's raw token.
 */
export async function processCandidatePhotoEdit(params: {
  photoEditId: string;
  intakeId: string;
}): Promise<void> {
  const db = createSupabaseAdminClient();
  const { data: edit } = await db
    .from("candidate_intake_photo_edits")
    .select("id, intake_id, source_attachment_id, prompt, status")
    .eq("id", params.photoEditId)
    .eq("intake_id", params.intakeId)
    .maybeSingle();
  if (!edit || !["queued", "processing"].includes(edit.status as string)) return;

  try {
    const { data: source } = await db
      .from("candidate_intake_attachments")
      .select("bucket, path, mime_type")
      .eq("id", edit.source_attachment_id)
      .eq("intake_id", params.intakeId)
      .eq("status", "active")
      .maybeSingle();
    if (!source) throw new Error("Source image row not found");

    const { data: blob, error: downloadError } = await db.storage
      .from(source.bucket as string)
      .download(source.path as string);
    if (downloadError || !blob) {
      throw new Error(`Source image download failed: ${downloadError?.message || "empty response"}`);
    }

    const result = await editIntakePhoto({
      imageBytes: new Uint8Array(await blob.arrayBuffer()),
      mime: blob.type || (source.mime_type as string) || "image/jpeg",
      prompt: edit.prompt as string,
    });

    const resultPath = `${params.intakeId}/photos/edited-${crypto.randomUUID()}.png`;
    const { error: uploadError } = await db.storage
      .from(INTAKE_BUCKET)
      .upload(resultPath, result.outputBuffer, {
        contentType: "image/png",
        upsert: false,
      });
    assertStorageUploadSucceeded(uploadError);

    const { error: completedError } = await db
      .from("candidate_intake_photo_edits")
      .update({
        status: "completed",
        result_bucket: INTAKE_BUCKET,
        result_path: resultPath,
        error: null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", params.photoEditId)
      .eq("intake_id", params.intakeId);
    if (completedError) {
      throw new Error(`Photo edit status update failed: ${completedError.message}`);
    }
  } catch (error: unknown) {
    const storedError = serializePhotoEditError(error);
    const { error: failedStatusError } = await db
      .from("candidate_intake_photo_edits")
      .update({
        status: "failed",
        error: storedError,
        finished_at: new Date().toISOString(),
      })
      .eq("id", params.photoEditId)
      .eq("intake_id", params.intakeId);
    if (failedStatusError) {
      console.error("Photo edit failed-status update failed", {
        editId: params.photoEditId,
        message: failedStatusError.message,
      });
    }
    // OpenAI errors are already logged once by requestOpenAIImageEdit with
    // status/code/type/param/requestId and without key, token, base64 or URL.
    if (!(error instanceof OpenAIImageEditError)) {
      console.error("intake candidate photo-edit failed", {
        editId: params.photoEditId,
        message: storedError,
      });
    }
  }
}
