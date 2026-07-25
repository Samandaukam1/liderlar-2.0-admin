/**
 * Zod validation + normalizers for the intake flow. Pure and unit-testable.
 * Server routes must NOT trust the frontend mask — every value is re-validated
 * (and re-normalized) here before it reaches the database.
 */
import { z } from "zod";

// Inlined (not imported from ./constants) so this pure module has no runtime
// relative import — keeps it loadable under `node --test` native TS stripping.
const ANSWER_STATES = ["unanswered", "answered", "no_answer"] as const;

/* ----------------------------- phone (E.164) ----------------------------- */

/**
 * Normalizes a phone number to E.164. Uzbek 9-digit local numbers are assumed
 * to be +998. Returns null when the result is not a plausible E.164 string.
 */
export function normalizePhoneE164(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const hasPlus = s.trimStart().startsWith("+");
  const num = s.replace(/\D/g, "");
  if (!num) return null;

  let e164: string;
  if (hasPlus) {
    e164 = "+" + num;
  } else if (num.length === 9) {
    e164 = "+998" + num; // local Uzbek mobile
  } else if (num.startsWith("998")) {
    e164 = "+" + num;
  } else {
    e164 = "+" + num;
  }
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/* ----------------------------- telegram ----------------------------- */

/** Accepts `name` or `@name`; stores canonical `@name`. */
export function normalizeTelegram(raw: string): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(t) ? "@" + t : null;
}

/* ----------------------------- names ----------------------------- */

export const nameSchema = z.object({
  first_name: z.string().trim().min(1, "Ism kiritilishi shart").max(80),
  last_name: z.string().trim().min(1, "Familiya kiritilishi shart").max(80),
  father_name: z.string().trim().max(80).optional().default(""),
});
export type NameInput = z.infer<typeof nameSchema>;

export function composeFullName(n: NameInput): string {
  return [n.last_name, n.first_name, n.father_name]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 200);
}

/* ----------------------------- autosave ----------------------------- */

/** TipTap JSON is arbitrary; size is bounded by plain_text + a route-side cap. */
const richContent = z.unknown();

export const autosaveSchema = z.object({
  question_no: z.number().int().min(1).max(50),
  answer_state: z.enum(ANSWER_STATES),
  rich_content: richContent,
  plain_text: z.string().max(20000),
  lock_version: z.number().int().min(0),
});
export type AutosaveInput = z.infer<typeof autosaveSchema>;

/* ----------------------------- contact + consent ----------------------------- */

export const contactSchema = z.object({
  phone: z.string().min(4).max(40),
  telegram: z.string().min(4).max(40),
  consent: z.boolean(),
});

/** Server-side contact validation returning normalized values or field errors. */
export function validateContact(input: {
  phone: string;
  telegram: string;
  consent: boolean;
}): { ok: true; phone: string; telegram: string } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const phone = normalizePhoneE164(input.phone);
  const telegram = normalizeTelegram(input.telegram);
  if (!phone) errors.push("Telefon raqami noto‘g‘ri (E.164 formatida bo‘lishi kerak)");
  if (!telegram) errors.push("Telegram username noto‘g‘ri (5–32 belgi, harf/raqam/_)");
  if (input.consent !== true) errors.push("Rozilik belgilanishi shart");
  if (errors.length) return { ok: false, errors };
  return { ok: true, phone: phone!, telegram: telegram! };
}
