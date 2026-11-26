export const MAX_HIDDEN_PROMO_CODES = 50;

export function parseHiddenPromoCodes(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((code): code is string => typeof code === "string" && code.length > 0 && code.length <= 120))]
      .slice(0, MAX_HIDDEN_PROMO_CODES);
  } catch {
    return [];
  }
}

/** Quoted PostgREST values keep punctuation inside the literal code. */
export function hiddenPromoCondition(codes: string[]): string {
  return `promo_code.is.null,promo_code.not.in.(${codes.map((code) => JSON.stringify(code)).join(",")})`;
}

export function promoSearchPattern(value: string): string {
  return `${value.replace(/[\\%_]/g, "\\$&")}%`;
}
