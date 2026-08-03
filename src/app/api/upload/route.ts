import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { BUCKET_RULES, buildObjectPath, validateUpload } from "@/lib/upload-rules";


export async function POST(request: Request) {
  const ctx = await checkPermission("media.upload");
  if (!ctx) {
    return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const bucket = String(form.get("bucket") ?? "");
  const candidateId = form.get("candidate_id");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fayl topilmadi" }, { status: 400 });
  }
  const check = validateUpload(bucket, file.type, file.size);
  if ("error" in check) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }
  const rules = BUCKET_RULES[bucket];

  const admin = createSupabaseAdminClient();
  const path = buildObjectPath(file.name);

  const { error: uploadError } = await admin.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    if (/bucket not found/i.test(uploadError.message)) {
      return NextResponse.json(
        {
          error: `Saqlash joyi ("${bucket}" bucket) Supabase'da topilmadi. Tegishli migratsiya hali ishga tushirilmagan bo'lishi mumkin.`,
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  await admin.from("candidate_media").insert({
    bucket,
    path,
    file_name: file.name.slice(0, 200),
    mime_type: file.type,
    size_bytes: file.size,
    candidate_id: typeof candidateId === "string" && candidateId ? candidateId : null,
    kind: bucket,
    uploaded_by: ctx.userId,
  });

  await logAudit({
    actorId: ctx.userId,
    action: "media.upload",
    entityType: "media",
    metadata: { bucket, file_name: file.name, size: file.size },
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
