export interface RankingWeights {
  achievements: number;
  monthly_activity: number;
  active_leadership: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  achievements: 40,
  monthly_activity: 25,
  active_leadership: 35,
};

export interface ScoreInputs {
  achievements: number;
  monthlyActivity: number;
  activeLeadership: number;
  manualAdjustment?: number;
}

/**
 * Overall score = weighted sum of category scores (each 0–100) plus manual
 * adjustments. Mirrors the SQL function recalculate_overall_ranking(); keep
 * both in sync.
 */
export function computeOverallScore(
  inputs: ScoreInputs,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): number {
  const total = weights.achievements + weights.monthly_activity + weights.active_leadership;
  if (total <= 0) return 0;
  const weighted =
    (inputs.achievements * weights.achievements +
      inputs.monthlyActivity * weights.monthly_activity +
      inputs.activeLeadership * weights.active_leadership) /
    total;
  const withAdjustment = weighted + (inputs.manualAdjustment ?? 0);
  return Math.round(Math.max(0, Math.min(100, withAdjustment)) * 100) / 100;
}

export function validateWeights(weights: RankingWeights): string | null {
  const values = [weights.achievements, weights.monthly_activity, weights.active_leadership];
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) {
    return "Har bir og‘irlik 0 va 100 orasida bo‘lishi kerak";
  }
  const sum = values.reduce((a, b) => a + b, 0);
  if (Math.round(sum) !== 100) {
    return `Og‘irliklar yig‘indisi 100% bo‘lishi kerak (hozir ${sum}%)`;
  }
  return null;
}

export const RANKING_CATEGORY_META = {
  overall: { label: "Umumiy reyting", accent: "cyan" },
  achievements: { label: "Yutuqlar reytingi", accent: "lavender" },
  monthly_activity: { label: "Oylik faollik", accent: "mint" },
  active_leadership: { label: "Faol liderlik", accent: "peach" },
} as const;

export type RankingCategorySlug = keyof typeof RANKING_CATEGORY_META;
