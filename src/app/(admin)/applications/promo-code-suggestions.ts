"use server";

import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseHiddenPromoCodes, promoSearchPattern } from "./promo-hide-utils";

export async function getSelectedPromoCounts(codes: string[]): Promise<{ code: string; count: number | null }[]> {
  await requirePermission("applications.view");
  const selected = parseHiddenPromoCodes(JSON.stringify(codes));
  const db = createSupabaseAdminClient();
  return Promise.all(selected.map(async (code) => {
    const { count, error } = await db.from("applications")
      .select("id", { count: "exact", head: true }).eq("promo_code", code);
    return { code, count: error ? null : count ?? 0 };
  }));
}

export async function getPromoCodeSuggestions(query: string): Promise<{ code: string; count: number }[]> {
  await requirePermission("applications.view");
  const term = String(query ?? "").trim().slice(0, 120);
  if (!term) return [];
  const db = createSupabaseAdminClient();
  const counts = new Map<string, number>();
  // Read every matching page so counts are not truncated by Supabase's row limit.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("applications")
      .select("promo_code")
      .ilike("promo_code", promoSearchPattern(term))
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error("Promokodlarni qidirib bo‘lmadi");
    for (const row of data ?? []) {
      const code = row.promo_code as string | null;
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    if (!data || data.length < 1000) break;
  }
  return [...counts].map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, 12);
}
