import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import { milestoneKey, pointKey, qualifiesForPoints, type ReferralStage } from "./code";

/**
 * TAVSIYA BALLI.
 *
 * SHART (egasining qarori, 2026-10-01): ball FAQAT tavsiya qilingan
 * nomzod TO'LOV QILGAN **va** profili CHOP ETILGAN bo'lsa beriladi.
 * Ariza topshirish, ro'yxatdan o'tish va tekin qabul ball BERMAYDI.
 *
 * MAVJUD DAFTARDAN FOYDALANADI. Ikkinchi reyting dvigateli
 * YARATILMAYDI (§16): `point_ledger` o'zgarmas, `idempotency_key`
 * unikal va teskari yozuv uchun `reverses_ledger_id` bor.
 *
 * FRONTEND HECH QACHON BALL BERMAYDI (§16). Bu modul `server-only`.
 */

const MILESTONES = [5, 10, 25, 50, 100] as const;

export interface AwardResult {
  awarded: boolean;
  /** Nima uchun berilmagani — logga va adminga. */
  skipped?: "not_qualified" | "already_awarded" | "rule_missing" | "error";
  milestonesAwarded: number[];
}

/**
 * Tavsiya uchun ball beradi.
 *
 * IDEMPOTENT: `idempotency_key` unikal indeksi ikkinchi yozuvni
 * BAZADA to'sadi. Webhook ikki marta kelsa, ikkinchisi ball
 * qo'shmaydi — bu ilova mantig'i emas, bazaning kafolati.
 */
export async function awardReferralPoints(attributionId: string): Promise<AwardResult> {
  const db = createSupabaseAdminClient();

  const { data: attribution, error: readError } = await db
    .from("referral_attributions")
    .select("id, referrer_profile_id, referred_profile_id, candidate_id, stage")
    .eq("id", attributionId)
    .maybeSingle();

  if (readError || !attribution) {
    console.error("[referral] atributsiya o'qilmadi:", readError?.message);
    return { awarded: false, skipped: "error", milestonesAwarded: [] };
  }

  const referrerId = attribution.referrer_profile_id as string;
  const referredId = (attribution.referred_profile_id as string | null) ?? null;
  const stage = attribution.stage as ReferralStage;

  /*
   * NOMZOD CHOP ETILGANMI — ALOHIDA SO'ROV.
   *
   * Atributsiyadagi `candidate_id` ni o'qib "bor, demak chop etilgan"
   * deb qaramaymiz: nomzod yaratilgan bo'lib, hali `draft` holatda
   * turishi mumkin. Shart aynan NASHR haqida.
   */
  let referredPublished = false;
  const candidateId = (attribution.candidate_id as string | null) ?? null;

  if (candidateId) {
    const { data: candidate, error: candidateError } = await db
      .from("candidates")
      .select("status, deleted_at")
      .eq("id", candidateId)
      .maybeSingle();

    /*
     * O'QISH XATOSI "CHOP ETILMAGAN" EMAS.
     *
     * Avval xato e'tiborsiz qolardi va natija `not_qualified` bo'lardi —
     * ya'ni shart bajarilgan bo'lsa ham ball jimgina berilmasdi va
     * buni hech kim bilmasdi.
     */
    if (candidateError) {
      console.error("[referral] nomzod o'qilmadi:", candidateError.message);
      return { awarded: false, skipped: "error", milestonesAwarded: [] };
    }

    referredPublished =
      candidate?.status === "published" && candidate?.deleted_at === null;
  }

  const qualifies = qualifiesForPoints({
    stage,
    referredPublished,
    selfReferral: referredId !== null && referredId === referrerId,
  });

  if (!qualifies) {
    /*
     * BERILMAGANI — ODATIY HOLAT, nosozlik emas.
     *
     * To'lov hali tasdiqlanmagan yoki profil hali chop etilmagan
     * bo'lishi mumkin. Keyin shart bajarilganda bu funksiya qaytadan
     * chaqiriladi.
     */
    return { awarded: false, skipped: "not_qualified", milestonesAwarded: [] };
  }

  const ruleCode = "referral.payment_confirmed";
  const rule = await loadRule(ruleCode);
  if (!rule) return { awarded: false, skipped: "rule_missing", milestonesAwarded: [] };

  const written = await writeLedger({
    profileId: referrerId,
    ruleCode,
    category: rule.category,
    points: rule.points,
    idempotencyKey: pointKey(attributionId, "payment_confirmed"),
    sourceId: attributionId,
    note: "Shaxsiy tavsiya: to'lov tasdiqlangan va profil chop etilgan.",
  });

  if (written === "error") {
    return { awarded: false, skipped: "error", milestonesAwarded: [] };
  }

  if (written === "duplicate") {
    /*
     * Ball allaqachon berilgan. Milestone tekshiruvi SHUNDA HAM
     * bajariladi: oldingi urinish ball yozib, milestone yozishga
     * yetmasdan to'xtab qolgan bo'lishi mumkin.
     */
    return {
      awarded: false,
      skipped: "already_awarded",
      milestonesAwarded: await awardMilestones(referrerId),
    };
  }

  // Mukofot yozuvi — hisobot uchun; daftar bilan bog'langan.
  const { error: rewardError } = await db.from("referral_rewards").insert({
    attribution_id: attributionId,
    referrer_profile_id: referrerId,
    stage: "payment_confirmed",
    rule_code: ruleCode,
    points: rule.points,
  });

  if (rewardError) {
    /*
     * BALL ALLAQACHON DAFTARDA — u asosiy manba va o'zgarmas.
     *
     * Hisobot yozuvi yiqilsa, ball qaytarilmaydi, lekin buni
     * yashirmaymiz: milestone sanog'i shu jadvalga tayanadi va u
     * kam sanalardi.
     */
    console.error("[referral] mukofot yozuvi tushmadi:", {
      attributionId,
      message: rewardError.message,
    });
  }

  await recordAudit("referral.points.awarded", {
    actorId: null,
    entityId: attributionId,
    after: { points: rule.points },
    metadata: { referrer_profile_id: referrerId, rule: ruleCode },
  });

  return { awarded: true, milestonesAwarded: await awardMilestones(referrerId) };
}

/* ========================================================================= *
 * MILESTONE
 * ========================================================================= */

/**
 * Bosqich mukofotlari (5, 10, 25, 50, 100).
 *
 * TASDIQLANGAN tavsiyalar soni bo'yicha. "Tasdiqlangan" — ball
 * berilgan, ya'ni to'lov qilingan va profil chop etilgan.
 *
 * Har biri BIR MARTA: `idempotency_key` unikal.
 */
async function awardMilestones(referrerProfileId: string): Promise<number[]> {
  const db = createSupabaseAdminClient();

  const { count, error } = await db
    .from("referral_rewards")
    .select("id", { count: "exact", head: true })
    .eq("referrer_profile_id", referrerProfileId)
    .eq("stage", "payment_confirmed");

  if (error) {
    console.error("[referral] tavsiyalar sanalmadi:", error.message);
    return [];
  }

  const confirmed = count ?? 0;
  const awarded: number[] = [];

  for (const milestone of MILESTONES) {
    if (confirmed < milestone) break;

    const ruleCode = `referral.milestone_${milestone}`;
    const rule = await loadRule(ruleCode);
    if (!rule) continue;

    const written = await writeLedger({
      profileId: referrerProfileId,
      ruleCode,
      category: rule.category,
      points: rule.points,
      idempotencyKey: milestoneKey(referrerProfileId, milestone),
      sourceId: null,
      note: `Tavsiya bosqichi: ${milestone} ta tasdiqlangan tavsiya.`,
    });

    if (written === "inserted") {
      awarded.push(milestone);
      const { error: rewardError } = await db.from("referral_rewards").insert({
        referrer_profile_id: referrerProfileId,
        stage: `milestone_${milestone}`,
        rule_code: ruleCode,
        points: rule.points,
      });
      if (rewardError) {
        console.error("[referral] bosqich yozuvi tushmadi:", {
          referrerProfileId,
          milestone,
          message: rewardError.message,
        });
      }

      await recordAudit("referral.milestone.awarded", {
        actorId: null,
        entityId: referrerProfileId,
        after: { points: rule.points },
        metadata: { milestone, rule: ruleCode },
      });
    }
  }

  return awarded;
}

/* ========================================================================= *
 * TESKARI YOZUV
 * ========================================================================= */

/**
 * To'lov qaytarilganda ballni bekor qiladi (§17, §45).
 *
 * DAFTARDAN QATOR O'CHIRILMAYDI va O'ZGARTIRILMAYDI — u o'zgarmas.
 * O'rniga manfiy qiymatli YANGI yozuv qo'shiladi va u `reverses_ledger_id`
 * bilan asl yozuvga bog'lanadi.
 */
export async function reverseReferralPoints(
  attributionId: string,
  reason: string,
  /** Kim bekor qildi. `null` — avtomatik oqim (to'lov qaytarilgani haqidagi webhook). */
  actorId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  /*
   * SABAB MAJBURIY: ball — reytingga ta'sir qiladigan qiymat va uni
   * izohsiz olib qo'yish "nega reytingim tushdi" degan savolga
   * javobsiz qoldirardi.
   */
  if (reason.trim().length < 3) {
    return { ok: false, error: "Bekor qilish sababini yozing." };
  }

  const db = createSupabaseAdminClient();

  const key = pointKey(attributionId, "payment_confirmed");

  const { data: original, error } = await db
    .from("point_ledger")
    .select("id, profile_id, category, points, rule_code")
    .eq("idempotency_key", key)
    .maybeSingle();

  if (error) {
    console.error("[referral] asl yozuv o'qilmadi:", error.message);
    return { ok: false, error: "Ball yozuvini o'qib bo'lmadi." };
  }
  if (!original) return { ok: false, error: "Bekor qilinadigan ball topilmadi." };

  const { error: writeError } = await db.from("point_ledger").insert({
    profile_id: original.profile_id,
    rule_code: original.rule_code,
    category: original.category,
    source_type: "referral",
    source_id: attributionId,
    points: -(original.points as number),
    idempotency_key: `${key}:reversal`,
    reverses_ledger_id: original.id,
    note: reason.trim(),
  });

  if (writeError) {
    /*
     * 23505 — allaqachon bekor qilingan. Bu xato emas: takroriy
     * chaqiruv hech narsa o'zgartirmasligi kerak.
     */
    if (writeError.code === "23505") return { ok: true };
    console.error("[referral] teskari yozuv yozilmadi:", writeError.message);
    return { ok: false, error: "Ballni bekor qilib bo'lmadi." };
  }

  await recordAudit("referral.points.reversed", {
    actorId,
    entityId: attributionId,
    reason,
    before: { points: original.points as number },
    after: { points: 0 },
    metadata: { referrer_profile_id: original.profile_id as string },
  });

  return { ok: true };
}

/* ========================================================================= *
 * YORDAMCHILAR
 * ========================================================================= */

async function loadRule(
  code: string,
): Promise<{ category: string; points: number } | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("point_rules")
    .select("category, points, is_active")
    .eq("code", code)
    .maybeSingle();

  if (error || !data) {
    console.error("[referral] qoida o'qilmadi:", { code, message: error?.message });
    return null;
  }

  /*
   * O'CHIRILGAN QOIDA BALL BERMAYDI.
   *
   * Admin qoidani o'chirgan bo'lsa, bu ongli qaror — uni chetlab
   * o'tib ball yozish adminning qarorini bosib ketardi.
   */
  if (data.is_active !== true) return null;

  return { category: data.category as string, points: data.points as number };
}

async function writeLedger(input: {
  profileId: string;
  ruleCode: string;
  category: string;
  points: number;
  idempotencyKey: string;
  sourceId: string | null;
  note: string;
}): Promise<"inserted" | "duplicate" | "error"> {
  const db = createSupabaseAdminClient();

  const { error } = await db.from("point_ledger").insert({
    profile_id: input.profileId,
    rule_code: input.ruleCode,
    category: input.category,
    source_type: "referral",
    source_id: input.sourceId,
    points: input.points,
    idempotency_key: input.idempotencyKey,
    note: input.note,
  });

  if (!error) return "inserted";
  // 23505 — takrorlanmaslik kaliti: ball allaqachon berilgan.
  if (error.code === "23505") return "duplicate";

  console.error("[referral] daftarga yozilmadi:", error.message);
  return "error";
}
