/**
 * AI Sotuv boti — umumiy tiplar va lug'atlar.
 *
 * Bu modul ATAYLAB sof: "server-only" ham, Supabase ham, Next ham import
 * qilinmaydi. Shu sabab uni `node --test` to'g'ridan-to'g'ri yuklay oladi va
 * webhook mantig'i brauzer/serverga bog'lanmasdan sinaladi.
 */

/* ------------------------------- xabarlar ------------------------------- */

export const SALES_DIRECTIONS = ["incoming", "outgoing"] as const;
export type SalesDirection = (typeof SALES_DIRECTIONS)[number];

export const SALES_MESSAGE_TYPES = [
  "text",
  "photo",
  "video",
  "video_note",
  "voice",
  "audio",
  "document",
  "sticker",
  "animation",
  "contact",
  "location",
  "poll",
  "story",
  "other",
] as const;
export type SalesMessageType = (typeof SALES_MESSAGE_TYPES)[number];

/* ------------------------------- suhbatlar ------------------------------ */

export const LEARNING_STATUSES = [
  "pending",
  "learning",
  "learned",
  "failed",
  "skipped",
] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

export const LEARNING_STATUS_LABELS: Record<LearningStatus, string> = {
  pending: "O‘rganilmagan",
  learning: "O‘rganilmoqda",
  learned: "O‘rganilgan",
  failed: "Xatolik",
  skipped: "O‘tkazib yuborilgan",
};

/* ----------------------------- bilim bazasi ----------------------------- */

/**
 * Texnik topshiriqdagi 12 turkum. Tartib UI da ham shu tartibda ko'rinadi.
 */
export const KNOWLEDGE_CATEGORIES = [
  "question",
  "answer",
  "service_fact",
  "price",
  "faq",
  "objection",
  "sales_argument",
  "cta",
  "follow_up",
  "application",
  "payment",
  "post_article",
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  question: "Savol",
  answer: "Javob",
  service_fact: "Xizmat fakti",
  price: "Narx",
  faq: "FAQ",
  objection: "E’tiroz",
  sales_argument: "Sotuv argumenti",
  cta: "CTA",
  follow_up: "Follow-up",
  application: "Ariza",
  payment: "To‘lov",
  post_article: "Post / maqola",
};

export const KNOWLEDGE_STATUSES = ["draft", "approved", "rejected"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  draft: "Qoralama",
  approved: "Tasdiqlangan",
  rejected: "Rad etilgan",
};

/* --------------------------- o'rganish jobs ---------------------------- */

export const LEARNING_JOB_KINDS = ["knowledge", "style", "both"] as const;
export type LearningJobKind = (typeof LEARNING_JOB_KINDS)[number];

export const LEARNING_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "partial",
] as const;
export type LearningJobStatus = (typeof LEARNING_JOB_STATUSES)[number];

export const LEARNING_JOB_STATUS_LABELS: Record<LearningJobStatus, string> = {
  queued: "Navbatda",
  running: "Ishlamoqda",
  succeeded: "Yakunlandi",
  failed: "Xatolik",
  partial: "Qisman",
};

export const LEARNING_JOB_KIND_LABELS: Record<LearningJobKind, string> = {
  knowledge: "Bilim",
  style: "Uslub",
  both: "Bilim + uslub",
};

/* ------------------------------- guardlar ------------------------------- */

export function isKnowledgeCategory(value: unknown): value is KnowledgeCategory {
  return (
    typeof value === "string" &&
    (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isSalesMessageType(value: unknown): value is SalesMessageType {
  return (
    typeof value === "string" &&
    (SALES_MESSAGE_TYPES as readonly string[]).includes(value)
  );
}
