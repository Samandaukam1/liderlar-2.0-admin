/**
 * MEHR ball qoidalari — SOF MODUL.
 *
 * Bu yerda baza ham, tarmoq ham yo'q: faqat "kim qancha ball oladi"
 * va "bu ball allaqachon berilganmi" degan savollarga javob.
 *
 * Nega alohida: tasdiqlash amali murakkab (tranzaksiya, sertifikat,
 * bildirishnoma). Agar ball hisobi ham o'sha yerda bo'lsa, uni
 * tekshirish uchun har safar butun tasdiqni ishga tushirish kerak
 * bo'lardi. Sof modul esa to'g'ridan-to'g'ri sinaladi.
 */

export type PointCategory =
  | "ijtimoiy_tasir"
  | "yetakchilik"
  | "intellektual"
  | "yutuqlar"
  | "jamiyatga_hissa";

export type ParticipantRole = "participant" | "co_organizer" | "organizer";

export interface PointRule {
  code: string;
  category: PointCategory;
  points: number;
  isActive: boolean;
}

/** Rol → qoida kodi. Boshqa joyda qo'lda yozilmasligi uchun shu yerda. */
export const MEHR_RULE_BY_ROLE: Readonly<Record<ParticipantRole, string>> = {
  participant: "mehr.participant",
  co_organizer: "mehr.co_organizer",
  organizer: "mehr.organizer",
};

/**
 * TAKRORLANMASLIK KALITI.
 *
 * Aynan shu satr bazada unikal indeks ostida turadi. Ya'ni tasdiq
 * necha marta qayta ishga tushsa ham, ball bir marta tushadi —
 * "avval tekshirib, keyin yozish" emas, bazaning o'z kafolati.
 *
 * Tarkibi ataylab to'liq: manba turi + tadbir + rol + odam. Rolni
 * tashlab ketsak, tashkilotchi bir vaqtning o'zida ishtirokchi
 * ham bo'lgan holatda ikkinchi ball yo'qolardi.
 */
export function mehrLedgerKey(
  activityId: string,
  profileId: string,
  role: ParticipantRole,
): string {
  return `mehr_activity:${activityId}:${role}:${profileId}`;
}

/** Teskari (tuzatuvchi) yozuv kaliti — asl yozuvdan farq qilishi shart. */
export function reversalLedgerKey(originalKey: string, reason: string): string {
  const slug = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `reversal:${originalKey}:${slug || "tuzatish"}`;
}

export interface AwardInput {
  activityId: string;
  profileId: string;
  role: ParticipantRole;
}

export interface AwardEntry {
  profileId: string;
  ruleCode: string;
  category: PointCategory;
  points: number;
  idempotencyKey: string;
  sourceType: "mehr_activity";
  sourceId: string;
}

export interface AwardPlan {
  entries: AwardEntry[];
  /** Qoidasi topilmagan yoki o'chirilgan rollar — jimgina tashlanmaydi. */
  skipped: { profileId: string; role: ParticipantRole; reason: string }[];
}

/**
 * Tasdiqlangan tadbir uchun ball rejasi.
 *
 * REJA — YOZUV EMAS. Bu funksiya hech nimani saqlamaydi; u faqat
 * "nima bo'lishi kerak"ni aytadi. Yozishni chaqiruvchi tranzaksiya
 * ichida bajaradi.
 */
export function planActivityAwards(
  participants: readonly AwardInput[],
  rules: readonly PointRule[],
): AwardPlan {
  const byCode = new Map(rules.map((r) => [r.code, r]));
  const entries: AwardEntry[] = [];
  const skipped: AwardPlan["skipped"] = [];

  /*
   * Bir odam bitta tadbirda bitta roldan ko'p bo'lmasligi kerak,
   * lekin kiruvchi ro'yxat buzuq bo'lsa ham ikki marta ball
   * yozmaymiz: kalit bo'yicha filtrlaymiz.
   */
  const seen = new Set<string>();

  for (const p of participants) {
    const code = MEHR_RULE_BY_ROLE[p.role];
    const rule = byCode.get(code);

    if (!rule) {
      skipped.push({ profileId: p.profileId, role: p.role, reason: "qoida topilmadi" });
      continue;
    }
    if (!rule.isActive) {
      skipped.push({ profileId: p.profileId, role: p.role, reason: "qoida o'chirilgan" });
      continue;
    }

    const key = mehrLedgerKey(p.activityId, p.profileId, p.role);
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({
      profileId: p.profileId,
      ruleCode: rule.code,
      category: rule.category,
      points: rule.points,
      idempotencyKey: key,
      sourceType: "mehr_activity",
      sourceId: p.activityId,
    });
  }

  return { entries, skipped };
}

/**
 * Referral hissasining umumiy reytingga ta'sirini cheklash (§31).
 *
 * Xom ball KAMAYTIRILMAYDI — a'zo o'z mehnatini to'liq ko'radi.
 * Cheklov faqat reyting hisobida qo'llanadi: pul bilan birinchi
 * o'rinni sotib olish yo'lini yopish uchun.
 */
export function cappedReferralContribution(
  referralPoints: number,
  otherPoints: number,
  capPercent: number,
): number {
  if (referralPoints <= 0) return 0;

  const pct = Math.min(Math.max(capPercent, 0), 100);
  if (pct >= 100) return referralPoints;
  if (pct === 0) return 0;

  /*
   * Cheklov: referral yakuniy summaning `pct` foizidan oshmasin.
   *
   *   r <= pct/100 * (other + r)   =>   r <= other * pct / (100 - pct)
   *
   * Ya'ni boshqa manbalardan ball yig'ilgani sari referral ham
   * ko'proq "sig'adi". Hech narsa qilmagan odam uchun other = 0
   * bo'lib, referral hissasi ham 0 bo'ladi — aynan shu kerak.
   */
  const maxAllowed = Math.floor((otherPoints * pct) / (100 - pct));
  return Math.min(referralPoints, maxAllowed);
}
