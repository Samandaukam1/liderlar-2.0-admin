import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CLAIM_WINDOW_MINUTES } from "./routing-rules.ts";

/**
 * Koordinator tizimi sozlamalari — `site_settings` dan.
 *
 * TIJORIY QIYMATLAR KODDA QOTIB QOLMAYDI: komissiya summasi, talab
 * va oyna uzunligi biznes qarori va ular o'zgarganda deploy kerak
 * bo'lmasligi kerak.
 */
export interface CoordinatorSettings {
  /**
   * MARSHRUTLASH YOQILGANMI. Standart — O'CHIQ.
   *
   * Kod deploy bo'lgani bilan hech bir koordinatorga xabar
   * ketmaydi: koordinatorlar hali kiritilmagan va bot sozlanmagan
   * bo'lishi mumkin. Yoqishni admin ataylab qiladi.
   */
  routingEnabled: boolean;
  claimWindowMinutes: number;
  commissionUzs: number;
  defaultDailyTarget: number;
  efficiencyMinLeads: number;
}

export const DEFAULT_COORDINATOR_SETTINGS: CoordinatorSettings = {
  routingEnabled: false,
  claimWindowMinutes: DEFAULT_CLAIM_WINDOW_MINUTES,
  commissionUzs: 10_000,
  defaultDailyTarget: 10,
  efficiencyMinLeads: 5,
};

const KEYS = {
  routingEnabled: "coordinator.routing_enabled",
  claimWindowMinutes: "coordinator.claim_window_minutes",
  commissionUzs: "coordinator.commission_uzs",
  defaultDailyTarget: "coordinator.default_daily_target",
  efficiencyMinLeads: "coordinator.efficiency_min_leads",
} as const;

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
}

export async function getCoordinatorSettings(): Promise<CoordinatorSettings> {
  try {
    const db = createSupabaseAdminClient();
    const { data } = await db
      .from("site_settings")
      .select("key, value")
      .in("key", Object.values(KEYS));

    const map = new Map((data ?? []).map((row) => [row.key as string, row.value as string]));
    return {
      // Faqat ANIQ "true" yoqadi — nosoz qiymat tizimni jim qoldiradi.
      routingEnabled: (map.get(KEYS.routingEnabled) ?? "").trim() === "true",
      claimWindowMinutes: int(map.get(KEYS.claimWindowMinutes), 10, 1, 240),
      commissionUzs: int(map.get(KEYS.commissionUzs), 10_000, 0, 100_000_000),
      defaultDailyTarget: int(map.get(KEYS.defaultDailyTarget), 10, 0, 10_000),
      efficiencyMinLeads: int(map.get(KEYS.efficiencyMinLeads), 5, 1, 1000),
    };
  } catch {
    // Baza yetib bo'lmasa marshrutlash O'CHIQ qoladi: jim turish
    // noto'g'ri odamga lid yuborishdan xavfsizroq.
    return DEFAULT_COORDINATOR_SETTINGS;
  }
}

export { KEYS as COORDINATOR_SETTING_KEYS };
