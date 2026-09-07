import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { applyBrandingLogo, resetBranding } from "@/lib/branding/service";
import { validateBrandingUpload } from "@/lib/branding/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/branding — logotipni yuklash va ikonkalarni hosil qilish.
 * DELETE — standart belgiga qaytarish.
 *
 * NEGA SERVER ACTION EMAS: server action'ning body chegarasi standart
 * holatda 1 MB. Logotip undan katta bo'lishi mumkin, shuning uchun
 * yuklash oddiy route handler orqali ketadi (platforma chegarasi ~4.5 MB,
 * bizniki 5 MB tekshiruvi bilan mos).
 */
export async function POST(request: NextRequest) {
  const ctx = await checkPermission("settings.manage");
  if (!ctx) return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json({ error: "So‘rov formati noto‘g‘ri" }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: "Fayl tanlanmadi" }, { status: 400 });

  const check = validateBrandingUpload({ mimeType: file.type, size: file.size });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await applyBrandingLogo({
    buffer,
    mimeType: file.type,
    actorId: ctx.userId,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, branding: result.branding });
}

export async function DELETE() {
  const ctx = await checkPermission("settings.manage");
  if (!ctx) return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });

  const result = await resetBranding(ctx.userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, branding: result.branding });
}
