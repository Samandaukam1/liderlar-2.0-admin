import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { INTAKE_BUCKET, AVATAR_BUCKET } from "./constants";

/**
 * Copies the chosen portrait (selected AI-processed edit, else the original
 * primary photo) from the private intake bucket into the public candidate-avatars
 * bucket, returning the resulting public URL. Runs on the server only.
 */
export async function copyFinalPhotoToAvatar(intakeId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();

  let srcBucket: string | null = null;
  let srcPath: string | null = null;
  let ext = "png";

  const { data: edit } = await admin
    .from("candidate_intake_photo_edits")
    .select("result_bucket, result_path")
    .eq("intake_id", intakeId)
    .eq("is_selected", true)
    .eq("status", "completed")
    .maybeSingle();

  if (edit?.result_path) {
    srcBucket = (edit.result_bucket as string) ?? INTAKE_BUCKET;
    srcPath = edit.result_path as string;
    ext = srcPath.split(".").pop() || "png";
  } else {
    const { data: photo } = await admin
      .from("candidate_intake_attachments")
      .select("bucket, path")
      .eq("intake_id", intakeId)
      .eq("is_primary_photo", true)
      .eq("status", "active")
      .maybeSingle();
    if (photo?.path) {
      srcBucket = photo.bucket as string;
      srcPath = photo.path as string;
      ext = srcPath.split(".").pop() || "jpg";
    }
  }

  if (!srcBucket || !srcPath) return null;

  const { data: blob, error: dlErr } = await admin.storage.from(srcBucket).download(srcPath);
  if (dlErr || !blob) return null;

  const dest = `${intakeId}/${crypto.randomUUID()}.${ext}`;
  const buf = Buffer.from(await blob.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from(AVATAR_BUCKET)
    .upload(dest, buf, { contentType: blob.type || "image/png", upsert: false });
  if (upErr) return null;

  return admin.storage.from(AVATAR_BUCKET).getPublicUrl(dest).data.publicUrl;
}
