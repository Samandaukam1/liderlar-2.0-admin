import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  decide,
  denialText,
  FEATURE_FLAGS,
  type Entitlement,
  type EntitlementDecision,
  type FeatureFlag,
  type SubscriptionSnapshot,
  type SubscriptionState,
} from "./entitlements";

/**
 * VIP HUQUQI — ADMIN REPOSIDAGI SERVER TEKSHIRUVI.
 *
 * NEGA KERAK: Telegram bot (a'zolar boti) shu repoda ishlaydi va u
 * orqali profil tahrirlanadi, rasm yuklanadi. Avval bot faqat
 * "Telegram ulanganmi" deb tekshirardi — VIP tugagan yoki umuman
 * bo'lmagan a'zo ham profilini bot orqali o'zgartira olardi.
 *
 * QOIDA SAYT BILAN BIR XIL: `entitlements.ts` ikkala repoda bayt-
 * baytigacha bir xil (test solishtiradi). Bu yerda faqat ma'lumot
 * o'qiladi: flaglar va profilning ochiq obunasi.
 *
 * XATODA RAD ETADI ("fail closed"): baza o'qilmasa huquq yo'q.
 */

async function loadFlags(): Promise<Partial<Record<FeatureFlag, boolean>>> {
  // `isFeatureEnabled` 30 soniyalik kesh bilan o'qiydi — bu bitta so'rov.
  const values = await Promise.all(FEATURE_FLAGS.map((flag) => isFeatureEnabled(flag).catch(() => false)));
  return Object.fromEntries(FEATURE_FLAGS.map((flag, i) => [flag, values[i]]));
}

async function loadSubscription(profileId: string): Promise<SubscriptionSnapshot | null> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("vip_subscriptions")
    .select("state, current_period_end, grace_until, plan_code")
    .in("state", ["pending", "active", "grace_period", "suspended"])
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    console.error("[vip] obuna o'qilmadi:", error.message);
    return null;
  }
  if (!data) return null;

  const { data: rows, error: entError } = await db
    .from("vip_plan_entitlements")
    .select("entitlement")
    .eq("plan_code", data.plan_code as string);

  if (entError) {
    console.error("[vip] tarif huquqlari o'qilmadi:", entError.message);
    return null;
  }

  return {
    state: data.state as SubscriptionState,
    currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end as string) : null,
    graceUntil: data.grace_until ? new Date(data.grace_until as string) : null,
    entitlements: (rows ?? []).map((r) => r.entitlement as string),
  };
}

/**
 * Profil shu huquqqa egami.
 *
 * `profileId` SERVERDA aniqlangan bo'lishi shart (masalan, bog'langan
 * Telegram ID orqali) — foydalanuvchi yuborgan qiymat emas.
 */
export async function profileDecision(
  profileId: string,
  entitlement: Entitlement,
): Promise<EntitlementDecision & { text?: string }> {
  const [flags, subscription] = await Promise.all([loadFlags(), loadSubscription(profileId)]);
  const decision = decide(entitlement, { flags, subscription, now: new Date() });
  return decision.allowed ? decision : { ...decision, text: denialText(decision.reason) };
}
