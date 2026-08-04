/**
 * Candidate Intake V2 — shared constants and types (safe for client + server).
 * No secrets, no service-role access here.
 */

export const INTAKE_BUCKET = "candidate-intake-files";
export const AVATAR_BUCKET = "candidate-avatars";

export const INTAKE_METHODS = ["manual", "secure_link"] as const;
export type IntakeMethod = (typeof INTAKE_METHODS)[number];

export const INTAKE_STATUSES = [
  "draft",
  "submitted",
  "ai_reviewing",
  "needs_clarification",
  "approved",
  "promoted",
  "published",
  "archived",
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const ANSWER_STATES = ["unanswered", "answered", "no_answer"] as const;
export type AnswerState = (typeof ANSWER_STATES)[number];

export const NO_ANSWER_TEXT = "Yo‘q";

export const ATTACHMENT_KINDS = [
  "image",
  "video",
  "audio",
  "pdf",
  "document",
  "file",
  "photo",
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** How long a secure link is valid, in days (mirrors site_settings default). */
export const DEFAULT_LINK_TTL_DAYS = 30;

/** Default maximum upload size (site_settings override wins on the server). */
export const DEFAULT_MAX_UPLOAD_MB = 25;

/** Admin pipeline tabs. `method`/`status` map to how the list query filters. */
export interface IntakeTab {
  key: string;
  label: string;
  status?: IntakeStatus | IntakeStatus[];
  method?: IntakeMethod;
  incomplete?: boolean;
}

export const INTAKE_TABS: IntakeTab[] = [
  { key: "all", label: "Barcha nomzodlar" },
  { key: "incoming", label: "Kelayotgan anketalar", status: ["submitted", "ai_reviewing", "needs_clarification"] },
  { key: "manual", label: "Qo‘lda kiritilganlar", method: "manual" },
  { key: "secure_link", label: "Havola yuborilganlar", method: "secure_link" },
  { key: "incomplete", label: "Tugallanmaganlar", status: "draft", incomplete: true },
  { key: "submitted", label: "Yuborilganlar", status: "submitted" },
  { key: "ai_reviewing", label: "AI ko‘rib chiqmoqda", status: "ai_reviewing" },
  { key: "needs_clarification", label: "Aniqlashtirish kerak", status: "needs_clarification" },
  { key: "approved", label: "Tasdiqlanganlar", status: "approved" },
  { key: "promoted", label: "Nomzodga aylantirilganlar", status: "promoted" },
  { key: "published", label: "Chop etilganlar", status: "published" },
];

export const INTAKE_STATUS_LABELS: Record<IntakeStatus, string> = {
  draft: "Qoralama",
  submitted: "Yuborilgan",
  ai_reviewing: "AI ko‘rmoqda",
  needs_clarification: "Aniqlashtirish kerak",
  approved: "Tasdiqlangan",
  promoted: "Nomzodga aylantirilgan",
  published: "Chop etilgan",
  archived: "Arxivlangan",
};

/**
 * The progression rule shared by the client wizard, the public form and the
 * server autosave route: the "next" step unlocks only when the current answer
 * is a non-empty answer OR an explicit "Yo‘q" (no_answer).
 */
export function canAdvanceAnswer(state: AnswerState, plainText: string): boolean {
  if (state === "no_answer") return plainText.trim() === NO_ANSWER_TEXT;
  if (state === "answered") return plainText.trim().length > 0;
  return false;
}

/** An empty TipTap document. */
export function emptyDoc(): { type: "doc"; content: never[] } {
  return { type: "doc", content: [] };
}

/** Extract plain text from a TipTap JSON document (client-safe, for search/AI). */
export function tiptapToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === "string") out.push(n.text);
    if (n.type === "hardBreak") out.push("\n");
    if (Array.isArray(n.content)) {
      n.content.forEach(walk);
      if (["paragraph", "heading", "listItem", "tableRow"].includes(n.type ?? "")) out.push("\n");
    }
  };
  walk(doc);
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/* ----------------------------- gender / photo params ----------------------------- */

export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];

export const CLOTHING_TYPES = ["suit", "shirt", "own_clothes"] as const;
export type ClothingType = (typeof CLOTHING_TYPES)[number];

export const COLORS = ["black", "white", "navy"] as const;
export type PhotoColor = (typeof COLORS)[number];

export const GENDER_LABELS: Record<Gender, string> = { male: "Erkak", female: "Ayol" };
export const CLOTHING_LABELS: Record<ClothingType, string> = {
  suit: "Kostyum",
  shirt: "Ko‘ylak",
  own_clothes: "O‘z kiyimim",
};
export const COLOR_LABELS: Record<PhotoColor, string> = {
  black: "Qora",
  white: "Oq",
  navy: "To‘q ko‘k",
};

/* ----------------------------- manual photo prompt ----------------------------- */

// The candidate flow no longer generates the portrait — the candidate takes this
// text to their own AI image tool and uploads the result, so the prompt has to
// stand on its own without any of the clothing/color fragments the server used.
const PHOTO_PROMPT_BASE =
  "Ushbu fotosuratni professional biografik portretga aylantiring. Yuz identifikatsiyasi, yosh va shaxsiy xususiyatlar AYNAN saqlansin — yuz almashtirilmasin, ortiqcha silliqlanmasin, tabiiy teri teksturasi saqlansin. " +
  "Fon: butunlay bir xil, soyasiz oq siklorama (professional studiya foni), fonda hech qanday boshqa element yoki predmet bo‘lmasin. " +
  "Kadr orqa fonida O‘zbekiston davlat bayrog‘i tik holatda biroz katta, tabiiy ravishda osilgan, yoyilmagan holda tursin. " +
  "Sub’ekt kameraga to‘g‘ridan-to‘g‘ri, tik qarab tursin: bosh tik, ikkala yelka bir xil balandlikda va tekis. " +
  "Qo‘llar tana yoniga neytral holatda tushirilgan, keskin harakat yoki imo-ishora yo‘q. " +
  "Kadr sub’ektning kindik chizig‘idan yuqori qismini (ko‘krak, yelka, bo‘yin, bosh) qamrab olsin, kindikdan pastki qism kadrga kirmasin. " +
  "Yoritish: yumshoq, bir tekis, old tomondan tushuvchi tabiiy studiya yorug‘ligi bo‘lsin, yuzda qattiq soyalar yoki ortiqcha yorqin nuqtalar bo‘lmasin.";

const PHOTO_PROMPT_MALE_CLOTHING =
  "Kiyim: to‘q ko‘k (navy) rangdagi rasmiy erkaklar kostyumi kiydirilsin. Bo‘yinbog‘ shart emas — bo‘yinbog‘siz, ochiq yoqali rasmiy ko‘rinish ham maqbul.";

// Headwear is the candidate's own, not a styling choice: the tool must keep a
// hijab/scarf/national cap exactly as photographed and never add one.
const PHOTO_PROMPT_FEMALE_CLOTHING =
  "Kiyim: to‘q ko‘k (navy) rangdagi vazmin, rasmiy ayollar kostyumi kiydirilsin. " +
  "Agar sub’ektda diniy kiyim yoki milliy bosh kiyim (ro‘mol, hijob, do‘ppi va shu kabilar) bo‘lsa, u ALBATTA saqlansin — olib tashlanmasin, boshqasiga almashtirilmasin, rangi va bog‘lanish uslubi o‘zgartirilmasin. " +
  "Bosh kiyim bo‘lmasa, o‘zboshimchalik bilan qo‘shilmasin.";

const PHOTO_PROMPT_TAIL =
  "Natija professional, rasmiy, yuqori sifatli portret bo‘lsin.\n\nRASMNING FORMATI 1154 GA 1423 PX BO‘LSIN";

/** Prompt the candidate copies into their own AI image tool, per gender. */
export const MANUAL_PHOTO_PROMPTS: Record<Gender, string> = {
  male: `${PHOTO_PROMPT_BASE} ${PHOTO_PROMPT_MALE_CLOTHING} ${PHOTO_PROMPT_TAIL}`,
  female: `${PHOTO_PROMPT_BASE} ${PHOTO_PROMPT_FEMALE_CLOTHING} ${PHOTO_PROMPT_TAIL}`,
};

/** site_settings keys used by the intake system. */
export const SETTINGS_KEYS = {
  defaultPhotoPrompt: "candidate_intake.default_photo_prompt",
  femalePhotoPrompt: "candidate_intake.female_photo_prompt_addition",
  malePhotoPrompt: "candidate_intake.male_photo_prompt_addition",
  consentText: "candidate_intake.consent_text",
  consentVersion: "candidate_intake.consent_version",
  maxUploadMb: "candidate_intake.max_upload_mb",
  linkTtlDays: "candidate_intake.link_ttl_days",
} as const;
