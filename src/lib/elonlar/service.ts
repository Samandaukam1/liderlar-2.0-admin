import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  AD_SELECT_COLUMNS,
  ADS_SETTINGS_SELECT_COLUMNS,
  mapAdRow,
  mapAdsSettingsRow,
  type Ad,
  type AdPlacement,
  type AdRow,
  type AdsSettings,
  type AdsSettingsRow,
} from "./types";
import { describeDbError, isMissingRelationError } from "./rules";

/**
 * REKLAMA BO'LIMI — O'QISH.
 *
 * Migratsiya hali qo'llanmagan bo'lsa sahifa yiqilmaydi: aniq yo'riqnoma
 * ko'rsatiladi (`missingMigration`). Yozish server action'larda.
 */

export type AdsPageData =
  | { ok: true; ads: Ad[]; settings: AdsSettings }
  | { ok: false; error: string; missingMigration: boolean };

export async function loadAdsPageData(): Promise<AdsPageData> {
  const db = createSupabaseAdminClient();
  const [adsRes, settingsRes] = await Promise.all([
    db
      .from("ads")
      .select(AD_SELECT_COLUMNS)
      .order("placement", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    db.from("ads_settings").select(ADS_SETTINGS_SELECT_COLUMNS).eq("id", true).maybeSingle(),
  ]);

  const error = adsRes.error ?? settingsRes.error;
  if (error) {
    return { ok: false, error: describeDbError(error), missingMigration: isMissingRelationError(error) };
  }
  return {
    ok: true,
    ads: ((adsRes.data ?? []) as unknown as AdRow[]).map(mapAdRow),
    settings: mapAdsSettingsRow((settingsRes.data as unknown as AdsSettingsRow | null) ?? null),
  };
}

/** Bir joydagi reklamalar — faollik chegarasi va tartib uchun. */
export async function listAdsInPlacement(
  placement: AdPlacement,
): Promise<{ ok: true; ads: Ad[] } | { ok: false; error: string }> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("ads")
    .select(AD_SELECT_COLUMNS)
    .eq("placement", placement)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: describeDbError(error) };
  return { ok: true, ads: ((data ?? []) as unknown as AdRow[]).map(mapAdRow) };
}

export async function getAd(id: string): Promise<Ad | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db.from("ads").select(AD_SELECT_COLUMNS).eq("id", id).maybeSingle();
  return data ? mapAdRow(data as unknown as AdRow) : null;
}
