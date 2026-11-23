import type { SupabaseClient } from "@supabase/supabase-js";
import { nameSkeleton } from "./vip/bot-search.ts";
import { listRange } from "./list.ts";

interface SearchRow {
  id: string;
  full_name: string;
  slug: string;
}

const BATCH_SIZE = 500;

/** Use the same name normalization as the VIP picker, without fuzzy typos. */
export function candidateMatchesSearch(row: SearchRow, query: string): boolean {
  const raw = query.trim().toLowerCase();
  if (!raw) return false;
  if (row.full_name.toLowerCase().includes(raw) || row.slug.toLowerCase().includes(raw)) return true;
  const words = nameSkeleton(raw).split(" ").filter(Boolean);
  if (!words.length) return false;
  return [row.full_name, row.slug].some((value) => {
    const key = nameSkeleton(value);
    return words.every((word) => key.includes(word));
  });
}

/**
 * Read only IDs/names/slugs on the server; load full cards for one page later.
 * Batch past PostgREST's row cap so later names remain searchable. Apply the
 * existing filters before matching and pagination, preserving accurate totals.
 */
export async function findCandidateSearchPage(
  admin: SupabaseClient,
  query: string,
  filters: Record<string, string>,
  page: number,
): Promise<{ ids: string[]; total: number }> {
  const loadBatch = (from: number) => {
    let request = admin.from("candidates").select("id,full_name,slug", from === 0 ? { count: "exact" } : {})
      .order("created_at", { ascending: false }).order("id", { ascending: false });
    if (filters.status === "archived") request = request.eq("status", "archived");
    else {
      request = request.is("deleted_at", null);
      if (filters.status) request = request.eq("status", filters.status);
    }
    if (filters.region) request = request.eq("region_id", filters.region);
    if (filters.category) request = request.eq("category_id", filters.category);
    return request.range(from, from + BATCH_SIZE - 1);
  };

  const first = await loadBatch(0);
  if (first.error) throw new Error(first.error.message);
  const rows = (first.data ?? []) as SearchRow[];
  const count = first.count ?? rows.length;
  // Bound concurrent requests while avoiding a waterfall for every batch.
  for (let from = BATCH_SIZE; from < count; from += BATCH_SIZE * 4) {
    const offsets = Array.from({ length: 4 }, (_, index) => from + index * BATCH_SIZE).filter((offset) => offset < count);
    const batches = await Promise.all(offsets.map(loadBatch));
    for (const batch of batches) {
      if (batch.error) throw new Error(batch.error.message);
      rows.push(...((batch.data ?? []) as SearchRow[]));
    }
  }

  const matches = rows.filter((row) => candidateMatchesSearch(row, query));
  const [from, to] = listRange(page);
  return { ids: matches.slice(from, to + 1).map((row) => row.id), total: matches.length };
}
