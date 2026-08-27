import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleTelegramUpdate, isTelegramConfigured } from "@/lib/post-studio/telegram";

// Node runtime: the handler talks to Supabase with the service-role client.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/telegram/webhook
 *
 * Receives bot updates. The endpoint is public by necessity, so it is guarded
 * by Telegram's own secret-token header (set with setWebhook's secret_token) —
 * without a configured secret the route refuses every request rather than
 * accepting unauthenticated writes into the subscriber table.
 *
 * Telegram retries any non-2xx, so handler failures are swallowed after being
 * logged: a poison update must not put the webhook into a retry loop.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET sozlanmagan — webhook o‘chirilgan");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!isTelegramConfigured()) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  try {
    await handleTelegramUpdate(await request.json());
  } catch (err) {
    console.error("telegram webhook failed", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true });
}
