import { test } from "node:test";
import assert from "node:assert/strict";

process.env.CANDIDATE_LINK_SECRET =
  process.env.CANDIDATE_LINK_SECRET || "test-secret-at-least-32-bytes-long-000000";

import {
  generateRawIntakeToken,
  hashIntakeToken,
  tokenPrefix,
  timingSafeEqualHex,
  buildIntakeLink,
  extractRawToken,
} from "../src/lib/intake/tokens.ts";

test("xom token: unikallik va yetarli uzunlik (>=32 bayt)", () => {
  const a = generateRawIntakeToken();
  const b = generateRawIntakeToken();
  assert.notEqual(a, b);
  // 32 bayt base64url ~ 43 belgi
  assert.ok(a.length >= 43, `uzunlik: ${a.length}`);
});

test("HMAC hash barqaror va 64 hex; xom token hashda YO'Q", () => {
  const raw = generateRawIntakeToken();
  const h1 = hashIntakeToken(raw);
  assert.equal(h1, hashIntakeToken(raw));
  assert.equal(h1.length, 64);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.ok(!h1.includes(raw), "xom token hash ichida saqlanmasligi kerak");
});

test("boshqa secret => boshqa hash (HMAC kalitga bog'liq)", () => {
  const raw = "constant-token-value";
  const h1 = hashIntakeToken(raw);
  process.env.CANDIDATE_LINK_SECRET = "another-secret-at-least-32-bytes-1111111";
  const h2 = hashIntakeToken(raw);
  process.env.CANDIDATE_LINK_SECRET = "test-secret-at-least-32-bytes-long-000000";
  assert.notEqual(h1, h2);
});

test("qisqa yoki yo'q secret bilan hash xato beradi", () => {
  const saved = process.env.CANDIDATE_LINK_SECRET;
  process.env.CANDIDATE_LINK_SECRET = "short";
  assert.throws(() => hashIntakeToken("x"));
  process.env.CANDIDATE_LINK_SECRET = saved;
});

test("timing-safe taqqoslash", () => {
  const raw = generateRawIntakeToken();
  const h = hashIntakeToken(raw);
  assert.equal(timingSafeEqualHex(h, h), true);
  assert.equal(timingSafeEqualHex(h, hashIntakeToken(generateRawIntakeToken())), false);
  assert.equal(timingSafeEqualHex(h, h.slice(0, 32)), false, "turli uzunlik false");
});

test("token_prefix hashdan olinadi (xom tokendan emas)", () => {
  const raw = generateRawIntakeToken();
  const p = tokenPrefix(raw);
  assert.equal(p.length, 8);
  assert.ok(hashIntakeToken(raw).startsWith(p));
});

test("havola bazasi va xom token", () => {
  const link = buildIntakeLink("RAW123");
  assert.ok(link.endsWith("/RAW123"));
  assert.ok(link.includes("/anketa/"));
});

test("tokenni body yoki Authorization headerdan olish", () => {
  const raw = "a".repeat(30);
  assert.equal(extractRawToken(new Headers(), raw), raw);
  const h = new Headers({ authorization: `Bearer ${raw}` });
  assert.equal(extractRawToken(h, undefined), raw);
  assert.equal(extractRawToken(new Headers(), "short"), null);
});
