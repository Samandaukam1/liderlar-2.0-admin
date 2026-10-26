import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROFILE_REVALIDATE_BATCH,
  PROFILE_REVALIDATE_PATH,
  profileRefreshBatches,
} from "../src/lib/public-profile-refresh-rules.ts";

/*
 * The public site caches each candidate profile (up to an hour). Edits to the
 * candidates row refresh it on their own (updated_at is in the cache key);
 * edits to related tables must tell liderlar-web. These tests pin the payload
 * rules and the places that send it.
 */

const read = (path: string) => readFileSync(path, "utf8");
const A = "2af89f57-9807-4dee-aed1-cdf533637b4b";
const B = "33eebd5c-4bcd-4c40-91dd-82b1c8539088";

test("ids are validated, lower-cased and de-duplicated", () => {
  assert.deepEqual(profileRefreshBatches([A, A.toUpperCase(), null, undefined, "", "not-a-uuid", B]), [[A, B]]);
  assert.deepEqual(profileRefreshBatches([null, undefined]), []);
});

test("large lists are split into batches the web route accepts", () => {
  const ids = Array.from({ length: 120 }, (_, i) => `${A.slice(0, -3)}${String(i).padStart(3, "0")}`);
  const batches = profileRefreshBatches(ids);
  assert.deepEqual(batches.map((b) => b.length), [PROFILE_REVALIDATE_BATCH, PROFILE_REVALIDATE_BATCH, 20]);
  assert.equal(new Set(batches.flat()).size, 120);
});

test("the target path matches the liderlar-web route", () => {
  assert.equal(PROFILE_REVALIDATE_PATH, "/api/revalidate/profile");
});

test("the refresh never blocks or fails the edit that triggered it", () => {
  const source = read("src/lib/public-profile-refresh.ts");
  assert.match(source, /after\(send\)/, "sent after the response");
  assert.match(source, /signal: AbortSignal\.timeout\(TIMEOUT_MS\)/);
  assert.match(source, /catch \(error\) \{\s*console\.error/);
  assert.match(source, /"x-liderlar-api-key": key/);
});

test("every admin write to profile-related tables refreshes the public profile", () => {
  const sites: Record<string, number> = {
    "src/lib/actions/candidates.ts": 2, // add / delete achievements, education, ...
    "src/lib/candidates/repository.ts": 1, // admin profile editor (row + sections)
    "src/lib/profile-editor/section-review-service.ts": 1,
    "src/lib/profile-editor/certificate-review-service.ts": 1,
    "src/lib/profile-editor/entry-review-service.ts": 1,
    "src/lib/profile-editor/review-service.ts": 1,
    "src/app/api/upload/commit/route.ts": 1,
    "src/app/api/upload/route.ts": 1,
    "src/lib/actions/system.ts": 1, // media delete
    "src/app/api/admin/candidates/[candidateId]/adabiyotx-items/route.ts": 1,
    "src/app/api/admin/candidates/[candidateId]/adabiyotx-items/[itemId]/route.ts": 2,
    "src/lib/articles/editorial-service.ts": 1,
    "src/lib/actions/articles.ts": 3,
    "src/lib/member-bot/photo-flow.ts": 1,
    "src/lib/intake/instagram-link.ts": 1,
  };
  for (const [file, count] of Object.entries(sites)) {
    const calls = read(file).match(/refreshPublicProfiles\(/g)?.length ?? 0;
    assert.equal(calls, count, file);
  }
});

test("media delete reads the owner before refreshing", () => {
  assert.match(read("src/lib/actions/system.ts"), /\.select\("bucket, path, file_name, candidate_id"\)/);
});
