import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCoordinatorSettings } from "./settings.ts";
import { businessDate, businessDayRange } from "./routing-rules.ts";
import {
  firstToTarget,
  mostEfficient,
  mostSales,
  resolveTarget,
  targetProgress,
  targetState,
  type CoordinatorDayStats,
  type DailyTargetRow,
  type TargetState,
} from "./targets.ts";

/**
 * KOORDINATORLAR BOSHQARUV PANELI — hisob-kitob.
 *
 * IKKI XIL O'LCHOV VA ULAR ARALASHTIRILMAYDI:
 *   · HUDUD natijasi — lidning ASL hududi bo'yicha (bozor);
 *   · KOORDINATOR natijasi — sotgan odam bo'yicha (shaxsiy ish).
 *
 * Samarqand lidini Buxoro koordinatori yopsa: Samarqand bozori
 * +1, Buxoro koordinatori +1. Bitta raqamga qo'shsak, hududiy
 * tahlil ma'nosini yo'qotardi.
 */

export interface RegionStat {
  regionId: string;
  slug: string;
  name: string;
  leadsToday: number;
  claimedToday: number;
  confirmedToday: number;
  /** Talab — SHU SANAGA tegishli qiymat. */
  target: number | null;
  progress: number | null;
  state: TargetState;
  coordinators: Array<{ id: string; fullName: string; photoUrl: string | null; status: string }>;
  alerts: string[];
}

/**
 * MARSHRUTLASHNI YOQISH UCHUN TAYYORLIKMI.
 *
 * Har shart ALOHIDA ko'rsatiladi: "tayyor emas" degan umumiy
 * xabar admin nima qilishini bilmay qoldirardi.
 */
export interface RoutingReadiness {
  botConfigured: boolean;
  webhookHealthy: boolean;
  activeCoordinators: number;
  coordinatorsWithTelegram: number;
  coordinatorsWithRegion: number;
  regionsCovered: number;
  regionsTotal: number;
  leadIntakeReady: boolean;
  ready: boolean;
  blockers: string[];
}

export interface CoordinatorDashboard {
  businessDate: string;
  routingEnabled: boolean;
  national: {
    leadsToday: number;
    claimedToday: number;
    confirmedToday: number;
    target: number | null;
    progress: number | null;
    regionsMetTarget: number;
    regionsBelowTarget: number;
    unclaimedLeads: number;
    commissionToday: number;
  };
  regions: RegionStat[];
  coordinatorStats: CoordinatorDayStats[];
  nominations: {
    firstToTarget: ReturnType<typeof firstToTarget>;
    mostSales: ReturnType<typeof mostSales>;
    mostEfficient: ReturnType<typeof mostEfficient>;
    efficiencyMinLeads: number;
  };
  attention: string[];
  readiness: RoutingReadiness;
}

export async function loadCoordinatorDashboard(
  now: Date = new Date(),
): Promise<CoordinatorDashboard> {
  const db = createSupabaseAdminClient();
  const settings = await getCoordinatorSettings();
  const date = businessDate(now);
  const day = businessDayRange(date);

  const [regionsRes, coordinatorsRes, leadsRes, targetsRes, commissionsRes] =
    await Promise.all([
      db.from("regions").select("id, slug, name").order("sort_order"),
      db.from("coordinators").select("id, full_name, photo_url, region_id, status, is_active, telegram_user_id"),
      db
        .from("coordinator_leads")
        .select(
          "id, lead_region_id, assigned_coordinator_id, state, claimed_at, payment_confirmed_at",
        )
        .gte("created_at", day.startIso)
        .lt("created_at", day.endIso),
      db.from("coordinator_daily_targets").select("target_date, region_id, target_sales"),
      db
        .from("coordinator_commissions")
        .select("coordinator_id, amount_uzs, status, business_date")
        .eq("business_date", date),
    ]);

  const regions = regionsRes.data ?? [];
  const coordinators = (coordinatorsRes.data ?? []).filter((c) => c.is_active);
  const leads = leadsRes.data ?? [];
  const commissions = (commissionsRes.data ?? []).filter((c) => c.status !== "reversed");

  const targetRows: DailyTargetRow[] = (targetsRes.data ?? []).map((row) => ({
    targetDate: (row.target_date as string | null) ?? null,
    regionId: (row.region_id as string | null) ?? null,
    targetSales: (row.target_sales as number) ?? 0,
  }));

  const isConfirmed = (state: string) => state === "payment_confirmed" || state === "won";

  /* ------------------------- HUDUD bo'yicha ------------------------------ */
  const regionStats: RegionStat[] = regions.map((region) => {
    const id = region.id as string;
    // ASL hudud bo'yicha — overflow bu sonni ko'chirmaydi.
    const mine = leads.filter((l) => l.lead_region_id === id);
    const confirmed = mine.filter((l) => isConfirmed(l.state as string)).length;
    const target = resolveTarget(targetRows, date, id) ?? settings.defaultDailyTarget;

    const regionCoordinators = coordinators
      .filter((c) => c.region_id === id)
      .map((c) => ({
        id: c.id as string,
        fullName: (c.full_name as string) ?? "",
        photoUrl: (c.photo_url as string | null) ?? null,
        status: (c.status as string) ?? "active",
      }));

    const alerts: string[] = [];
    if (regionCoordinators.length === 0) {
      alerts.push("Koordinator biriktirilmagan");
    } else if (regionCoordinators.every((c) => c.status !== "active")) {
      alerts.push("Koordinator faol emas");
    }
    const unclaimed = mine.filter((l) => !l.assigned_coordinator_id).length;
    if (unclaimed > 0) alerts.push(`${unclaimed} ta lid band qilinmagan`);

    return {
      regionId: id,
      slug: region.slug as string,
      name: region.name as string,
      leadsToday: mine.length,
      claimedToday: mine.filter((l) => l.assigned_coordinator_id).length,
      confirmedToday: confirmed,
      target,
      progress: targetProgress(confirmed, target),
      // Lid umuman bo'lmagan hudud "past" emas, "ma'lumot yo'q".
      state: targetState({ confirmedSales: mine.length === 0 ? null : confirmed, target }),
      coordinators: regionCoordinators,
      alerts,
    };
  });

  /* ---------------------- KOORDINATOR bo'yicha --------------------------- */
  const coordinatorStats: CoordinatorDayStats[] = coordinators.map((c) => {
    const id = c.id as string;
    const mine = leads.filter((l) => l.assigned_coordinator_id === id);
    const confirmedRows = mine
      .filter((l) => isConfirmed(l.state as string))
      .sort((a, b) =>
        String(a.payment_confirmed_at ?? "").localeCompare(String(b.payment_confirmed_at ?? "")),
      );

    const target = resolveTarget(targetRows, date, (c.region_id as string | null) ?? null)
      ?? settings.defaultDailyTarget;

    /*
     * TALABNI KESIB O'TGAN VAQT.
     *
     * Hozirgi jami sondan chiqarib bo'lmaydi: kun oxirida 20 ta
     * sotgan odam talabni 18:00 da, 10 ta sotgan esa 11:00 da
     * bajargan bo'lishi mumkin. "Birinchi" — vaqt haqidagi savol.
     */
    const crossing = target > 0 && confirmedRows.length >= target
      ? (confirmedRows[target - 1].payment_confirmed_at as string | null)
      : null;

    return {
      coordinatorId: id,
      coordinatorName: (c.full_name as string) ?? "",
      regionId: (c.region_id as string | null) ?? null,
      claimedLeads: mine.length,
      confirmedSales: confirmedRows.length,
      targetReachedAt: crossing,
    };
  });

  /* ------------------------------ milliy --------------------------------- */
  const confirmedToday = leads.filter((l) => isConfirmed(l.state as string)).length;
  const nationalTarget = resolveTarget(targetRows, date, null) ?? settings.defaultDailyTarget;

  const attention: string[] = [];
  for (const region of regionStats) {
    for (const alert of region.alerts) attention.push(`${region.name}: ${alert}`);
  }
  if (!settings.routingEnabled) {
    attention.unshift("Marshrutlash o‘chiq — lidlar koordinatorlarga yuborilmayapti");
  }

  /* ---------------------------- tayyorlik -------------------------------- */
  const withTelegram = coordinators.filter((c) => c.telegram_user_id != null).length;
  const withRegion = coordinators.filter((c) => c.region_id != null).length;
  const covered = new Set(
    coordinators
      .filter((c) => c.status === "active" && c.region_id != null)
      .map((c) => c.region_id as string),
  ).size;

  const blockers: string[] = [];
  if (coordinators.length === 0) blockers.push("Faol koordinator yo‘q");
  else {
    if (withTelegram === 0) blockers.push("Hech kimda Telegram ID yo‘q — bot xabar yubora olmaydi");
    if (withRegion === 0) blockers.push("Hech kimda hudud biriktirilmagan");
  }

  const readiness: RoutingReadiness = {
    botConfigured: false,
    webhookHealthy: false,
    activeCoordinators: coordinators.length,
    coordinatorsWithTelegram: withTelegram,
    coordinatorsWithRegion: withRegion,
    regionsCovered: covered,
    regionsTotal: regions.length,
    leadIntakeReady: withTelegram > 0 && withRegion > 0,
    ready: blockers.length === 0,
    blockers,
  };

  return {
    businessDate: date,
    routingEnabled: settings.routingEnabled,
    readiness,
    national: {
      leadsToday: leads.length,
      claimedToday: leads.filter((l) => l.assigned_coordinator_id).length,
      confirmedToday,
      target: nationalTarget,
      progress: targetProgress(confirmedToday, nationalTarget),
      regionsMetTarget: regionStats.filter(
        (r) => r.state === "target_met" || r.state === "top_performer",
      ).length,
      regionsBelowTarget: regionStats.filter((r) => r.state === "below_target").length,
      unclaimedLeads: leads.filter((l) => !l.assigned_coordinator_id).length,
      commissionToday: commissions.reduce((sum, c) => sum + ((c.amount_uzs as number) ?? 0), 0),
    },
    regions: regionStats,
    coordinatorStats,
    nominations: {
      firstToTarget: firstToTarget(coordinatorStats),
      mostSales: mostSales(coordinatorStats),
      mostEfficient: mostEfficient(coordinatorStats, settings.efficiencyMinLeads),
      efficiencyMinLeads: settings.efficiencyMinLeads,
    },
    attention,
  };
}

export type { CoordinatorDayStats };
