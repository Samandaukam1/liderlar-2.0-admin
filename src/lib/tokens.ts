import { createHash, randomBytes } from "crypto";
// Relative, not "@/": this module runs under the raw node:test runner, which
// resolves no tsconfig path aliases.
import { publicSiteUrlFromEnv } from "./public-site.ts";

/** 32 random bytes, base64url — shown to the admin exactly once. */
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this SHA-256 hash is ever stored in monthly_update_tokens. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function buildUpdateLink(rawToken: string): string {
  return `${publicSiteUrlFromEnv(process.env.NEXT_PUBLIC_SITE_URL)}/yangilash/${rawToken}`;
}

export function buildTelegramMessage(candidateName: string, link: string): string {
  return [
    `Assalomu alaykum, ${candidateName}!`,
    "",
    "Liderlar.uz platformasidagi profilingizni yangilash vaqti keldi.",
    "Quyidagi shaxsiy havola orqali so‘nggi 30 kunlik yutuqlaringiz, o‘qigan kitoblaringiz va faoliyatingiz haqida ma’lumot yuborishingiz mumkin:",
    "",
    link,
    "",
    "Havola 14 kun davomida amal qiladi va faqat sizga mo‘ljallangan.",
    "Hurmat bilan, Liderlar.uz jamoasi",
  ].join("\n");
}

export type TokenStatus = "active" | "used" | "expired" | "revoked";

export function deriveTokenStatus(row: {
  status: string;
  expires_at: string | null;
  used_at: string | null;
}): TokenStatus {
  if (row.status === "revoked") return "revoked";
  if (row.used_at || row.status === "used") return "used";
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return "expired";
  }
  return "active";
}
