import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  isCoordinatorWebhookConfigured,
  isValidCoordinatorSecret,
} from "@/lib/coordinators/bot-api";
import { handleCoordinatorUpdate } from "@/lib/coordinators/bot-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/telegram-coordinator/webhook
 *
 * KOORDINATOR BOTI — post boti va AI sotuv botidan BUTUNLAY
 * ajratilgan: o'z tokeni, o'z sekreti, o'z endpointi. Bittasining
 * sozlamasi buzilsa yoki tokeni sizsa, qolganlari ta'sirlanmaydi.
 *
 * Route `src/proxy.ts` dagi MACHINE_PATHS ro'yxatida bo'lishi
 * SHART: admin sessiya middleware'i Telegram'ga 307 qaytarsa,
 * Telegram har yetkazishni "Wrong response from the webhook" deb
 * belgilaydi va handler umuman ishlamaydi.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.COORDINATOR_TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !isCoordinatorWebhookConfigured()) {
    // Sozlanmagan holat — 503. Bu "ruxsat yo'q" emas, "hali
    // yoqilmagan" degani va Telegram uni qayta urinib ko'radi.
    console.error("[coordinator-webhook] sekret sozlanmagan — webhook o‘chirilgan");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  if (!isValidCoordinatorSecret(secret, request.headers.get("x-telegram-bot-api-secret-token"))) {
    console.warn("[coordinator-webhook] rad etildi: sekret mos kelmadi");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    console.warn("[coordinator-webhook] rad etildi: body JSON emas");
    return NextResponse.json({ ok: true });
  }

  try {
    await handleCoordinatorUpdate(update as Parameters<typeof handleCoordinatorUpdate>[0]);
  } catch (err) {
    /*
     * XATO BO'LSA HAM 200.
     *
     * Non-2xx Telegram'ni cheksiz qayta urinishga soladi va xato
     * bilan kelgan update ikkinchi marta ham xuddi shunday
     * tugaydi. Xato log'ga yoziladi; token hech qachon unga
     * tushmaydi (transport uni tozalaydi).
     */
    console.error(
      "[coordinator-webhook] handler xatosi:",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  }

  return NextResponse.json({ ok: true });
}
