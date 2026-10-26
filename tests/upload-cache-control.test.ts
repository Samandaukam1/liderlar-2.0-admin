import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildObjectPath, IMMUTABLE_OBJECT_CACHE_CONTROL } from "../src/lib/upload-rules.ts";

/*
 * Supabase Cached Egress reached 1.45 TB (2026-10). Every public object was
 * stored with the default `max-age=3600`, so each visitor re-downloaded the
 * ~4 MB corner video and AI-avatar clip every hour. Unique-path uploads now
 * carry a one-year cache; overwritten paths must not.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("the immutable cache is one year, in seconds (storage-js sends max-age=<value>)", () => {
  assert.equal(IMMUTABLE_OBJECT_CACHE_CONTROL, String(365 * 24 * 60 * 60));
});

test("buildObjectPath never reuses a key, which is what makes the long cache safe", () => {
  const paths = new Set(Array.from({ length: 500 }, () => buildObjectPath("clip.MP4")));
  assert.equal(paths.size, 500);
  for (const path of paths) assert.match(path, /^\d{4}-\d{2}\/[0-9a-f-]{36}\.mp4$/);
});

test("unique-path public uploads send the long cache", () => {
  for (const file of [
    "src/lib/upload-client.ts",
    "src/app/api/upload/route.ts",
    "src/lib/intake/promote.ts",
    "src/lib/member-bot/photo-flow.ts",
  ]) {
    const source = read(file);
    assert.match(source, /cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL/, file);
    assert.doesNotMatch(source, /upsert: true/, `${file} overwrites paths — the long cache would serve stale files`);
  }
});

test("overwritten paths keep the short default cache", () => {
  // Post Studio and branding write to stable paths with upsert: true.
  for (const file of ["src/lib/post-studio/storage.ts", "src/lib/branding/service.ts"]) {
    const source = read(file);
    assert.match(source, /upsert: true/, file);
    assert.doesNotMatch(source, /IMMUTABLE_OBJECT_CACHE_CONTROL/, file);
  }
});
