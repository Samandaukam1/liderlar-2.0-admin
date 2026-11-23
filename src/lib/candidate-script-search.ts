import type { SupabaseClient } from "@supabase/supabase-js";
import { nameSkeleton } from "./vip/bot-search.ts";
import { listRange } from "./list.ts";

export interface ScriptSearchRow {
  id: string;
  full_name: string;
  slug?: string | null;
}

const BATCH_SIZE = 500;

interface SearchBatch<T> {
  data: T[] | null;
  count?: number | null;
  error: { message: string } | null;
}

/** Use the same name normalization as the VIP picker, without fuzzy typos. */
export function candidateMatchesSearch(row: ScriptSearchRow, query: string): boolean {
  const raw = query.trim().toLowerCase();
  if (!raw) return false;
  if (row.full_name.toLowerCase().includes(raw) || row.slug?.toLowerCase().includes(raw)) return true;
  const words = nameSkeleton(raw).split(" ").filter(Boolean);
  if (!words.length) return false;
  return [row.full_name, row.slug].some((value) => {
    const key = nameSkeleton(value ?? "");
    return words.every((word) => key.includes(word));
  });
}

/**
 * Read only IDs/names/slugs on the server; load full cards for one page later.
 * Batch past PostgREST's row cap so later names remain searchable. Apply the
 * existing filters before matching and pagination, preserving accurate totals.
 */
export async function findMatchingCandidates(
  admin: SupabaseClient,
  query: string,
  filters: Record<string, string>,
  orderColumn = "created_at",
): Promise<ScriptSearchRow[]> {
  return findScriptSearchMatches(query, (from, to) => {
    let request = admin.from("candidates").select("id,full_name,slug", from === 0 ? { count: "exact" } : {})
      .order(orderColumn, { ascending: orderColumn === "full_name" }).order("id", { ascending: orderColumn === "full_name" });
    if (filters.status === "archived") request = request.eq("status", "archived");
    else {
      request = request.is("deleted_at", null);
      if (filters.status) request = request.eq("status", filters.status);
    }
    if (filters.region) request = request.eq("region_id", filters.region);
    if (filters.category) request = request.eq("category_id", filters.category);
    return request.range(from, to);
  });
}

/** Shared batch loader: match before pagination, including rows past the API cap. */
export async function findScriptSearchMatches<T extends ScriptSearchRow>(
  query: string,
  loadBatch: (from: number, to: number) => PromiseLike<SearchBatch<T>>,
): Promise<T[]> {
  const first = await loadBatch(0, BATCH_SIZE - 1);
  if (first.error) throw new Error(first.error.message);
  const rows = first.data ?? [];
  const count = first.count ?? rows.length;
  // Bound concurrent requests while avoiding a waterfall for every batch.
  for (let from = BATCH_SIZE; from < count; from += BATCH_SIZE * 4) {
    const offsets = Array.from({ length: 4 }, (_, index) => from + index * BATCH_SIZE).filter((offset) => offset < count);
    const batches = await Promise.all(offsets.map((offset) => loadBatch(offset, offset + BATCH_SIZE - 1)));
    for (const batch of batches) {
      if (batch.error) throw new Error(batch.error.message);
      rows.push(...(batch.data ?? []));
    }
  }

  return rows.filter((row) => candidateMatchesSearch(row, query));
}

export async function findCandidateSearchPage(
  admin: SupabaseClient,
  query: string,
  filters: Record<string, string>,
  page: number,
): Promise<{ ids: string[]; total: number }> {
  const matches = await findMatchingCandidates(admin, query, filters);
  const [from, to] = listRange(page);
  return { ids: matches.slice(from, to + 1).map((row) => row.id), total: matches.length };
}
