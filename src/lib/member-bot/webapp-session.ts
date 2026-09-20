import "server-only";
import { verifyTelegramInitData, type TelegramWebAppUser } from "./webapp-auth.ts";
import { memberBotToken, isMemberBotConfigured } from "./bot-api.ts";
import { findProfileByTelegramId } from "@/lib/member/link-service";

/**
 * Mini App so'rovining shaxsini aniqlaydi.
 *
 * HAR BIR API SO'ROVIDA QAYTA TEKSHIRILADI.
 *
 * Mini App brauzerda ishlaydi va uning yuborgan hech bir
 * maydoniga ishonib bo'lmaydi — `profileId` ham, `role` ham.
 * Yagona ishonchli narsa — Telegram imzosi. Shuning uchun
 * shaxs har safar imzodan qayta chiqariladi, seansda
 * saqlanmaydi.
 */

export type WebAppIdentity =
  | { ok: true; telegramUser: TelegramWebAppUser; profileId: string }
  | {
      ok: false;
      reason: "not_configured" | "bad_init_data" | "not_linked";
      telegramUserId?: number;
    };

export async function identifyWebAppRequest(
  initData: string | null,
  now: Date = new Date(),
): Promise<WebAppIdentity> {
  if (!isMemberBotConfigured()) return { ok: false, reason: "not_configured" };
  if (!initData) return { ok: false, reason: "bad_init_data" };

  const verdict = verifyTelegramInitData(
    initData,
    memberBotToken(),
    Math.floor(now.getTime() / 1000),
  );

  if (!verdict.ok) return { ok: false, reason: "bad_init_data" };

  /*
   * Imzo to'g'ri — lekin bu odam Liderlar a'zosimi?
   *
   * Telegram hisobi bor bo'lishi yetarli emas: ball va
   * sertifikat profilga yoziladi, profil esa faqat saytda
   * bog'langanda paydo bo'ladi.
   */
  const profileId = await findProfileByTelegramId(verdict.user.id);
  if (!profileId) {
    return { ok: false, reason: "not_linked", telegramUserId: verdict.user.id };
  }

  return { ok: true, telegramUser: verdict.user, profileId };
}

/** API javoblari uchun bir xil xato shakli. */
export function identityError(identity: Extract<WebAppIdentity, { ok: false }>): {
  status: number;
  body: { ok: false; code: string; error: string };
} {
  switch (identity.reason) {
    case "not_configured":
      return {
        status: 503,
        body: { ok: false, code: "NOT_CONFIGURED", error: "Bot hali sozlanmagan." },
      };
    case "not_linked":
      return {
        status: 403,
        body: {
          ok: false,
          code: "NOT_LINKED",
          error: "Telegram hisobingiz Liderlar profiliga bog'lanmagan. Kabinetdan bog'lang.",
        },
      };
    default:
      return {
        status: 401,
        body: { ok: false, code: "BAD_INIT_DATA", error: "Identifikatsiya tasdiqlanmadi." },
      };
  }
}
