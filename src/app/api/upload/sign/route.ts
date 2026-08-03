import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildObjectPath, validateUpload } from "@/lib/upload-rules";

/**
 * Hands the browser a one-shot signed upload URL so the file can go straight
 * to Supabase Storage. Routing bytes through this function instead would cap
 * every upload at the platform's ~4.5 MB request body limit.
 *
 * The object path is generated here, never supplied by the client.
 */
export async function POST(request: Request) {
  const ctx = await checkPermission("media.upload");
  if (!ctx) {
    return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });
  }

  let body: { bucket?: string; fileName?: string; mimeType?: string; size?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "So‘rov formati noto‘g‘ri" }, { status: 400 });
  }

  const bucket = String(body.bucket ?? "");
  const fileName = String(body.fileName ?? "");
  const mimeType = String(body.mimeType ?? "");
  const size = Number(body.size ?? 0);

  const check = validateUpload(bucket, mimeType, size);
  if ("error" in check) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const path = buildObjectPath(fileName);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);

  if (error || !data) {
    if (error && /bucket not found/i.test(error.message)) {
      return NextResponse.json(
        {
          error: `Saqlash joyi ("${bucket}" bucket) Supabase'da topilmadi. Tegishli migratsiya hali ishga tushirilmagan bo'lishi mumkin.`,
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error?.message ?? "Signed URL olinmadi" }, { status: 500 });
  }

  return NextResponse.json({ bucket, path, token: data.token });
}
