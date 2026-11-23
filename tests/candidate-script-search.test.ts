import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { candidateMatchesSearch, findCandidateSearchPage } from "../src/lib/candidate-script-search.ts";

const row = (id: string, full_name: string, slug = "profile-" + id) => ({ id, full_name, slug });

test("Latin and Cyrillic queries find both scripts, including х/ҳ and apostrophes", () => {
  for (const name of ["Ravshanov Nurmuhammad Azizbek O‘g‘li", "Норқулова Шаҳло Нурмуҳаммад қизи"]) {
    for (const query of ["Nurmuhammad", "Нурмухаммад", "Нурмуҳаммад"]) {
      assert.equal(candidateMatchesSearch(row("1", name), query), true, `${name}: ${query}`);
    }
  }
  for (const query of ["G'ulom", "Gʻulom", "G‘ulom", "Ғулом"]) {
    assert.equal(candidateMatchesSearch(row("1", "Ғулом Каримов"), query), true);
    assert.equal(candidateMatchesSearch(row("1", "G‘ulom Aliyev"), query), true);
  }
  assert.equal(candidateMatchesSearch(row("1", "Ali Valiyev", "custom-profile"), "CUSTOM-PROFILE"), true);
  assert.equal(candidateMatchesSearch(row("1", "Ali Valiyev"), "Zulfiya"), false);
  assert.equal(candidateMatchesSearch(row("1", "Ali Valiyev"), "  "), false);
});

function mockDatabase(failOffset = -1) {
  const rows = Array.from({ length: 1021 }, (_, index) => row(String(index), index < 1000 ? "Other Name" : "Нурмуҳаммад"));
  const calls: Array<{ offset: number; filters: unknown[]; orders: string[] }> = [];
  const admin = { from(table: string) {
    assert.equal(table, "candidates");
    const filters: unknown[] = [];
    const orders: string[] = [];
    return {
      select(columns: string) { assert.equal(columns, "id,full_name,slug"); return this; },
      order(column: string) { orders.push(column); return this; },
      eq(column: string, value: string) { filters.push(["eq", column, value]); return this; },
      is(column: string, value: null) { filters.push(["is", column, value]); return this; },
      range(from: number, to: number) {
        calls.push({ offset: from, filters, orders });
        return Promise.resolve({ data: rows.slice(from, to + 1), count: from === 0 ? rows.length : null, error: from === failOffset ? { message: "database unavailable" } : null });
      },
    };
  } } as unknown as SupabaseClient;
  return { admin, calls };
}

test("search scans past 1000 rows and paginates matches with accurate count", async () => {
  const { admin, calls } = mockDatabase();
  const first = await findCandidateSearchPage(admin, "Nurmuhammad", { status: "published", region: "r", category: "c" }, 1);
  assert.equal(first.total, 21);
  assert.equal(first.ids.length, 20);
  assert.equal(first.ids[0], "1000");
  assert.deepEqual(calls.map((call) => call.offset), [0, 500, 1000]);
  for (const call of calls) {
    assert.deepEqual(call.filters, [["is", "deleted_at", null], ["eq", "status", "published"], ["eq", "region_id", "r"], ["eq", "category_id", "c"]]);
    assert.deepEqual(call.orders, ["created_at", "id"]);
  }
  const second = await findCandidateSearchPage(admin, "Нурмухаммад", {}, 2);
  assert.deepEqual(second, { ids: ["1020"], total: 21 });
  assert.deepEqual(await findCandidateSearchPage(admin, "Nurmuhammad", {}, 3), { ids: [], total: 21 });
});

test("archived filter retains existing deletion semantics; database errors do not silently truncate", async () => {
  const { admin, calls } = mockDatabase();
  await findCandidateSearchPage(admin, "Nurmuhammad", { status: "archived" }, 1);
  for (const call of calls) assert.deepEqual(call.filters, [["eq", "status", "archived"]]);
  await assert.rejects(findCandidateSearchPage(mockDatabase(500).admin, "Nurmuhammad", {}, 1), /database unavailable/);
});
