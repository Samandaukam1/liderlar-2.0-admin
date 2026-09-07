import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { parseSalesUpdate } from "@/lib/sales/update-parser";
import { isValidWebhookSecret } from "@/lib/sales/webhook-auth";
import {
  getConnection,
  ingestBusinessMessage,
  markMessagesDeleted,
  upsertBusinessConnection,
} from "@/lib/sales/repository";

// Node runtime: Supabase service-role klienti va node:crypto ishlatiladi.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/telegram-sales/webhook
 *
 * AI SOTUV BOTI (0.1) — Telegram Business chatlarini qabul qiladi.
 *
 * MAVJUD POST BOTIGA TEGMAYDI. U `/api/telegram/webhook` da, o'z tokeni va
 * o'z sekretida ishlaydi. Bu route FAQAT `SALES_TELEGRAM_*` env'larini
 * o'qiydi; ikkovi bir-birining sozlamasini ko'rmaydi.
 *
 * 0.1 DA JAVOB YO'Q. Bu fayl Telegram transportini import ham qilmaydi —
 * mijozga xabar yuborishning kod yo'li mavjud emas. Bot faqat O'QIYDI,
 * SAQLAYDI va (alohida, admin bosgan tugma orqali) O'RGANADI.
 *
 * Route `src/proxy.ts` dagi MACHINE_PATHS ro'yxatida: admin sessiya
 * middleware'i Telegram'ga 307 qaytarsa, Telegram har yetkazishni "Wrong
 * response from the webhook" deb belgilaydi va handler umuman ishlamaydi.
 * Route himoyasiz emas — Telegram'ning o'z sekret tokeni tekshiriladi.
 */

export async function POST(request: NextRequest) {
  const secret = process.env.SALES_TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[sales-webhook] SALES_TELEGRAM_WEBHOOK_SECRET sozlanmagan — webhook o‘chirilgan",
    );
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (!isValidWebhookSecret(secret, request.headers.get("x-telegram-bot-api-secret-token"))) {
    console.warn("[sales-webhook] rad etildi: sekret token mos kelmadi");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    console.warn("[sales-webhook] rad etildi: body JSON emas");
    return NextResponse.json({ ok: true });
  }

  try {
    await handleSalesUpdate(update);
  } catch (err) {
    // Non-2xx Telegram'ni cheksiz qayta urinishga soladi — xato bilan
    // kelgan update ikkinchi marta ham xuddi shunday tugaydi. Shuning
    // uchun xato log'ga yoziladi va 200 qaytariladi.
    console.error(
      "[sales-webhook] handler xatosi:",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  }

  return NextResponse.json({ ok: true });
}

async function handleSalesUpdate(update: unknown): Promise<void> {
  // Yo'nalishni aniqlashda eng ishonchli manba — ulanish egasining id'si.
  // Shuning uchun avval ulanish o'qiladi (xabarning o'zidan olinadigan
  // zaxira qoida `resolveDirection` ichida).
  const connectionId = readConnectionId(update);
  const connection = connectionId ? await getConnection(connectionId) : null;

  const parsed = parseSalesUpdate(update, {
    ownerUserId: connection?.ownerTelegramUserId ?? null,
  });

  switch (parsed.kind) {
    case "connection": {
      await upsertBusinessConnection(parsed.connection);
      console.log(
        `[sales-webhook] ulanish yangilandi (enabled=${parsed.connection.isEnabled})`,
      );
      return;
    }
    case "message": {
      const result = await ingestBusinessMessage(parsed.message, { edited: parsed.edited });
      console.log(
        `[sales-webhook] xabar: stored=${result.stored} duplicate=${result.duplicate} ` +
          `direction=${parsed.message.direction}`,
      );
      return;
    }
    case "deleted": {
      const marked = await markMessagesDeleted(parsed.deletion);
      console.log(`[sales-webhook] o‘chirilgan deb belgilandi: ${marked}`);
      return;
    }
    case "ignored":
      console.log(`[sales-webhook] e’tiborsiz: ${parsed.reason}`);
  }
}

/** Ulanish id'si uch xil update shaklida uch xil joyda turadi. */
function readConnectionId(update: unknown): string | null {
  if (!update || typeof update !== "object") return null;
  const raw = update as Record<string, unknown>;
  const candidates = [
    (raw.business_message as { business_connection_id?: unknown } | undefined)
      ?.business_connection_id,
    (raw.edited_business_message as { business_connection_id?: unknown } | undefined)
      ?.business_connection_id,
    (raw.deleted_business_messages as { business_connection_id?: unknown } | undefined)
      ?.business_connection_id,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}
