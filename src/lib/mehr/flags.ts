import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MEHR_FLAG_KEYS, ALL_FLAGS_OFF, type MehrFlags } from "./flag-keys.ts";

/*
 * Kalitlar va tip SOF modulda (`flag-keys.ts`).
 *
 * Bu fayl `server-only` — mijoz komponenti undan hatto tipni
 * import qilsa ham, bundler butun modulni brauzer paketiga
 * tortadi va build yiqiladi.
 */
export * from "./flag-keys.ts";

/**
 * MEHR bayroqlari (§43).
 *
 * HAMMASI O'CHIQ DEB TAXMIN QILINADI. Sozlama o'qilmasa yoki
 * kutilmagan qiymat bo'lsa, tizim yopiq qoladi: ochilib ketgan
 * xususiyatni keyin qaytarib yopish, yopiq turganini ochishdan
 * ancha qimmatga tushadi.
 */

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
    return { ...ALL_FLAGS_OFF };
  }

  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
  const out = { ...ALL_FLAGS_OFF };

  for (const [field, key] of Object.entries(MEHR_FLAG_KEYS)) {
    out[field as keyof MehrFlags] = isOn(map.get(key));
  }

  return out;
}
