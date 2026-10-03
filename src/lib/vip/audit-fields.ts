/**
 * AUDIT QIYMATLARINI TOZALASH — SOF MODUL (§37, §56).
 *
 * IKKALA REPODA AYNAN BIR XIL FAYL (`vip-audit.test.ts` solishtiradi).
 * Hech narsa import qilmaydi: testlar uni `node --test` bilan
 * to'g'ridan-to'g'ri yuklaydi. Bazaga yozuvchi `audit-log.ts` esa
 * `server-only` va admin mijozga bog'langan — uni testda yuklab bo'lmaydi,
 * shuning uchun tekshirilishi kerak bo'lgan qoida shu yerda turadi.
 */

/** Jurnalga yoziladigan qiymat. Ichma-ich obyekt YO'Q — ataylab. */
export type AuditScalar = string | number | boolean | null;
export type AuditValue = AuditScalar | readonly AuditScalar[];
export type AuditFields = Readonly<Record<string, AuditValue>>;

/** Bitta matn qiymatining jurnaldagi chegarasi. */
export const AUDIT_MAX_TEXT = 500;

/** Bitta ro'yxat qiymatidan jurnalga olinadigan elementlar soni. */
export const AUDIT_MAX_LIST = 50;

/** Sir kaliti o'rniga yoziladigan belgi. */
export const AUDIT_REDACTED = "[yashirilgan]";

/**
 * Sir bo'lishi mumkin bo'lgan kalitlar.
 *
 * Aniq so'z chegarasi bilan: `/key/` kabi keng andoza `theme_key` yoki
 * `idempotency_key` ni ham yashirib, foydali ma'lumotni yo'qotardi.
 */
const SECRET_KEY = /(^|_)(token|secret|password|passwd|api_?key|hash|signature)(_|$)/i;

export function isSecretAuditKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

function cleanScalar(value: AuditScalar): AuditScalar {
  if (typeof value !== "string") return value;
  return value.length > AUDIT_MAX_TEXT ? `${value.slice(0, AUDIT_MAX_TEXT)}…` : value;
}

function cleanValue(value: AuditValue): AuditValue {
  if (Array.isArray(value)) {
    return value.slice(0, AUDIT_MAX_LIST).map((item: AuditScalar) => cleanScalar(item));
  }
  return cleanScalar(value as AuditScalar);
}

/** Tekis maydonlarni tozalaydi: sir kalitlari yashiriladi, uzun matn qisqartiriladi. */
export function cleanAuditFields(
  fields: AuditFields | null | undefined,
): Record<string, AuditValue> | null {
  if (!fields) return null;
  const out: Record<string, AuditValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = isSecretAuditKey(key) ? AUDIT_REDACTED : cleanValue(value);
  }
  return out;
}

/** Sabab matni: bo'sh bo'lsa `null`, uzun bo'lsa qisqartiriladi. */
export function cleanAuditReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed.slice(0, AUDIT_MAX_TEXT) : null;
}
