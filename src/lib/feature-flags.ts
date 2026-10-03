import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * FEATURE FLAGLAR — ADMIN TOMONI.
 *
 * Web reposidagi `entitlement-service` dan ALOHIDA: ikki repo mustaqil
 * deploy qilinadi va umumiy paket yo'q. Bu yerda faqat flag o'qish
 * kerak — obuna va huquqlar mantig'i kerak emas.
 */

/** Qisqa kesh: flaglar har so'rovda o'qilmasin. */
let cache: { at: number; flags: Record<string, boolean> } | null = null;
const TTL_MS = 30_000;

async function loadFlags(): Promise<Record<string, boolean>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.flags;

  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("feature_flags").select("key, is_enabled");

  if (error) {
    /*
     * XATODA HAMMASI O'CHIQ ("fail closed").
     *
     * Teskarisi — xatoda ochib qo'yish — baza uzilganda imkoniyatni
     * o'z-o'zidan yoqib yuborardi. Eski kesh bo'lsa, u ishlatiladi:
     * u ham ochiq emas, oxirgi ma'lum holat.
     */
    console.error("[flag] o'qilmadi:", error.message);
    return cache?.flags ?? {};
  }

  const flags: Record<string, boolean> = {};
  for (const row of data ?? []) {
    flags[row.key as string] = row.is_enabled === true;
  }

  cache = { at: Date.now(), flags };
  return flags;
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const flags = await loadFlags();
  return flags[key] === true;
}
