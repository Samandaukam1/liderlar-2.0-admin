/**
 * Referral qoidalari — SOF MODUL.
 *
 * ASOSIY TAMOYIL (§31): ODAM O'ZIGA BIR NARSA SOTIB OLGANI UCHUN
 * REYTING BALLI OLMAYDI. Ball faqat HAQIQIY YANGI a'zo olib
 * kelgani uchun.
 */

export type ReferralStage =
  | "visited"
  | "application"
  | "registered"
  | "activated"
  | "payment_confirmed";

export type RewardStage =
  | "registered"
  | "activated"
  | "payment_confirmed"
  | "milestone_5"
  | "milestone_10"
  | "milestone_25"
  | "milestone_50"
  | "milestone_100";

export const REWARD_RULE_BY_STAGE: Readonly<Record<RewardStage, string>> = {
  registered: "referral.registered",
  activated: "referral.activated",
  payment_confirmed: "referral.paid",
  milestone_5: "referral.milestone_5",
  milestone_10: "referral.milestone_10",
  milestone_25: "referral.milestone_25",
  milestone_50: "referral.milestone_50",
  milestone_100: "referral.milestone_100",
};

export const MILESTONE_THRESHOLDS: readonly { count: number; stage: RewardStage }[] = [
  { count: 5, stage: "milestone_5" },
  { count: 10, stage: "milestone_10" },
  { count: 25, stage: "milestone_25" },
  { count: 50, stage: "milestone_50" },
  { count: 100, stage: "milestone_100" },
];

/** Bosqichlar tartibi — orqaga qaytish mumkin emas. */
const STAGE_ORDER: readonly ReferralStage[] = [
  "visited",
  "application",
  "registered",
  "activated",
  "payment_confirmed",
];

export function stageRank(stage: ReferralStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function canAdvance(from: ReferralStage, to: ReferralStage): boolean {
  return stageRank(to) > stageRank(from);
}

/** Bosqich → mukofot. Har bosqich mustaqil, biri ikkinchisini almashtirmaydi. */
const STAGE_REWARD: Readonly<Partial<Record<ReferralStage, RewardStage>>> = {
  registered: "registered",
  activated: "activated",
  payment_confirmed: "payment_confirmed",
};

export interface AttributionInput {
  referrerProfileId: string;
  referredProfileId: string | null;
  stage: ReferralStage;
}

export type ReferralDecision =
  | { award: true; stage: RewardStage; ruleCode: string; idempotencyKey: string }
  | { award: false; reason: "self_referral" | "no_reward_for_stage" | "already_awarded" };

export function referralLedgerKey(attributionId: string, stage: RewardStage): string {
  return `referral:${attributionId}:${stage}`;
}

export function milestoneLedgerKey(referrerProfileId: string, stage: RewardStage): string {
  return `referral_milestone:${referrerProfileId}:${stage}`;
}

/**
 * Bitta atributsiya uchun bosqich mukofotini hal qiladi.
 *
 * `alreadyAwarded` — shu atributsiya bo'yicha allaqachon berilgan
 * bosqichlar. Bu yerda tekshirilishi "qulaylik" uchun: haqiqiy
 * kafolat bazadagi unikal indeksda. Ikkalasi ham kerak — biri
 * foydalanuvchiga tushunarli javob beradi, ikkinchisi poygani
 * to'xtatadi.
 */
export function decideReferralReward(
  attributionId: string,
  input: AttributionInput,
  alreadyAwarded: readonly RewardStage[],
): ReferralDecision {
  /*
   * O'ZINI O'ZI TAKLIF QILISH.
   *
   * Bu shunchaki firibgarlik emas — tizimning butun ma'nosiga zid:
   * "yangi odam olib kelish" o'rniga "o'ziga to'lash" ball berardi.
   */
  if (input.referredProfileId && input.referredProfileId === input.referrerProfileId) {
    return { award: false, reason: "self_referral" };
  }

  const stage = STAGE_REWARD[input.stage];
  if (!stage) return { award: false, reason: "no_reward_for_stage" };

  if (alreadyAwarded.includes(stage)) return { award: false, reason: "already_awarded" };

  return {
    award: true,
    stage,
    ruleCode: REWARD_RULE_BY_STAGE[stage],
    idempotencyKey: referralLedgerKey(attributionId, stage),
  };
}

/**
 * Marralar (§30).
 *
 * Faqat TO'LOVI TASDIQLANGAN takliflar sanaladi. Ro'yxatdan
 * o'tgan, lekin to'lamagan odamlar marraga hissa qo'shmaydi —
 * aks holda bo'sh akkauntlar yasab marra olish mumkin bo'lardi.
 */
export function pendingMilestones(
  confirmedPaidCount: number,
  alreadyAwarded: readonly RewardStage[],
): RewardStage[] {
  return MILESTONE_THRESHOLDS.filter(
    (m) => confirmedPaidCount >= m.count && !alreadyAwarded.includes(m.stage),
  ).map((m) => m.stage);
}
