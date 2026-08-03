import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { BUCKET_RULES } from "@/lib/upload-rules";

/**
 * Called once the browser has finished uploading to the signed URL. Confirms
 * the object really landed, records it in the media library and returns the
 * URL the form should store (public URL, or a signed one for private buckets).
 */
export async function POST(request: Request) {
  const ctx = await checkPermission("media.upload");
  if (!ctx) {
    return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });
  }

  let body: {
    bucket?: string;
    path?: string;
    fileName?: string;
    mimeType?: string;
    candidateId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "So‘rov formati noto‘g‘ri" }, { status: 400 });
  }

  const bucket = String(body.bucket ?? "");
  const path = String(body.path ?? "");
  const rules = BUCKET_RULES[bucket];
  if (!rules || !path) {
    return NextResponse.json({ error: "Noto‘g‘ri bucket yoki fayl manzili" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Trust the storage layer, not the caller, for the object's existence and size.
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data: listed, error: listError } = await admin.storage
    .from(bucket)
    .list(folder, { search: name, limit: 1 });
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }
  const object = listed?.find((o) => o.name === name);
  if (!object) {
    return NextResponse.json({ error: "Yuklangan fayl topilmadi" }, { status: 404 });
  }

  const sizeBytes = Number(object.metadata?.size ?? 0);
  const mimeType = String(object.metadata?.mimetype ?? body.mimeType ?? "");

  if (sizeBytes > rules.maxBytes) {
    await admin.storage.from(bucket).remove([path]);
    return NextResponse.json(
      { error: `Fayl juda katta (maksimum ${Math.round(rules.maxBytes / 1024 / 1024)} MB)` },
      { status: 400 },
    );
  }
  if (mimeType && !rules.mime.includes(mimeType)) {
    await admin.storage.from(bucket).remove([path]);
    return NextResponse.json(
      { error: `Fayl turi qo‘llab-quvvatlanmaydi (${mimeType})` },
      { status: 400 },
    );
  }

  const fileName = String(body.fileName ?? name).slice(0, 200);
  await admin.from("candidate_media").insert({
    bucket,
    path,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    candidate_id: body.candidateId ? String(body.candidateId) : null,
    kind: bucket,
    uploaded_by: ctx.userId,
  });

  await logAudit({
    actorId: ctx.userId,
    action: "media.upload",
    entityType: "media",
    metadata: { bucket, file_name: fileName, size: sizeBytes },
  });

  let url: string;
  if (rules.isPublic) {
    url = admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  } else {
    const { data: signed } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    url = signed?.signedUrl ?? "";
  }

  return NextResponse.json({ url, path, bucket });
}
