import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/post-studio/bot-router";
import { isTelegramConfigured } from "@/lib/post-studio/telegram";

// Node runtime: the handler talks to Supabase with the service-role client and
// uses node:crypto for the secret comparison.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time header check, so the secret cannot be probed byte by byte. */
function secretMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/telegram/webhook
 *
 * Receives bot updates for the private delivery bot.
 *
 * NOTE: this path is listed in src/proxy.ts's PUBLIC_PATHS. Without that, the
 * admin session middleware answered Telegram with a 307 to /login and the
 * handler below never ran — Telegram reported every delivery as "Wrong response
 * from the webhook: 307 Temporary Redirect" and users got silence. The route is
 * not unprotected: Telegram's own secret token is checked on every request.
 *
 * The whole update is awaited before responding, so the reply is on its way to
 * the user before Telegram sees a 200. Failures are logged and still answered
 * with 200, because a non-2xx puts the webhook into a retry loop on an update
 * that will fail again.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[telegram-webhook] TELEGRAM_WEBHOOK_SECRET sozlanmagan — webhook o‘chirilgan");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (!secretMatches(secret, request.headers.get("x-telegram-bot-api-secret-token"))) {
    console.warn("[telegram-webhook] rejected: secret token mismatch");
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!isTelegramConfigured()) {
    console.error("[telegram-webhook] TELEGRAM_BOT_TOKEN sozlanmagan — javob yuborib bo‘lmaydi");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    console.warn("[telegram-webhook] rejected: body is not JSON");
    return NextResponse.json({ ok: true });
  }

  console.log("[telegram-webhook] update received");

  try {
    await handleTelegramUpdate(update as Parameters<typeof handleTelegramUpdate>[0]);
  } catch (err) {
    console.error(
      "[telegram-webhook] handler failed:",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  }

  return NextResponse.json({ ok: true });
}
