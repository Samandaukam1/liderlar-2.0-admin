import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTelegramMessage,
  buildUpdateLink,
  deriveTokenStatus,
  generateRawToken,
  hashToken,
} from "../src/lib/tokens.ts";

test("token yaratish: unikallik va uzunlik", () => {
  const a = generateRawToken();
  const b = generateRawToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
});

test("hash barqaror sha256 hex", () => {
  const raw = "test-token";
  const h1 = hashToken(raw);
  assert.equal(h1, hashToken(raw));
  assert.equal(h1.length, 64);
  assert.notEqual(h1, hashToken("boshqa"));
  assert.ok(!h1.includes(raw));
});

test("token holati to'g'ri aniqlanadi", () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.equal(deriveTokenStatus({ status: "active", expires_at: future, used_at: null }), "active");
  assert.equal(deriveTokenStatus({ status: "active", expires_at: past, used_at: null }), "expired");
  assert.equal(deriveTokenStatus({ status: "used", expires_at: future, used_at: past }), "used");
  assert.equal(deriveTokenStatus({ status: "revoked", expires_at: future, used_at: null }), "revoked");
  // used_at bo'lsa status maydonidan qat'i nazar "used"
  assert.equal(deriveTokenStatus({ status: "active", expires_at: future, used_at: past }), "used");
});

test("telegram xabari havola va ismni o'z ichiga oladi", () => {
  const link = buildUpdateLink("abc123");
  assert.ok(link.includes("/yangilash/abc123"));
  const msg = buildTelegramMessage("Aziza Karimova", link);
  assert.ok(msg.includes("Aziza Karimova"));
  assert.ok(msg.includes(link));
});
