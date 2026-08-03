import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const BUCKET_RULES: Record<
  string,
  { maxBytes: number; mime: string[]; isPublic: boolean }
> = {
  "candidate-avatars": {
    maxBytes: 4 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp"],
    isPublic: true,
  },
  "candidate-gallery": {
    maxBytes: 8 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp"],
    isPublic: true,
  },
  "monthly-update-media": {
    maxBytes: 15 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    isPublic: false,
  },
  "journal-covers": {
    maxBytes: 6 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp"],
    isPublic: true,
  },
  "journal-pdfs": {
    maxBytes: 50 * 1024 * 1024,
    mime: ["application/pdf"],
    isPublic: false,
  },
  "podcast-media": {
    maxBytes: 10 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "audio/mpeg"],
    isPublic: true,
  },
  "application-files": {
    maxBytes: 15 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    isPublic: false,
  },
  "admin-private-files": {
    maxBytes: 25 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/csv"],
    isPublic: false,
  },
  "ai-assistant": {
    maxBytes: 20 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "video/mp4", "video/webm"],
    isPublic: true,
  },
  "corner-video": {
    maxBytes: 40 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"],
    isPublic: true,
  },
};

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
  const rules = BUCKET_RULES[bucket];
  if (!rules) {
    return NextResponse.json({ error: "Noto‘g‘ri bucket" }, { status: 400 });
  }
  if (!rules.mime.includes(file.type)) {
    return NextResponse.json(
      { error: `Fayl turi qo‘llab-quvvatlanmaydi (${file.type})` },
      { status: 400 },
    );
  }
  if (file.size > rules.maxBytes) {
    return NextResponse.json(
      { error: `Fayl juda katta (maksimum ${Math.round(rules.maxBytes / 1024 / 1024)} MB)` },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;

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
