export interface ListParams {
  page: number;
  q: string;
  filters: Record<string, string>;
}

export const PAGE_SIZE = 20;

/** Normalizes searchParams for server-side paginated list pages. */
export function parseListParams(
  sp: Record<string, string | string[] | undefined>,
  filterKeys: string[] = [],
): ListParams {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : (v ?? "");
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);
  const q = one(sp.q).trim();
  const filters: Record<string, string> = {};
  for (const key of filterKeys) {
    const v = one(sp[key]).trim();
    if (v) filters[key] = v;
  }
  return { page, q, filters };
}

export function listRange(page: number): [number, number] {
  const from = (page - 1) * PAGE_SIZE;
  return [from, from + PAGE_SIZE - 1];
}
