import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import { grantReferralVip, notifyMember } from "@/lib/vip/grant-service";
import { awardReferralPoints } from "./award-service";
import { pointKey, type ReferralStage } from "./code";
import { earliest, phoneKey, pickIntakeForApplication, type QualifiedIntake } from "./intake-match";

/**
 * TAVSIYA MUKOFOTLARI — FON VAZIFASI.
 *
 * IKKI XIL MUKOFOT, IKKI XIL SHART:
 *   · BALL (reyting, avvalgi qoida): to'lov TASDIQLANGAN **va** nomzod
 *     CHOP ETILGAN;
 *   · VIP KUNLARI (2026-10-04 qoidasi): nomzod CHOP ETILGAN — har biri
 *     +10 kun, ko'pi bilan 30 (`vip_grant_referral_reward`, bazada).
 *
 * NEGA TO'LOV YOKI NASHR JOYIGA CHAQIRUV EMAS: ular bir necha yo'l bilan
 * bo'ladi (bot, tahrirchi, pipeline, batch, qo'lda). Vazifa NATIJAGA
 * qaraydi — qaysi yo'l bilan bo'lgani ahamiyatsiz.
 *
 * QAYTA YURISHGA XAVFSIZ: bosqich faqat oldinga siljiydi, ball
 * `point_ledger.idempotency_key`, VIP esa `vip_grants.idempotency_key`
 * bilan bir marta yoziladi.
 *
 * AVTOMATIK BEKOR QILISH YO'Q: nashrdan olish ko'pincha vaqtinchalik.
 */

/** Necha kunlik atributsiyalar ko'riladi (so'rovlar sonini chegaralaydi). */
export const ATTRIBUTION_WINDOW_DAYS = 90;

/** PostgREST bitta javobda 1000 qatordan ko'p bermaydi. */
const PAGE_SIZE = 1000;

/** Bitta `or=(...)` filtridagi telefonlar — URL uzunligi chegarasi uchun. */
const PHONE_CHUNK = 40;

const OPEN_STAGES: readonly ReferralStage[] = ["visited", "application", "registered", "activated"];

export interface AwardSweepResult {
  /** Ko'rilgan ochiq (to'lovgacha bo'lgan) atributsiyalar. */
  checked: number;
  /** Nomzodga bog'langanlar (telefon orqali). */
  linked: number;
  /** Bog'langan atributsiya keyin to'lov oldi -> `payment_confirmed`. */
  paymentConfirmed: number;
  /** Mos anketa, nomzod yoki nashr hali yo'q — keyingi yurishda. */
  waiting: number;
  /** Bitta raqamda bir nechta mos anketa — admin ko'rigi kerak. */
  ambiguous: number;
  /** Nomzod boshqa tavsiyachiga bog'langan yoki saralanish arizadan oldin. */
  rejected: number;
  /** Reyting balli berildi. */
  awarded: number;
  /** VIP kunlari berildi (+10). */
  vipGranted: number;
  failed: number;
}

export async function sweepReferralAwards(): Promise<AwardSweepResult> {
  const result: AwardSweepResult = {
    checked: 0,
    linked: 0,
    paymentConfirmed: 0,
    waiting: 0,
    ambiguous: 0,
    rejected: 0,
    awarded: 0,
    vipGranted: 0,
    failed: 0,
  };

  const since = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 86_400_000).toISOString();

  await linkQualifiedIntakes(since, result);
  await awardPublished(since, result);
  await grantVipForPublished(since, result);

  if (result.linked > 0 || result.awarded > 0 || result.vipGranted > 0 || result.ambiguous > 0) {
    console.info("[referral] mukofot sweep:", result);
  }

  return result;
}

/* ========================================================================= *
 * 1. ARIZA -> (TO'LANGAN YOKI CHOP ETILGAN) ANKETA -> NOMZOD
 * ========================================================================= */

interface OpenAttribution {
  id: string;
  referrerProfileId: string;
  stage: ReferralStage;
  candidateId: string | null;
  applicationCreatedAt: string;
  phoneKey: string | null;
}

interface IntakeRow extends QualifiedIntake {
  phoneKey: string | null;
}

async function linkQualifiedIntakes(since: string, result: AwardSweepResult): Promise<void> {
  const db = createSupabaseAdminClient();

  const open = await loadOpenAttributions(since);
  if (open === null) {
    result.failed += 1;
    return;
  }
  result.checked = open.length;
  if (open.length === 0) return;

  /*
   * ALLAQACHON BOG'LANGAN, LEKIN HALI TO'LANMAGAN atributsiyalar: nomzod
   * to'lovsiz chop etilgan (VIP uchun yetarli). Keyin to'lov kelsa —
   * bosqich `payment_confirmed` ga siljiydi va ball sharti ochiladi.
   */
  const linked = open.filter((a) => a.candidateId !== null);
  if (linked.length > 0) {
    const { data: paidRows, error } = await db
      .from("candidate_intakes")
      .select("candidate_id")
      .eq("payment_status", "paid")
      .is("deleted_at", null)
      .in("candidate_id", linked.map((a) => a.candidateId as string));
    if (error) {
      console.error("[referral] to'lov holati o'qilmadi:", error.message);
      result.failed += 1;
    } else {
      const paid = new Set((paidRows ?? []).map((r) => r.candidate_id as string));
      for (const attribution of linked) {
        if (!paid.has(attribution.candidateId as string)) continue;
        if (await advanceStage(attribution, "payment_confirmed", {})) result.paymentConfirmed += 1;
      }
    }
  }

  const unlinked = open.filter((a) => a.candidateId === null);
  if (unlinked.length === 0) return;

  const keys = [...new Set(unlinked.map((a) => a.phoneKey).filter((k): k is string => k !== null))];
  const intakesByKey = await loadQualifiedIntakesByPhone(keys);
  if (intakesByKey === null) {
    result.failed += 1;
    return;
  }

  const candidateIds = [
    ...new Set(
      [...intakesByKey.values()]
        .flat()
        .map((i) => i.candidateId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const claimed = new Set<string>();
  const owners = new Map<string, string | null>();

  for (const chunk of chunks(candidateIds, 200)) {
    const [{ data: taken, error: takenError }, { data: candidates, error: candidateError }] =
      await Promise.all([
        db.from("referral_attributions").select("candidate_id").in("candidate_id", chunk),
        db.from("candidates").select("id, user_id").in("id", chunk),
      ]);
    if (takenError || candidateError) {
      console.error("[referral] nomzodlar o'qilmadi:", takenError?.message ?? candidateError?.message);
      result.failed += 1;
      return;
    }
    for (const row of taken ?? []) claimed.add(row.candidate_id as string);
    for (const row of candidates ?? []) owners.set(row.id as string, (row.user_id as string | null) ?? null);
  }

  // ENG ESKI ATRIBUTSIYA BIRINCHI (§15): birinchi tavsiya saqlanadi.
  for (const attribution of unlinked) {
    const match = pickIntakeForApplication({
      applicationCreatedAt: attribution.applicationCreatedAt,
      intakes: attribution.phoneKey ? (intakesByKey.get(attribution.phoneKey) ?? []) : [],
      claimedCandidateIds: claimed,
    });

    if (match.kind === "waiting") {
      result.waiting += 1;
      continue;
    }
    if (match.kind === "ambiguous") {
      result.ambiguous += 1;
      continue;
    }
    if (match.kind !== "match") {
      result.rejected += 1;
      continue;
    }

    const referredProfileId = owners.get(match.candidateId) ?? null;
    if (referredProfileId !== null && referredProfileId === attribution.referrerProfileId) {
      result.rejected += 1; // o'ziga o'zi tavsiya
      continue;
    }

    const patch: Record<string, unknown> = { candidate_id: match.candidateId };
    if (referredProfileId) patch.referred_profile_id = referredProfileId;

    const moved = await advanceStage(attribution, match.paid ? "payment_confirmed" : null, patch);
    if (moved === "conflict") {
      result.rejected += 1;
      continue;
    }
    if (!moved) continue;

    claimed.add(match.candidateId);
    result.linked += 1;

    await recordAudit("referral.attribution.advanced", {
      actorId: null,
      entityId: attribution.id,
      before: { stage: attribution.stage },
      after: { stage: match.paid ? "payment_confirmed" : attribution.stage },
      metadata: {
        referrer_profile_id: attribution.referrerProfileId,
        candidate_id: match.candidateId,
        intake_id: match.intakeId,
        matched_by: "phone",
        paid: match.paid,
      },
    });
  }
}

/**
 * Atributsiyani yangilaydi: bosqich (ixtiyoriy) + bog'lanishlar.
 *
 * BOSQICH SHARTI YOZISHDA HAM: o'qish va yozish orasida boshqa oqim
 * bosqichni siljitgan bo'lsa, eskisi ustidan yozilmaydi.
 */
async function advanceStage(
  attribution: OpenAttribution,
  nextStage: ReferralStage | null,
  patch: Record<string, unknown>,
): Promise<boolean | "conflict"> {
  const db = createSupabaseAdminClient();
  const update = nextStage ? { ...patch, stage: nextStage } : patch;
  if (Object.keys(update).length === 0) return false;

  const { data, error } = await db
    .from("referral_attributions")
    .update(update)
    .eq("id", attribution.id)
    .eq("stage", attribution.stage)
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 — akkaunt allaqachon boshqa atributsiyada (`uq_referral_attributions_referred`).
    if (error.code === "23505") return "conflict";
    console.error("[referral] atributsiya yangilanmadi:", { id: attribution.id, message: error.message });
    return false;
  }
  return Boolean(data);
}

async function loadOpenAttributions(since: string): Promise<OpenAttribution[] | null> {
  const db = createSupabaseAdminClient();
  const rows: OpenAttribution[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("referral_attributions")
      .select("id, referrer_profile_id, stage, candidate_id, application:applications(phone, created_at)")
      .in("stage", OPEN_STAGES)
      .not("application_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[referral] ochiq atributsiyalar o'qilmadi:", error.message);
      return null;
    }

    for (const row of data ?? []) {
      const application = (Array.isArray(row.application) ? row.application[0] : row.application) as
        | { phone: string | null; created_at: string }
        | null
        | undefined;
      if (!application) continue;
      rows.push({
        id: row.id as string,
        referrerProfileId: row.referrer_profile_id as string,
        stage: row.stage as ReferralStage,
        candidateId: (row.candidate_id as string | null) ?? null,
        applicationCreatedAt: application.created_at,
        phoneKey: phoneKey(application.phone),
      });
    }

    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

/**
 * Telefon bo'yicha TO'LANGAN yoki nomzodi CHOP ETILGAN anketalar.
 *
 * Ikki so'rov: to'langanlar va nomzodi bor anketalar; ikkinchisi
 * nomzodning nashr holati bilan filtrlanadi.
 */
async function loadQualifiedIntakesByPhone(keys: string[]): Promise<Map<string, IntakeRow[]> | null> {
  const db = createSupabaseAdminClient();
  const byId = new Map<string, IntakeRow>();

  for (const chunk of chunks(keys, PHONE_CHUNK)) {
    // Kalit faqat raqamlardan iborat — filtr satriga xavfsiz qo'yiladi.
    const { data, error } = await db
      .from("candidate_intakes")
      .select(
        "id, candidate_id, phone_e164, payment_status, payment_confirmed_at, " +
          "candidate:candidates!candidate_intakes_candidate_id_fkey(status, deleted_at, published_at)",
      )
      .is("deleted_at", null)
      .or(chunk.map((key) => `phone_e164.like.*${key}`).join(","));

    if (error) {
      console.error("[referral] anketalar o'qilmadi:", error.message);
      return null;
    }

    for (const raw of (data ?? []) as unknown as Record<string, unknown>[]) {
      const candidate = (Array.isArray(raw.candidate) ? raw.candidate[0] : raw.candidate) as
        | { status: string; deleted_at: string | null; published_at: string | null }
        | null
        | undefined;
      const paid = raw.payment_status === "paid";
      const published = candidate?.status === "published" && candidate.deleted_at === null;
      if (!paid && !published) continue;

      byId.set(raw.id as string, {
        intakeId: raw.id as string,
        candidateId: (raw.candidate_id as string | null) ?? null,
        paid,
        qualifiedAt: earliest(
          paid ? ((raw.payment_confirmed_at as string | null) ?? null) : null,
          published ? (candidate?.published_at ?? null) : null,
        ),
        phoneKey: phoneKey(raw.phone_e164 as string | null),
      });
    }
  }

  const byKey = new Map<string, IntakeRow[]>();
  for (const intake of byId.values()) {
    if (!intake.phoneKey) continue;
    const list = byKey.get(intake.phoneKey) ?? [];
    list.push(intake);
    byKey.set(intake.phoneKey, list);
  }
  return byKey;
}

/* ========================================================================= *
 * 2. TO'LANGAN + CHOP ETILGAN -> BALL (avvalgi qoida)
 * ========================================================================= */

async function awardPublished(since: string, result: AwardSweepResult): Promise<void> {
  const db = createSupabaseAdminClient();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("referral_attributions")
      .select("id, candidate_id")
      .eq("stage", "payment_confirmed")
      .not("candidate_id", "is", null)
      .gte("updated_at", since)
      .order("updated_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[referral] tasdiqlangan atributsiyalar o'qilmadi:", error.message);
      result.failed += 1;
      return;
    }

    const rows = (data ?? []) as { id: string; candidate_id: string }[];
    if (rows.length > 0) await awardPage(rows, result);
    if (rows.length < PAGE_SIZE) return;
  }
}

async function awardPage(rows: { id: string; candidate_id: string }[], result: AwardSweepResult): Promise<void> {
  const db = createSupabaseAdminClient();

  for (const page of chunks(rows, 200)) {
    const [{ data: ledger, error: ledgerError }, { data: paid, error: paidError }] = await Promise.all([
      db
        .from("point_ledger")
        .select("idempotency_key")
        .in("idempotency_key", page.map((r) => pointKey(r.id, "payment_confirmed"))),
      db
        .from("candidate_intakes")
        .select("candidate_id")
        .eq("payment_status", "paid")
        .is("deleted_at", null)
        .in("candidate_id", page.map((r) => r.candidate_id)),
    ]);

    if (ledgerError || paidError) {
      console.error("[referral] ball holati o'qilmadi:", ledgerError?.message ?? paidError?.message);
      result.failed += 1;
      return;
    }

    const done = new Set((ledger ?? []).map((r) => r.idempotency_key as string));
    const stillPaid = new Set((paid ?? []).map((r) => r.candidate_id as string));

    for (const row of page) {
      if (done.has(pointKey(row.id, "payment_confirmed"))) continue;
      // To'lov bekor qilingan bo'lsa (`undoPaymentConfirmation`) — ball yo'q.
      if (!stillPaid.has(row.candidate_id)) {
        result.waiting += 1;
        continue;
      }
      // Nashr holatini `awardReferralPoints` o'zi tekshiradi.
      const award = await awardReferralPoints(row.id);
      if (award.awarded) result.awarded += 1;
      else if (award.skipped === "error" || award.skipped === "rule_missing") result.failed += 1;
      else if (award.skipped === "not_qualified") result.waiting += 1;
    }
  }
}

/* ========================================================================= *
 * 3. CHOP ETILGAN -> VIP KUNLARI (+10, ko'pi bilan 30)
 * ========================================================================= */

async function grantVipForPublished(since: string, result: AwardSweepResult): Promise<void> {
  const db = createSupabaseAdminClient();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("referral_attributions")
      .select("id, referrer_profile_id, candidate_id")
      .not("candidate_id", "is", null)
      .gte("updated_at", since)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[referral] VIP uchun atributsiyalar o'qilmadi:", error.message);
      result.failed += 1;
      return;
    }

    const rows = (data ?? []) as { id: string; referrer_profile_id: string; candidate_id: string }[];

    for (const page of chunks(rows, 200)) {
      const { data: grants, error: grantsError } = await db
        .from("vip_grants")
        .select("idempotency_key")
        .in("idempotency_key", page.map((r) => `referral-vip:${r.id}`));
      if (grantsError) {
        console.error("[referral] VIP berilganlar o'qilmadi:", grantsError.message);
        result.failed += 1;
        return;
      }
      const done = new Set((grants ?? []).map((g) => g.idempotency_key as string));

      for (const row of page) {
        if (done.has(`referral-vip:${row.id}`)) continue;
        // Nashr, o'ziga o'zi, bir nomzod bir marta va 30 kunlik cheklov — BAZADA.
        const outcome = await grantReferralVip(row.referrer_profile_id, row.id);
        if (!outcome.ok) {
          result.failed += 1;
          continue;
        }
        if (!outcome.granted) continue;
        result.vipGranted += 1;
        await notifyMember(row.referrer_profile_id, {
          title: "VIP obunangizga 10 kun qo'shildi",
          body: "Promo-kodingiz orqali taklif qilingan nomzodning maqolasi chop etildi.",
          link: "/kabinet",
        });
      }
    }

    if (rows.length < PAGE_SIZE) return;
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
