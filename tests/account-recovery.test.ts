import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkNewPassword,
  checkRecoveryToken,
  hashRecoveryToken,
  issueRecoveryToken,
  looksLikeRecoveryToken,
  recoveryState,
  recoveryUrl,
  RECOVERY_TTL_HOURS,
} from "../src/lib/accounts/recovery-token.ts";

/**
 * PAROLNI TIKLASH HAVOLASI.
 *
 * IKKALA REPODA AYNAN BIR XIL FAYL: admin panel havolani BERADI, sayt
 * uni ISHLATADI. Qaysi repoda ishlayotgani `package.json` dan aniqlanadi;
 * qo'shni repo yonida bo'lsa (`../liderlar-web` / `../liderlar-admin`),
 * ikki tomon birga tekshiriladi.
 */

const SELF = (JSON.parse(readFileSync("package.json", "utf8")) as { name: string }).name;
const IS_ADMIN = SELF === "liderlar-admin";
const OTHER = join("..", IS_ADMIN ? "liderlar-web" : "liderlar-admin");
const HAS_OTHER = existsSync(join(OTHER, "src/lib/accounts/recovery-token.ts"));
const NEEDS_OTHER = HAS_OTHER ? false : `${OTHER} topilmadi — ikki repoli tekshiruv o'tkazib yuborildi`;

const ADMIN = IS_ADMIN ? "." : OTHER;
const WEB = IS_ADMIN ? OTHER : ".";

const NOW = new Date("2026-10-03T10:00:00Z");

/* ------------------------------------------------------------------ *
 * TOKEN
 * ------------------------------------------------------------------ */

test("token: 192 bit, URL uchun xavfsiz, bazaga faqat sha256 hash", () => {
  const issued = issueRecoveryToken(NOW);
  assert.match(issued.token, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(looksLikeRecoveryToken(issued.token));
  assert.equal(issued.tokenHash, createHash("sha256").update(issued.token).digest("hex"));
  assert.notEqual(issued.tokenHash, issued.token);
  assert.equal(issued.tokenHash, hashRecoveryToken(issued.token));
});

test("token: har safar boshqa", () => {
  const tokens = new Set(Array.from({ length: 200 }, () => issueRecoveryToken(NOW).token));
  assert.equal(tokens.size, 200);
});

test("muddat: 24 soat (bazadagi 72 soatlik chegaradan ichkarida)", () => {
  const issued = issueRecoveryToken(NOW);
  assert.equal(RECOVERY_TTL_HOURS, 24);
  assert.equal(new Date(issued.expiresAt).getTime() - NOW.getTime(), 24 * 3_600_000);
});

test("shakl tekshiruvi bazaga borishdan oldin yaroqsiz matnni rad etadi", () => {
  for (const bad of ["", "abc", "x".repeat(33), "a".repeat(31) + "!", "../../etc/passwd", null, undefined]) {
    assert.equal(looksLikeRecoveryToken(bad as string), false, String(bad));
  }
});

/* ------------------------------------------------------------------ *
 * HOLAT: bir martalik, muddatli, bekor qilinadigan
 * ------------------------------------------------------------------ */

test("holat: amalda / ishlatilgan / bekor / muddati o'tgan", () => {
  const issued = issueRecoveryToken(NOW);
  const base = { tokenHash: issued.tokenHash, expiresAt: issued.expiresAt, consumedAt: null, revokedAt: null };

  assert.deepEqual(checkRecoveryToken(issued.token, base, NOW), { ok: true });
  assert.equal(recoveryState({ ...base, consumedAt: NOW.toISOString() }, NOW), "consumed");
  assert.equal(recoveryState({ ...base, revokedAt: NOW.toISOString() }, NOW), "revoked");

  const later = new Date(NOW.getTime() + 25 * 3_600_000);
  assert.deepEqual(checkRecoveryToken(issued.token, base, later), { ok: false, reason: "expired" });

  // Bekor qilingan + muddati o'tgan -> "bekor qilingan" (admin qarori muhimroq).
  assert.equal(recoveryState({ ...base, revokedAt: NOW.toISOString() }, later), "revoked");
});

test("boshqa token mos kelmaydi va 'topilmadi' deyiladi (tafsilot oshkor qilinmaydi)", () => {
  const a = issueRecoveryToken(NOW);
  const b = issueRecoveryToken(NOW);
  const stored = { tokenHash: a.tokenHash, expiresAt: a.expiresAt, consumedAt: null, revokedAt: null };
  assert.deepEqual(checkRecoveryToken(b.token, stored, NOW), { ok: false, reason: "not_found" });
});

/* ------------------------------------------------------------------ *
 * PAROL
 * ------------------------------------------------------------------ */

test("parol: kamida 8, ko'pi bilan 72, ikki nusxa bir xil", () => {
  assert.match(checkNewPassword("qisqa", "qisqa") ?? "", /kamida 8/);
  assert.match(checkNewPassword("x".repeat(73), "x".repeat(73)) ?? "", /uzun/);
  assert.match(checkNewPassword("        ", "        ") ?? "", /bo'sh/);
  assert.match(checkNewPassword("Yaxshi-parol1", "Yaxshi-parol2") ?? "", /bir xil emas/);
  assert.equal(checkNewPassword("Yaxshi-parol1", "Yaxshi-parol1"), null);
});

test("havola ommaviy saytdagi tiklash sahifasiga olib boradi", () => {
  const url = recoveryUrl("https://liderlar.uz", "AbC-_123");
  assert.equal(url, "https://liderlar.uz/akkaunt/tiklash/AbC-_123");
});

/* ------------------------------------------------------------------ *
 * IKKI REPO
 * ------------------------------------------------------------------ */

test("recovery-token.ts ikkala repoda bayt-baytigacha bir xil", { skip: NEEDS_OTHER }, () => {
  const mine = readFileSync("src/lib/accounts/recovery-token.ts", "utf8");
  const theirs = readFileSync(join(OTHER, "src/lib/accounts/recovery-token.ts"), "utf8");
  assert.equal(mine, theirs);
});

test("account-recovery.test.ts ikkala repoda bir xil", { skip: NEEDS_OTHER }, () => {
  assert.equal(
    readFileSync("tests/account-recovery.test.ts", "utf8"),
    readFileSync(join(OTHER, "tests/account-recovery.test.ts"), "utf8"),
  );
});

test("admin: havola faqat members.manage bilan, xodim hisobiga emas, email yo'q", { skip: !IS_ADMIN && NEEDS_OTHER }, () => {
  const action = readFileSync(join(ADMIN, "src/lib/actions/accounts.ts"), "utf8");
  const fn = action.match(/export async function createRecoveryLinkAction\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(fn, /requirePermission\("members\.manage"\)/);
  assert.doesNotMatch(fn, /resetPasswordForEmail|generateLink|password/i);

  const service = readFileSync(join(ADMIN, "src/lib/accounts/recovery-service.ts"), "utf8");
  assert.match(service, /from\("user_roles"\)/, "xodim hisobi tekshirilmayapti");
  assert.match(service, /token_hash: issued\.tokenHash/);
  // Eski havola yangisidan OLDIN bekor qilinadi.
  assert.ok(service.indexOf("revoke_reason") < service.indexOf(".insert({"), "eski havola bekor qilinmayapti");
});

test("sayt: havola SHARTLI egallanadi, yiqilsa qaytariladi, parol log'ga tushmaydi", { skip: IS_ADMIN && NEEDS_OTHER }, () => {
  const service = readFileSync(join(WEB, "src/lib/accounts/recovery-service.ts"), "utf8");
  const fn = service.match(/export async function completeRecovery\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(fn.length > 0, "completeRecovery topilmadi");

  // Mutex: faqat ishlatilmagan, bekor qilinmagan, muddati o'tmagan havola.
  assert.match(fn, /\.is\("consumed_at", null\)/);
  assert.match(fn, /\.is\("revoked_at", null\)/);
  assert.match(fn, /\.gt\("expires_at", claimedAt\)/);
  // Egallash parol yozilishidan OLDIN.
  assert.ok(fn.indexOf('update({ consumed_at: claimedAt })') < fn.indexOf("updateUserById"));
  // Yiqilsa — faqat aynan shu egallash qaytariladi.
  assert.match(fn, /\.eq\("consumed_at", claimedAt\)/);
  // Eski sessiyalar yopiladi.
  assert.match(fn, /revoke_user_sessions/);

  // Parol hech qayerda log'ga yoki jurnalga tushmaydi.
  // `password` O'ZGARUVCHISI (katta harfli log kaliti emas) uzatilmasligi tekshiriladi.
  for (const line of fn.split("\n").filter((l) => /console\.|recordAudit|metadata/.test(l))) {
    assert.doesNotMatch(line, /\bpassword\b/, `parol log/jurnalga tushyapti: ${line.trim()}`);
  }
  // Yangi hisob yoki nomzod yaratilmaydi.
  assert.doesNotMatch(service, /createUser|from\("candidates"\)\s*\.\s*(insert|update|upsert)/);
});

test("migratsiya: jadval yopiq, faqat hash, muddat bazada ham cheklangan", { skip: !IS_ADMIN && NEEDS_OTHER }, () => {
  const sql = readFileSync(join(ADMIN, "supabase/migrations/20261003120000_account_recovery.sql"), "utf8");
  assert.match(sql, /token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /alter table public\.account_recoveries enable row level security/);
  assert.match(sql, /revoke all on table public\.account_recoveries from anon, authenticated/);
  assert.doesNotMatch(sql, /create policy[^;]*account_recoveries/i, "jadvalga siyosat qo'shilgan");
  assert.match(sql, /interval '72 hours'/);
  assert.match(sql, /revoke all on function public\.revoke_user_sessions\(uuid\) from public, anon, authenticated/);
  // Parol USTUNI yo'q (hodisa nomlari — `password_reset_completed` — ustun emas).
  assert.doesNotMatch(sql, /^\s*\w*password\w*\s+(text|varchar|bytea|char)/im, "migratsiyada parol ustuni bor");
});
