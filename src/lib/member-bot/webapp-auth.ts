import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telegram Mini App `initData` tekshiruvi — SOF MODUL.
 *
 * NEGA BU ENG NOZIK JOY.
 *
 * Mini App brauzerda ishlaydi va o'zining kimligini `initData`
 * satri bilan aytadi. Agar u shunchaki o'qib olinsa, istalgan
 * odam `user.id` ni o'zgartirib, boshqa a'zo nomidan check-in
 * qila olardi.
 *
 * Telegram buni imzo bilan yopadi:
 *
 *   secret = HMAC_SHA256(key="WebAppData", data=<bot token>)
 *   hash   = HMAC_SHA256(key=secret, data=<tartiblangan maydonlar>)
 *
 * Imzoni faqat bot tokenini bilgan tomon qo'ya oladi. Shuning
 * uchun tekshiruv SERVERDA bo'ladi va natija sifatida faqat
 * RAQAMLI TELEGRAM ID ishonchli deb qabul qilinadi.
 */

/** initData qancha vaqt amal qiladi. Eski satr qayta ishlatilmasin. */
export const INITDATA_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface TelegramWebAppUser {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
}

export type InitDataResult =
  | { ok: true; user: TelegramWebAppUser; authDate: number; startParam: string | null }
  | {
      ok: false;
      reason: "empty" | "malformed" | "no_hash" | "bad_signature" | "expired" | "no_user";
    };

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * initData'ni tekshiradi va ishonchli foydalanuvchini qaytaradi.
 *
 * `botToken` SHU FUNKSIYADAN TASHQARIGA CHIQMAYDI: u faqat imzo
 * kalitini hosil qilish uchun ishlatiladi va natijaga tushmaydi.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  nowSeconds: number,
  maxAgeSeconds: number = INITDATA_MAX_AGE_SECONDS,
): InitDataResult {
  if (!initData.trim()) return { ok: false, reason: "empty" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const providedHash = params.get("hash");
  if (!providedHash) return { ok: false, reason: "no_hash" };

  /*
   * Tekshiruv satri: `hash` dan boshqa HAMMA maydon, kalit
   * bo'yicha alifbo tartibida, `\n` bilan ulanadi. Tartib
   * muhim — Telegram imzoni aynan shunday hisoblaydi.
   */
  const pairs: string[] = [];
  for (const [key, value] of [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }

  const secret = hmac("WebAppData", botToken);
  const expected = hmac(secret, pairs.join("\n")).toString("hex");

  const a = Buffer.from(providedHash);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  /*
   * MUDDAT — IMZODAN KEYIN.
   *
   * Imzo to'g'ri bo'lsa ham, bir oy oldingi initData qabul
   * qilinmaydi: o'g'irlangan satr cheksiz ishlamasligi kerak.
   */
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "malformed" };
  if (nowSeconds - authDate > maxAgeSeconds) return { ok: false, reason: "expired" };

  const rawUser = params.get("user");
  if (!rawUser) return { ok: false, reason: "no_user" };

  let parsed: {
    id?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    username?: unknown;
    language_code?: unknown;
  };
  try {
    parsed = JSON.parse(rawUser);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof parsed.id !== "number" || !Number.isInteger(parsed.id)) {
    return { ok: false, reason: "no_user" };
  }

  return {
    ok: true,
    authDate,
    startParam: params.get("start_param"),
    user: {
      // SHAXS — AYNAN SHU RAQAM. Username hech qachon emas.
      id: parsed.id,
      firstName: typeof parsed.first_name === "string" ? parsed.first_name : "",
      lastName: typeof parsed.last_name === "string" ? parsed.last_name : null,
      username: typeof parsed.username === "string" ? parsed.username : null,
      languageCode: typeof parsed.language_code === "string" ? parsed.language_code : null,
    },
  };
}
