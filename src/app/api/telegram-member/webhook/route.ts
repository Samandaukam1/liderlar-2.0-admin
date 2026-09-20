import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isMemberWebhookConfigured, isValidMemberSecret } from "@/lib/member-bot/bot-api";
import { handleMemberUpdate, type MemberUpdate } from "@/lib/member-bot/router";
import { getMehrFlags } from "@/lib/mehr/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/telegram-member/webhook
 *
 * A'ZO BOTI — TO'RTINCHI bot. Post boti, AI sotuv boti va
 * koordinator botidan butunlay ajratilgan: o'z tokeni, o'z
 * sekreti, o'z endpointi. Bittasining sozlamasi buzilsa,
 * qolganlari ta'sirlanmaydi.
 *
 * Route `src/proxy.ts` dagi MACHINE_PATHS ro'yxatida bo'lishi
 * SHART: admin sessiya middleware'i Telegram'ga 307 qaytarsa,
 * Telegram har yetkazishni "Wrong response from the webhook"
 * deb belgilaydi va handler umuman ishlamaydi.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.MEMBER_TELEGRAM_WEBHOOK_SECRET;

  if (!secret || !isMemberWebhookConfigured()) {
    // Sozlanmagan — 503. Bu "ruxsat yo'q" emas, "hali yoqilmagan".
    console.error("[member-webhook] sekret sozlanmagan — webhook o'chirilgan");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  if (!isValidMemberSecret(secret, request.headers.get("x-telegram-bot-api-secret-token"))) {
    console.warn("[member-webhook] rad etildi: sekret mos kelmadi");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  /*
   * BAYROQ O'CHIQ BO'LSA — HECH NIMA QILINMAYDI.
   *
   * Avval bu tekshiruv yo'q edi va `member.bot_enabled`
   * panelda turgani bilan hech nimani to'smasdi: bot o'chiq
   * deb ko'rsatilib, aslida javob berib turardi.
   *
   * 200 qaytariladi, 503 emas: non-2xx Telegram'ni cheksiz
   * qayta urinishga solardi, holbuki bu xato emas — ataylab
   * yopilgan holat.
   */
  const flags = await getMehrFlags();
  if (!flags.memberBotEnabled) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    console.warn("[member-webhook] rad etildi: body JSON emas");
    return NextResponse.json({ ok: true });
  }

  try {
    await handleMemberUpdate(update as MemberUpdate);
  } catch (err) {
    /*
     * XATO BO'LSA HAM 200. Non-2xx Telegram'ni cheksiz qayta
     * urinishga soladi va xato bilan kelgan update ikkinchi
     * marta ham xuddi shunday tugaydi.
     */
    console.error(
      "[member-webhook] handler xatosi:",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  }

  return NextResponse.json({ ok: true });
}
