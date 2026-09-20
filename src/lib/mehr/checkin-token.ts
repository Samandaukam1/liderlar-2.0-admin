import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * MEHR check-in tokeni — SOF MODUL.
 *
 * NEGA STATIK QR EMAS (§23).
 *
 * Bitta o'zgarmas QR tadbirga umuman kelmagan odamga ham yetib
 * boradi: uni skrinshot qilib guruhga tashlash yetarli. Shuning
 * uchun QR bu yerda qisqa muddatli IMZOLANGAN token:
 *
 *   - imzo seans kaliti bilan qo'yiladi (soxtalashtirib bo'lmaydi);
 *   - token bir necha o'n soniyada tugaydi;
 *   - har aylanishda yangi nonce — qaysi token ishlaganini dalil
 *     sifatida yozib qo'yish uchun.
 *
 * Token bazada SAQLANMAYDI: imzo uni o'zi tasdiqlaydi.
 */

export const CHECKIN_TOKEN_VERSION = "v1";

/** Soat farqiga yon berish. Telefon soati bir necha soniya og'ishi odatiy. */
const CLOCK_SKEW_SECONDS = 5;

export interface CheckinTokenPayload {
  /** Seans id — token qaysi tadbirga tegishli. */
  sessionId: string;
  /** Har aylanishda yangi. */
  nonce: string;
  /** Unix (soniya) — shundan keyin token o'lik. */
  expiresAt: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(body: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(body).digest());
}

export function newNonce(): string {
  return randomBytes(9).toString("hex");
}

/**
 * Token yasaydi. `nowSeconds` parametr sifatida olinadi — shunda
 * vaqtga bog'liq xulq testda soatni kutmasdan sinaladi.
 */
export function issueCheckinToken(
  payload: Omit<CheckinTokenPayload, "expiresAt">,
  secret: string,
  ttlSeconds: number,
  nowSeconds: number,
): string {
  const body = b64url(
    JSON.stringify({
      v: CHECKIN_TOKEN_VERSION,
      s: payload.sessionId,
      n: payload.nonce,
      e: nowSeconds + ttlSeconds,
    }),
  );
  return `${body}.${sign(body, secret)}`;
}

export type CheckinTokenResult =
  | { ok: true; payload: CheckinTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_session" };

/**
 * Tokenni tekshiradi.
 *
 * TARTIB MUHIM: avval imzo, keyin muddat. Teskarisi bo'lsa, imzosi
 * soxta tokenning muddati haqida ma'lumot bergan bo'lardik.
 */
export function verifyCheckinToken(
  token: string,
  secret: string,
  nowSeconds: number,
  expectedSessionId?: string,
): CheckinTokenResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };

  const [body, signature] = parts;

  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Uzunlik farq qilsa timingSafeEqual otadi — avval uni tekshiramiz.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: { v?: unknown; s?: unknown; n?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    parsed.v !== CHECKIN_TOKEN_VERSION ||
    typeof parsed.s !== "string" ||
    typeof parsed.n !== "string" ||
    typeof parsed.e !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (expectedSessionId !== undefined && parsed.s !== expectedSessionId) {
    return { ok: false, reason: "wrong_session" };
  }

  if (nowSeconds > parsed.e + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: { sessionId: parsed.s, nonce: parsed.n, expiresAt: parsed.e } };
}
