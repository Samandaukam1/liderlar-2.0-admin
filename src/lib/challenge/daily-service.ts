import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/vip/audit-log";
import { grantVipDays, notifyMember } from "@/lib/vip/grant-service";
import { shiftCalendarDate, tashkentToday } from "@/lib/tashkent-day";
import { challengeEnded, challengeRewardDays, challengeWinnerMessage } from "./daily-rules";

export { challengeEnded };

/**
 * KUNLIK PREMIUM CHALLENGE — FON VAZIFASI.
 *
 * Natija va VIP bazada BITTA tranzaksiyada (`finalize_daily_challenge`):
 * cron qayta yurganda ham qayta yakunlanmaydi va qayta kun berilmaydi.
 * Bu yerda faqat: qaysi kunlar yakunlanishi kerak, xabarnomalar, jurnal.
 */

/** Necha kun orqaga qarab yakunlanmagan kunlar qidiriladi (cron uzilsa). */
const CATCH_UP_DAYS = 7;
/** Akkauntsiz g'olib keyin akkaunt ochsa — necha kungacha sovrin beriladi. */
const DEFERRED_DAYS = 30;

export interface ChallengeRunResult {
  finalized: string[];
  winnersNotified: number;
  deferredGranted: number;
  failed: number;
}

export async function runDailyChallenge(now: Date = new Date()): Promise<ChallengeRunResult> {
  const db = createSupabaseAdminClient();
  const result: ChallengeRunResult = { finalized: [], winnersNotified: 0, deferredGranted: 0, failed: 0 };

  const today = tashkentToday(now);
  const dates = Array.from({ length: CATCH_UP_DAYS }, (_, i) => shiftCalendarDate(today, -i))
    .filter((date) => challengeEnded(date, now))
    .reverse();

  if (dates.length === 0) {
    result.deferredGranted = await grantDeferredPrizes(today);
    return result;
  }

  const { data: done } = await db
    .from("daily_challenges")
    .select("challenge_date")
    .in("challenge_date", dates);
  const finalizedAlready = new Set((done ?? []).map((row) => row.challenge_date as string));

  for (const date of dates) {
    if (finalizedAlready.has(date)) continue;

    const { data, error } = await db.rpc("finalize_daily_challenge", { p_date: date });
    if (error) {
      console.error("[challenge] yakunlanmadi:", { date, message: error.message });
      result.failed += 1;
      continue;
    }

    const summary = data as {
      finalized?: boolean;
      participants?: number;
      winners?: { place: number; profile_id: string | null; views: number; days: number; status: string }[];
    } | null;
    if (!summary?.finalized) continue;

    result.finalized.push(date);
    await recordAudit("challenge.daily.finalized", {
      actorId: null,
      entityId: null,
      metadata: {
        date,
        participants: summary.participants ?? 0,
        winners: (summary.winners ?? []).map((w) => `${w.place}:${w.status}`).join(","),
      },
    });

    for (const winner of summary.winners ?? []) {
      if (winner.status !== "granted" || !winner.profile_id) continue;
      const message = challengeWinnerMessage(winner.place, winner.days);
      await notifyMember(winner.profile_id, message);
      result.winnersNotified += 1;
    }
  }

  result.deferredGranted = await grantDeferredPrizes(today);
  return result;
}

/**
 * Akkauntsiz g'olib keyin akkaunt ochsa — sovrin beriladi.
 *
 * Natija qatori o'zgarmas (`no_account` qoladi — tarix), lekin VIP o'sha
 * kalit (`daily-challenge:SANA:O'RIN`) bilan beriladi: bir marta.
 */
async function grantDeferredPrizes(today: string): Promise<number> {
  const db = createSupabaseAdminClient();
  const since = shiftCalendarDate(today, -DEFERRED_DAYS);

  const { data, error } = await db
    .from("daily_challenge_results")
    .select("challenge_date, position, candidate_id, candidates!inner(user_id)")
    .eq("reward_status", "no_account")
    .gte("challenge_date", since)
    .not("candidates.user_id", "is", null);

  if (error) {
    console.error("[challenge] kechiktirilgan sovrinlar o'qilmadi:", error.message);
    return 0;
  }

  let granted = 0;
  for (const row of data ?? []) {
    const candidate = (Array.isArray(row.candidates) ? row.candidates[0] : row.candidates) as { user_id: string } | null;
    const days = challengeRewardDays(row.position as number);
    if (!candidate?.user_id || days === 0) continue;

    const outcome = await grantVipDays({
      profileId: candidate.user_id,
      days,
      source: "daily_challenge",
      sourceId: `${row.challenge_date}:${row.position}`,
      idempotencyKey: `daily-challenge:${row.challenge_date}:${row.position}`,
      actorId: null,
      reason: `Kunlik Premium Challenge ${row.challenge_date} — ${row.position}-o'rin (akkaunt ochilgach)`,
    });
    if (outcome.granted) {
      granted += 1;
      await notifyMember(candidate.user_id, challengeWinnerMessage(row.position as number, days));
    }
  }
  return granted;
}

/* ========================================================================= *
 * ADMIN KUZATUVI
 * ========================================================================= */

export interface ChallengeStanding {
  place: number;
  candidateId: string;
  name: string;
  slug: string | null;
  views: number;
  reachedAt: string;
}

export async function loadLiveStandings(date: string, limit = 10): Promise<ChallengeStanding[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("daily_challenge_standings", { p_date: date, p_limit: limit });
  if (error) {
    console.error("[challenge] joriy natija o'qilmadi:", error.message);
    return [];
  }
  const rows = (data ?? []) as { place: number; candidate_id: string; views: number; reached_at: string }[];
  if (rows.length === 0) return [];

  const { data: candidates } = await db
    .from("candidates")
    .select("id, full_name, slug")
    .in("id", rows.map((r) => r.candidate_id));
  const byId = new Map((candidates ?? []).map((c) => [c.id as string, c]));

  return rows.map((r) => ({
    place: Number(r.place),
    candidateId: r.candidate_id,
    name: (byId.get(r.candidate_id)?.full_name as string) ?? "—",
    slug: (byId.get(r.candidate_id)?.slug as string | null) ?? null,
    views: Number(r.views),
    reachedAt: r.reached_at,
  }));
}

export interface FinalizedChallenge {
  date: string;
  participants: number;
  finalizedAt: string;
  results: {
    position: number;
    name: string;
    slug: string | null;
    views: number;
    rewardDays: number;
    rewardStatus: string;
    /** Akkauntsiz g'olibga keyin berilgan sovrin. */
    deferredGranted: boolean;
  }[];
}

export async function loadFinalizedChallenges(days = 30): Promise<FinalizedChallenge[]> {
  const db = createSupabaseAdminClient();
  const since = shiftCalendarDate(tashkentToday(), -days);

  const [{ data: challenges }, { data: results }, { data: grants }] = await Promise.all([
    db
      .from("daily_challenges")
      .select("challenge_date, participants, finalized_at")
      .gte("challenge_date", since)
      .order("challenge_date", { ascending: false }),
    db
      .from("daily_challenge_results")
      .select("challenge_date, position, views, reward_days, reward_status, candidates(full_name, slug)")
      .gte("challenge_date", since)
      .order("position", { ascending: true }),
    db.from("vip_grants").select("source_id").eq("source", "daily_challenge").gte("created_at", `${since}T00:00:00Z`),
  ]);

  const deferred = new Set((grants ?? []).map((g) => g.source_id as string));
  const byDate = new Map<string, FinalizedChallenge>();
  for (const c of challenges ?? []) {
    byDate.set(c.challenge_date as string, {
      date: c.challenge_date as string,
      participants: c.participants as number,
      finalizedAt: c.finalized_at as string,
      results: [],
    });
  }
  for (const r of results ?? []) {
    const candidate = (Array.isArray(r.candidates) ? r.candidates[0] : r.candidates) as
      | { full_name: string; slug: string | null }
      | null;
    byDate.get(r.challenge_date as string)?.results.push({
      position: r.position as number,
      name: candidate?.full_name ?? "—",
      slug: candidate?.slug ?? null,
      views: r.views as number,
      rewardDays: r.reward_days as number,
      rewardStatus: r.reward_status as string,
      deferredGranted:
        r.reward_status === "no_account" && deferred.has(`${r.challenge_date}:${r.position}`),
    });
  }
  return [...byDate.values()];
}
