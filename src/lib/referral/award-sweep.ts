import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import { awardReferralPoints } from "./award-service";
import { pointKey, type ReferralStage } from "./code";
import { phoneKey, pickIntakeForApplication, type PaidIntake } from "./intake-match";

/**
 * TAVSIYA BALLARINI BERISH — FON VAZIFASI.
 *
 * NEGA TO'LOV YOKI NASHR JOYIGA CHAQIRUV EMAS: to'lov bir necha yo'l
 * bilan tasdiqlanadi (bot tugmasi, tahrirchi, bekor qilish), nashr esa
 * pipeline, batch yoki qo'lda bo'ladi. Har biriga chaqiruv qo'shish
 * bittasini unutishga olib kelardi. Bu vazifa esa NATIJAGA qaraydi:
 * anketa to'langan va nomzod chop etilgan bo'lsa — qaysi yo'l bilan
 * bo'lgani ahamiyatsiz.
 *
 * QAYTA ISHGA TUSHIRISHGA XAVFSIZ: bosqich faqat oldinga siljiydi
 * (yozishda ham shart), ball esa `point_ledger.idempotency_key`
 * unikal indeksi bilan bir marta tushadi.
 *
 * AVTOMATIK BEKOR QILISH YO'Q: nashrdan olish ko'pincha vaqtinchalik
 * (tahrir), bekor qilingan ball esa o'sha kalit band bo'lgani uchun
 * qayta berilmaydi. Bekor qilish — `reverseReferralPoints` orqali qo'lda.
 */

/**
 * Necha kunlik atributsiyalar ko'riladi.
 *
 * To'lov odatda ariza kunidan bir necha kun ichida bo'ladi (bot 14 kun
 * so'raydi). Oyna har yurishdagi so'rovlar sonini chegaralaydi: aks
 * holda hech qachon to'lamaganlar ro'yxati cheksiz o'sib borardi.
 */
export const ATTRIBUTION_WINDOW_DAYS = 90;

/** PostgREST bitta javobda 1000 qatordan ko'p bermaydi. */
const PAGE_SIZE = 1000;

/** Bitta `or=(...)` filtridagi telefonlar — URL uzunligi chegarasi uchun. */
const PHONE_CHUNK = 40;

const OPEN_STAGES: readonly ReferralStage[] = ["visited", "application", "registered", "activated"];

export interface AwardSweepResult {
  /** Ko'rilgan ochiq (to'lovgacha bo'lgan) atributsiyalar. */
  checked: number;
  /** `payment_confirmed` ga siljitilganlar. */
  linked: number;
  /** To'lov, nomzod yoki nashr hali yo'q — keyingi yurishda. */
  waiting: number;
  /** Bitta raqamda bir nechta to'langan anketa — admin ko'rigi kerak. */
  ambiguous: number;
  /** Nomzod boshqa tavsiyachiga bog'langan yoki to'lov arizadan oldin. */
  rejected: number;
  awarded: number;
  failed: number;
}

export async function sweepReferralAwards(): Promise<AwardSweepResult> {
  const result: AwardSweepResult = {
    checked: 0,
    linked: 0,
    waiting: 0,
    ambiguous: 0,
    rejected: 0,
    awarded: 0,
    failed: 0,
  };

  const since = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 86_400_000).toISOString();

  await linkPaidIntakes(since, result);
  await awardPublished(since, result);

  /*
   * Bitta yig'ma yozuv, har atributsiya uchun emas: siljish va ball
   * o'zining alohida hodisasini yozadi, bu esa faqat "vazifa yurdi"
   * degan iz.
   */
  if (result.linked > 0 || result.awarded > 0 || result.ambiguous > 0) {
    console.info("[referral] ball sweep:", result);
  }

  return result;
}

/* ========================================================================= *
 * 1. ARIZA -> TO'LANGAN ANKETA -> NOMZOD
 * ========================================================================= */

interface OpenAttribution {
  id: string;
  referrerProfileId: string;
  stage: ReferralStage;
  applicationCreatedAt: string;
  phoneKey: string | null;
}

async function linkPaidIntakes(since: string, result: AwardSweepResult): Promise<void> {
  const db = createSupabaseAdminClient();

  const open = await loadOpenAttributions(since);
  if (open === null) {
    result.failed += 1;
    return;
  }
  result.checked = open.length;
  if (open.length === 0) return;

  const keys = [...new Set(open.map((a) => a.phoneKey).filter((k): k is string => k !== null))];
  const intakesByKey = await loadPaidIntakesByPhone(keys);
  if (intakesByKey === null) {
    result.failed += 1;
    return;
  }

  // Shu nomzodlarga allaqachon bog'langan atributsiyalar.
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

  for (const chunk of chunks(candidateIds, PAGE_SIZE / 5)) {
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

  /*
   * ENG ESKI ATRIBUTSIYA BIRINCHI: bitta raqamdan ikki ariza ikki xil
   * kod bilan kelsa, birinchi tavsiya saqlanadi (§15).
   */
  for (const attribution of open) {
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

    // O'ziga o'zi tavsiya — bazadagi `referral_no_self` ham to'sadi.
    if (referredProfileId !== null && referredProfileId === attribution.referrerProfileId) {
      result.rejected += 1;
      continue;
    }

    const patch: Record<string, unknown> = {
      stage: "payment_confirmed",
      candidate_id: match.candidateId,
    };
    if (referredProfileId) patch.referred_profile_id = referredProfileId;

    const { data: moved, error } = await db
      .from("referral_attributions")
      .update(patch)
      .eq("id", attribution.id)
      /*
       * BOSQICH SHARTI YOZISHDA HAM: o'qish va yozish orasida boshqa
       * oqim bosqichni siljitgan bo'lsa, eskisi ustidan yozilmaydi.
       */
      .eq("stage", attribution.stage)
      .select("id")
      .maybeSingle();

    if (error) {
      // 23505 — bu akkaunt allaqachon boshqa atributsiyada (`uq_referral_attributions_referred`).
      if (error.code === "23505") {
        result.rejected += 1;
      } else {
        console.error("[referral] bosqich siljitilmadi:", { id: attribution.id, message: error.message });
        result.failed += 1;
      }
      continue;
    }
    if (!moved) continue;

    claimed.add(match.candidateId);
    result.linked += 1;

    await recordAudit("referral.attribution.advanced", {
      actorId: null,
      entityId: attribution.id,
      before: { stage: attribution.stage },
      after: { stage: "payment_confirmed" },
      metadata: {
        referrer_profile_id: attribution.referrerProfileId,
        candidate_id: match.candidateId,
        intake_id: match.intakeId,
        matched_by: "phone",
      },
    });
  }
}

async function loadOpenAttributions(since: string): Promise<OpenAttribution[] | null> {
  const db = createSupabaseAdminClient();
  const rows: OpenAttribution[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("referral_attributions")
      .select("id, referrer_profile_id, stage, application:applications(phone, created_at)")
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
        applicationCreatedAt: application.created_at,
        phoneKey: phoneKey(application.phone),
      });
    }

    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

async function loadPaidIntakesByPhone(keys: string[]): Promise<Map<string, PaidIntake[]> | null> {
  const db = createSupabaseAdminClient();
  const byKey = new Map<string, PaidIntake[]>();

  for (const chunk of chunks(keys, PHONE_CHUNK)) {
    // Kalit faqat raqamlardan iborat — filtr satriga xavfsiz qo'yiladi.
    const { data, error } = await db
      .from("candidate_intakes")
      .select("id, candidate_id, phone_e164, payment_confirmed_at")
      .eq("payment_status", "paid")
      .is("deleted_at", null)
      .or(chunk.map((key) => `phone_e164.like.*${key}`).join(","));

    if (error) {
      console.error("[referral] to'langan anketalar o'qilmadi:", error.message);
      return null;
    }

    for (const row of data ?? []) {
      const key = phoneKey(row.phone_e164 as string | null);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push({
        intakeId: row.id as string,
        candidateId: (row.candidate_id as string | null) ?? null,
        paymentConfirmedAt: (row.payment_confirmed_at as string | null) ?? null,
      });
      byKey.set(key, list);
    }
  }

  return byKey;
}

/* ========================================================================= *
 * 2. TO'LANGAN + CHOP ETILGAN -> BALL
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

async function awardPage(
  rows: { id: string; candidate_id: string }[],
  result: AwardSweepResult,
): Promise<void> {
  const db = createSupabaseAdminClient();

  for (const page of chunks(rows, PAGE_SIZE / 5)) {
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

      /*
       * TO'LOV BEKOR QILINGAN BO'LSA — BALL YO'Q.
       *
       * Bog'langandan keyin tahrirchi to'lovni bekor qilishi mumkin
       * (`undoPaymentConfirmation`). Shart "to'lov qilgan VA chop
       * etilgan" — birinchisi endi bajarilmaydi.
       */
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

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
