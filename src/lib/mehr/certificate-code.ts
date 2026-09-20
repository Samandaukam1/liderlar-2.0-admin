import { randomBytes } from "node:crypto";

/**
 * Sertifikat kodi — SOF MODUL (§33).
 *
 * Nega uuid emas: kod QR'ga kiradi va odam uni qo'lda ham terishi
 * mumkin. Shuning uchun qisqa, bir xil registrda va CHALKASHADIGAN
 * belgilarsiz.
 */

/*
 * Crockford base32'dan olingan alifbo: I, L, O, U yo'q.
 *
 *   I/1, O/0 — ko'chirishda chalkashadi;
 *   U        — tasodifan so'kinish so'zi chiqib qolmasligi uchun.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_LENGTH = 10;

export const CERTIFICATE_CODE_PREFIX = "MEHR";
const CODE_RE = new RegExp(`^${CERTIFICATE_CODE_PREFIX}-[${ALPHABET}]{${BODY_LENGTH}}$`);

export function generateCertificateCode(): string {
  /*
   * Modulo siljishidan qochish: 256 alifbo uzunligiga bo'linmaydi,
   * shuning uchun chegaradan oshgan baytlar tashlab yuboriladi.
   * Aks holda birinchi belgilar biroz ko'proq chiqib, kod
   * taxmin qilinishi osonlashardi.
   */
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";

  while (out.length < BODY_LENGTH) {
    for (const byte of randomBytes(BODY_LENGTH)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === BODY_LENGTH) break;
    }
  }

  return `${CERTIFICATE_CODE_PREFIX}-${out}`;
}

/** Foydalanuvchi kiritgan kodni tozalaydi: bo'shliq, registr, chiziqcha. */
export function normalizeCertificateCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  const prefix = CERTIFICATE_CODE_PREFIX;

  const body = cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : cleaned;
  if (body.length !== BODY_LENGTH) return null;

  const code = `${prefix}-${body}`;
  return CODE_RE.test(code) ? code : null;
}

export function isCertificateCode(value: string): boolean {
  return CODE_RE.test(value);
}

export type CertificateRole = "participant" | "co_organizer" | "organizer";

/** Bitta tadbir + bitta odam + bitta rol = bitta sertifikat. */
export function certificateIdentity(
  activityId: string,
  profileId: string,
  role: CertificateRole,
): string {
  return `${activityId}:${profileId}:${role}`;
}

export const CERTIFICATE_ROLE_LABEL: Readonly<Record<CertificateRole, string>> = {
  participant: "Ishtirokchi",
  co_organizer: "Hamkor tashkilotchi",
  organizer: "Tashkilotchi",
};

export interface CertificateView {
  status: "active" | "revoked";
  revokedReason: string | null;
}

/**
 * Ommaviy tekshirish sahifasi nima ko'rsatadi.
 *
 * BEKOR QILINGAN SERTIFIKAT YASHIRILMAYDI (§33). "Topilmadi"
 * deyish soxta sertifikat bilan bekor qilinganni bir xil
 * ko'rsatardi — holbuki tekshiruvchi uchun bu ikki boshqa javob.
 */
export function certificateVerdict(cert: CertificateView | null): {
  state: "valid" | "revoked" | "not_found";
  message: string;
} {
  if (!cert) {
    return { state: "not_found", message: "Bunday sertifikat topilmadi." };
  }
  if (cert.status === "revoked") {
    return {
      state: "revoked",
      message: cert.revokedReason
        ? `Bu sertifikat bekor qilingan. Sabab: ${cert.revokedReason}`
        : "Bu sertifikat bekor qilingan.",
    };
  }
  return { state: "valid", message: "Sertifikat haqiqiy." };
}
