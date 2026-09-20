import { NextResponse, type NextRequest } from "next/server";
import { checkPermission } from "@/lib/auth";
import { setMehrLogo, clearMehrLogo } from "@/lib/mehr/logo-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MEHR logotipini yuklash / olib tashlash.
 *
 * Ruxsat SERVERDA tekshiriladi: tugmani yashirish himoya
 * emas, endpointni to'g'ridan-to'g'ri chaqirib bo'ladi.
 */
export async function POST(request: NextRequest) {
  const auth = await checkPermission("settings.manage");
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Ruxsat yo'q." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: "So'rov formati noto'g'ri." }, { status: 400 });
  }

  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "Fayl tanlanmagan." }, { status: 400 });
  }

  const result = await setMehrLogo(
    {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
      size: file.size,
      name: file.name,
    },
    auth.userId,
  );

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE() {
  const auth = await checkPermission("settings.manage");
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Ruxsat yo'q." }, { status: 403 });
  }

  const result = await clearMehrLogo(auth.userId);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
