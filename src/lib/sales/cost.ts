/**
 * Token sarfi va taxminiy narx.
 *
 * NARXI NOMA'LUM MODEL UCHUN `null` QAYTADI. Bu ataylab: noto'g'ri
 * narxni ko'rsatishdan ko'ra "noma'lum" deyish to'g'ri, chunki bu raqam
 * asosida keyingi yugurish hajmi tanlanadi.
 */

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

/** OpenAI e'lon qilgan narxlar, 1M token uchun AQSh dollarida. */
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  "gpt-4.1-mini": { inputPerMTok: 0.4, outputPerMTok: 1.6 },
  "gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8 },
};

/** Narxi ma'lum bo'lmasa null — taxmin qilinmaydi. */
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
