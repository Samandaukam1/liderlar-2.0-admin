import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/upload-rules";
import { AD_MEDIA_BUCKET } from "@/lib/elonlar/types";
import {
  IMAGE_MAX_WIDTH,
  isMissingBucketError,
  LOGO_SIZE,
  MIGRATION_NOTICE,
  mediaObjectPath,
  validateMediaUpload,
} from "@/lib/elonlar/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/elonlar/upload — bar logotipi yoki rasmini yuklash.
 *
 * NEGA SERVERDA QAYTA ISHLANADI: logotip har doim aniq 1:1 bo'lishi kerak
 * (barning bir burchagida turadi), rasm esa saytga ortiqcha og'ir bo'lmasin.
 * Ikkalasi WebP'ga aylantiriladi va har safar YANGI yo'lga yoziladi — sayt
 * rasmlarni 31 kun keshlaydi, eski yo'lni ustidan yozish eski rasmni bir oy
 * ko'rsatib turardi. Yo'lda "ads/banner" so'zlari yo'q (reklama bloklovchi).
 */
export async function POST(request: NextRequest) {
  const ctx = await checkPermission("ads.manage");
  if (!ctx) return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });

  let file: File | null = null;
  let kind = "";
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
    kind = String(form.get("kind") ?? "");
  } catch {
    return NextResponse.json({ error: "So‘rov formati noto‘g‘ri" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Fayl tanlanmadi" }, { status: 400 });

  const check = validateMediaUpload({ kind, mimeType: file.type, size: file.size });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  let output: { data: Buffer; info: sharp.OutputInfo };
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const pipeline =
      check.kind === "logo"
        ? sharp(input).rotate().resize(LOGO_SIZE, LOGO_SIZE, { fit: "cover", position: "centre" }).webp({ quality: 88 })
        : sharp(input).rotate().resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 85 });
    output = await pipeline.toBuffer({ resolveWithObject: true });
  } catch {
    return NextResponse.json({ error: "Rasmni o‘qib bo‘lmadi" }, { status: 400 });
  }

  const path = mediaObjectPath(check.kind, randomUUID());
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(AD_MEDIA_BUCKET).upload(path, output.data, {
    contentType: "image/webp",
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
    upsert: false,
  });
  if (error) {
    const message = isMissingBucketError(error.message) ? MIGRATION_NOTICE : error.message;
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const url = admin.storage.from(AD_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ ok: true, url, width: output.info.width, height: output.info.height });
}
