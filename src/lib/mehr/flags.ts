import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * MEHR bayroqlari (§43).
 *
 * HAMMASI O'CHIQ DEB TAXMIN QILINADI. Sozlama o'qilmasa yoki
 * kutilmagan qiymat bo'lsa, tizim yopiq qoladi: ochilib ketgan
 * xususiyatni keyin qaytarib yopish, yopiq turganini ochishdan
 * ancha qimmatga tushadi.
 */

export const MEHR_FLAG_KEYS = {
  publicEnabled: "mehr.public_enabled",
  activityCreationEnabled: "mehr.activity_creation_enabled",
  qrCheckinEnabled: "mehr.qr_checkin_enabled",
  pointsEnabled: "mehr.points_enabled",
  certificatesEnabled: "mehr.certificates_enabled",
  memberAuthEnabled: "member.auth_enabled",
  memberBotEnabled: "member.bot_enabled",
  referralPointsEnabled: "referral.points_enabled",
} as const;

export type MehrFlags = Record<keyof typeof MEHR_FLAG_KEYS, boolean>;

const ALL_OFF: MehrFlags = {
  publicEnabled: false,
  activityCreationEnabled: false,
  qrCheckinEnabled: false,
  pointsEnabled: false,
  certificatesEnabled: false,
  memberAuthEnabled: false,
  memberBotEnabled: false,
  referralPointsEnabled: false,
};

/** Faqat aynan 'true' yoqilgan hisoblanadi. */
function isOn(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export async function getMehrFlags(): Promise<MehrFlags> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("site_settings")
    .select("key, value")
    .in("key", Object.values(MEHR_FLAG_KEYS));

  if (error) {
    console.error("MEHR_FLAGS_LOAD_FAILED", { code: error.code, message: error.message });
    return { ...ALL_OFF };
  }

  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
  const out = { ...ALL_OFF };

  for (const [field, key] of Object.entries(MEHR_FLAG_KEYS)) {
    out[field as keyof MehrFlags] = isOn(map.get(key));
  }

  return out;
}
