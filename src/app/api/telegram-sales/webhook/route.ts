import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { parseSalesUpdate } from "@/lib/sales/update-parser";
import { isValidWebhookSecret } from "@/lib/sales/webhook-auth";
import { handleIncomingMessage } from "@/lib/sales/flow/engine";
import { recordPaymentEvidence } from "@/lib/sales/flow/payment-evidence";
import { classifyIncomingAttachment } from "@/lib/sales/flow/attachment-service";
import {
  handleOperatorCallback,
  handleOperatorMessage,
} from "@/lib/sales/operator-router";
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
 * 0.2 DA JAVOB BOR, LEKIN QAT'IY CHEGARADA. Bu fayl Telegram
 * transportini o'zi import QILMAYDI: u sotuv oqimi dvigatelini
 * (`flow/engine.ts`) chaqiradi, dvigatel esa har yuborishdan oldin
 * `outbound-guard.ts` dan muhrlangan ruxsat oladi. Sozlama o'chiq
 * bo'lsa (standart holat), inson suhbatni qo'lga olgan bo'lsa yoki
 * bosqich kutilganidan boshqa bo'lsa — hech narsa yuborilmaydi.
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
  /*
   * OPERATOR YO'LI — MIJOZ YO'LIDAN OLDIN VA UNDAN AJRALGAN.
   *
   * Moderator botga to'g'ridan-to'g'ri yozganda oddiy `message`
   * keladi (business chatdan emas). `parseSalesUpdate` bunday
   * updatelarni "ignored" deb tashlab yuboradi, shuning uchun ular
   * shu yerda, undan oldin ushlanadi.
   *
   * Bu yo'l mijoz suhbatiga TEGMAYDI: `operator-router` faqat
   * tahririyat ro'yxatidagi chatga va faqat `business_connection_id`
   * siz yozadigan transportdan foydalanadi.
   */
  if (await routeOperatorUpdate(update)) return;

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

      // TAKRORIY UPDATE IKKINCHI JAVOB YUBORMAYDI: oqim faqat YANGI
      // saqlangan KIRUVCHI xabarda ishga tushadi. Takror kelgan update
      // `stored: false` beradi va bu yerda to'xtaydi.
      if (!result.stored || !result.conversationId) return;
      if (parsed.message.direction !== "incoming") return;

      /*
       * BIRIKMA — SO'ROQSIZ CHEK EMAS.
       *
       * Ilgari har kiruvchi rasm yoki hujjat to'lov isboti deb
       * saqlanardi va suhbatga `evidence_received` qo'yilardi.
       * Amalda mijozlar eng ko'p MAQOLA UCHUN PORTRET yuboradi;
       * anketa xatosi skrinshoti va diplom ham shu yo'ldan o'tardi.
       *
       * Portretni chek deb belgilash ikki zarar beradi: to'lov
       * voronkasi yolg'on ko'rsatkich beradi va AI mijozga to'lov
       * kelgandek javob yozishi mumkin.
       *
       * Endi birikma avval TASNIFLANADI. Shubhada — saqlanmaydi.
       */
      if (parsed.message.fileId) {
        const attachment = await classifyIncomingAttachment({
          conversationId: result.conversationId,
          messageType: parsed.message.messageType,
          caption: parsed.message.text,
        });

        if (attachment.treatAsPayment) {
          const evidence = await recordPaymentEvidence({
            conversationId: result.conversationId,
            messageId: result.messageId,
            fileId: parsed.message.fileId,
            messageType: parsed.message.messageType,
          });
          if (evidence.error) console.warn(`[sales-webhook] chek: ${evidence.error}`);
          console.log(`[sales-webhook] birikma chek deb saqlandi: ${attachment.reason}`);
        } else {
          console.log(
            `[sales-webhook] birikma "${attachment.kind}" — chek sifatida saqlanmadi ` +
              `(${attachment.reason})`,
          );
        }
      }

      const flow = await handleIncomingMessage({
        conversationId: result.conversationId,
        messageId: result.messageId,
        text: parsed.message.text,
        messageType: parsed.message.messageType,
      });
      if (flow) {
        /*
         * MIJOZ MATNI JURNALGA CHIQMAYDI — faqat tasnif (37-band).
         *
         * `msg` maydoni "javobsiz savollar yana ifloslanyaptimi"
         * degan savolga jonli javob beradi: oddiy muloqot
         * xabarlarida `gap=none` bo'lishi kerak.
         */
        console.log(
          `[sales-webhook] oqim: ${flow.stageBefore} -> ${flow.stageAfter} ` +
            `intent=${flow.intent} msg=${flow.messageIntent ?? "-"} ` +
            `gap=${flow.gapDecision ?? "-"} sent=${flow.sent.length} ` +
            `refused=${flow.refusals.join(",")}`,
        );
      }
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

/**
 * Moderatorning o'z chatidagi xabari yoki tugmasi.
 *
 * `true` qaytsa — update ishlandi va mijoz oqimiga tushmaydi.
 */
async function routeOperatorUpdate(update: unknown): Promise<boolean> {
  if (!update || typeof update !== "object") return false;
  const raw = update as Record<string, unknown>;

  const callback = raw.callback_query as
    | {
        id?: string;
        data?: string;
        message?: { chat?: { id?: number }; message_id?: number; text?: string };
      }
    | undefined;
  if (callback?.id) {
    return handleOperatorCallback({
      id: callback.id,
      chatId: callback.message?.chat?.id ?? null,
      messageId: callback.message?.message_id ?? null,
      messageText: callback.message?.text ?? null,
      data: callback.data ?? null,
    });
  }

  // FAQAT oddiy `message`. Business xabarlar boshqa kalitlarda
  // keladi va ular bu yerga umuman tushmaydi.
  const message = raw.message as
    | { chat?: { id?: number }; text?: string; reply_to_message?: { text?: string } }
    | undefined;
  const chatId = message?.chat?.id;
  if (message && typeof chatId === "number") {
    return handleOperatorMessage({
      chatId,
      text: message.text ?? null,
      replyToText: message.reply_to_message?.text ?? null,
    });
  }

  return false;
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
