/**
 * Qaysi vazifa uchun qaysi model — bitta joyda.
 *
 * MUAMMO: loyihada oltita AI chaqiruv nuqtasi bor edi va HAMMASI bitta
 * `OPENAI_MODEL` o'zgaruvchisini o'qirdi. Ya'ni bitta joyda sifat uchun
 * qimmat model qo'yilsa, eng ko'p token yeydigan ish — 2500-4500 so'zlik
 * maqola yozish — ham o'sha modelga o'tib ketardi va hisob bir necha
 * barobar oshardi.
 *
 * Endi har vazifaning O'Z modeli bor. `OPENAI_MODEL` global zaxira
 * bo'lib qoladi (mavjud sozlama buzilmasin), lekin vazifaga xos
 * o'zgaruvchi undan USTUN turadi — shuning uchun maqolani arzon
 * modelda, boshqa ishni xohlagan modelda qoldirish mumkin.
 *
 * SOF MODUL: I/O yo'q, faqat env o'qish va narx hisobi.
 */

export const AI_TASKS = ["article", "improve", "intake", "sales"] as const;
export type AiTask = (typeof AI_TASKS)[number];

/**
 * Standart modellar.
 *
 * Hammasi ATAYLAB arzon variant: qimmatrog'i kerak bo'lsa, u ochiq
 * qaror bo'lib env orqali qo'yiladi, tasodifan meros bo'lib o'tmaydi.
 */
export const DEFAULT_TASK_MODEL: Record<AiTask, string> = {
  // Eng ko'p token yeydigan ish: uzun maqola, uchtagacha urinish.
  article: "gpt-4o-mini",
  improve: "gpt-4o-mini",
  intake: "gpt-4o-mini",
  sales: "gpt-4o-mini",
};

/** Vazifaga xos env o'zgaruvchilari. */
export const TASK_ENV_VAR: Record<AiTask, string> = {
  article: "OPENAI_ARTICLE_MODEL",
  improve: "OPENAI_IMPROVE_MODEL",
  intake: "OPENAI_INTAKE_MODEL",
  sales: "OPENAI_SALES_MODEL",
};

/**
 * Vazifa uchun model.
 *
 * TARTIB: vazifaga xos o'zgaruvchi -> global `OPENAI_MODEL` -> standart.
 *
 * `article` BU TARTIBDAN CHIQARILGAN va global qiymatni o'qimaydi:
 * aynan shu ish eng qimmat va uni "hamma narsa uchun" qo'yilgan
 * sozlama tortib ketmasligi kerak. Uni qimmatlashtirish faqat
 * `OPENAI_ARTICLE_MODEL` orqali, ya'ni ataylab qilinadi.
 */
export function resolveModel(
  task: AiTask,
  env: Record<string, string | undefined> = process.env,
): string {
  const specific = env[TASK_ENV_VAR[task]]?.trim();
  if (specific) return specific;
  if (task === "article") return DEFAULT_TASK_MODEL.article;
  const global = env.OPENAI_MODEL?.trim();
  return global || DEFAULT_TASK_MODEL[task];
}

/* --------------------------------- narx --------------------------------- */

/** OpenAI e'lon qilgan narxlar, 1M token uchun AQSh dollarida. */
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  "gpt-4.1-mini": { inputPerMTok: 0.4, outputPerMTok: 1.6 },
  "gpt-4.1-nano": { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  "gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8 },
};

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export function addUsage(a: TokenUsage, b: Partial<TokenUsage> | null | undefined): TokenUsage {
  if (!b) return a;
  const prompt = a.promptTokens + (b.promptTokens ?? 0);
  const completion = a.completionTokens + (b.completionTokens ?? 0);
  return {
    promptTokens: prompt,
    completionTokens: completion,
    // Provayder `total` bermasa yig'indidan hisoblanadi.
    totalTokens: b.totalTokens != null ? a.totalTokens + b.totalTokens : prompt + completion,
  };
}

/**
 * Taxminiy narx. Narxi ma'lum bo'lmagan model uchun `null` —
 * noto'g'ri raqam ko'rsatishdan ko'ra "noma'lum" deyish to'g'ri,
 * chunki bu son keyingi sozlama qaroriga asos bo'ladi.
 */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICING[model];
  if (!price) return null;
  const cost =
    (usage.promptTokens / 1_000_000) * price.inputPerMTok +
    (usage.completionTokens / 1_000_000) * price.outputPerMTok;
  return Math.round(cost * 10_000) / 10_000;
}

export function formatCostUsd(cost: number | null): string {
  if (cost == null) return "noma’lum";
  return `$${cost.toFixed(4)}`;
}
