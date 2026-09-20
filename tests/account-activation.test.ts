import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  issueActivationToken,
  checkActivationToken,
  activationState,
  clampTtl,
  activationUrl,
  DEFAULT_TTL_HOURS,
} from "../src/lib/accounts/activation-token.ts";
import {
  ACCOUNT_STATE_LABEL,
  ACCOUNT_FILTER_LABEL,
} from "../src/lib/accounts/account-types.ts";

const NOW = new Date("2026-09-20T10:00:00Z");

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ---------------------------------------------------------------
// TOKEN
// ---------------------------------------------------------------

test("token bazaga OCHIQ holda yozilmaydi", () => {
  const issued = issueActivationToken(NOW);

  assert.notEqual(issued.token, issued.tokenHash);
  assert.equal(issued.tokenHash, createHash("sha256").update(issued.token).digest("hex"));
  assert.match(issued.tokenHash, /^[0-9a-f]{64}$/);
});

test("token URL uchun xavfsiz va taxmin qilib bo'lmas", () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 300; i += 1) {
    const t = issueActivationToken(NOW).token;
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    // 24 bayt base64url ≈ 32 belgi.
    assert.ok(t.length >= 30, `juda qisqa: ${t.length}`);
    tokens.add(t);
  }
  assert.equal(tokens.size, 300);
});

test("yaroqli token qabul qilinadi", () => {
  const issued = issueActivationToken(NOW);
  const check = checkActivationToken(issued.token, {
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
    consumedAt: null,
    revokedAt: null,
  }, NOW);

  assert.equal(check.ok, true);
});

test("ISHLATILGAN token rad etiladi", () => {
  const issued = issueActivationToken(NOW);
  const check = checkActivationToken(issued.token, {
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
    consumedAt: "2026-09-20T10:05:00Z",
    revokedAt: null,
  }, NOW);

  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.reason, "consumed");
});

test("BEKOR QILINGAN token rad etiladi — muddati tugagan bo'lsa ham", () => {
  /*
   * Admin uni ATAYLAB bekor qilgan va bu sabab "muddati
   * tugadi" dan muhimroq: foydalanuvchi yangi havola so'rasa,
   * admin nega bekor qilganini eslaydi.
   */
  const issued = issueActivationToken(NOW, 1);
  const check = checkActivationToken(issued.token, {
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
    consumedAt: null,
    revokedAt: "2026-09-20T10:10:00Z",
  }, new Date("2026-09-25T10:00:00Z"));

  assert.equal(check.ok === false && check.reason, "revoked");
});

test("MUDDATI O'TGAN token rad etiladi", () => {
  const issued = issueActivationToken(NOW, 1);
  const check = checkActivationToken(issued.token, {
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
    consumedAt: null,
    revokedAt: null,
  }, new Date("2026-09-20T12:00:00Z"));

  assert.equal(check.ok === false && check.reason, "expired");
});

test("BUZILGAN token 'topilmadi' deb rad etiladi", () => {
  /*
   * "Noto'g'ri" deyish tokenlar qanday saqlanishi haqida
   * ma'lumot berardi va mavjud taklifnomani taxmin qilishni
   * osonlashtirardi.
   */
  const issued = issueActivationToken(NOW);
  const check = checkActivationToken(issued.token + "x", {
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
    consumedAt: null,
    revokedAt: null,
  }, NOW);

  assert.equal(check.ok === false && check.reason, "not_found");
});

test("BOSHQA nomzodning tokeni ishlamaydi", () => {
  const mine = issueActivationToken(NOW);
  const other = issueActivationToken(NOW);

  const check = checkActivationToken(other.token, {
    tokenHash: mine.tokenHash,
    expiresAt: mine.expiresAt,
    consumedAt: null,
    revokedAt: null,
  }, NOW);

  assert.equal(check.ok === false && check.reason, "not_found");
});

test("muddat chegaralanadi — sozlamadagi xato havolani abadiy qilmaydi", () => {
  /*
   * Sozlamaga tasodifan "0" yoki "99999" yozilishi mumkin.
   * Birinchisi taklifnomani darhol o'lik qilardi, ikkinchisi
   * uni amalda abadiy kalitga aylantirardi.
   */
  assert.equal(clampTtl(0), 1);
  assert.equal(clampTtl(-5), 1);
  assert.equal(clampTtl(99999), 24 * 14);
  assert.equal(clampTtl(Number.NaN), DEFAULT_TTL_HOURS);
  assert.equal(clampTtl(48), 48);
});

test("holat aniqlashda tartib: bekor > ishlatilgan > muddat", () => {
  const base = { tokenHash: "x", expiresAt: "2026-09-19T10:00:00Z" };

  assert.equal(
    activationState({ ...base, consumedAt: "2026-09-20T09:00:00Z", revokedAt: "2026-09-20T09:00:00Z" }, NOW),
    "revoked",
  );
  assert.equal(activationState({ ...base, consumedAt: "2026-09-20T09:00:00Z", revokedAt: null }, NOW), "consumed");
  assert.equal(activationState({ ...base, consumedAt: null, revokedAt: null }, NOW), "expired");
  assert.equal(activationState(null, NOW), "not_found");
});

test("havola OMMAVIY saytga ishora qiladi, admin panelga emas", () => {
  const url = activationUrl("https://liderlar.uz", "abc-123");

  assert.equal(url, "https://liderlar.uz/akkaunt/faollashtirish/abc-123");
  assert.ok(!url.includes("admin"));
});

test("havoladagi token kodlanadi", () => {
  // base64url da `-` va `_` bor; boshqa belgilar kelib qolsa
  // ular havolani buzmasligi kerak.
  assert.ok(activationUrl("https://liderlar.uz", "a/b c").includes("a%2Fb%20c"));
});

// ---------------------------------------------------------------
// XAVFSIZLIK: PAROL VA SIRLAR
// ---------------------------------------------------------------

test("hech qayerda ochiq parol saqlanmaydi", () => {
  /*
   * Bu butun bosqichning asosiy talabi. Parol degan ustun
   * paydo bo'lsa, u ertami-kechmi o'qiladi.
   */
  const migration = readFileSync(
    "supabase/migrations/20260920180000_candidate_activations.sql",
    "utf8",
  );
  const code = stripAll([
    "src/lib/accounts/activation-service.ts",
    "src/lib/accounts/account-report.ts",
    "src/lib/actions/accounts.ts",
  ]);

  /*
   * Qidirilayotgani SO'Z emas, USTUN.
   *
   * Migratsiyada `password_reset_requested` degan hodisa nomi
   * bor va u mutlaqo o'rinli — birinchi variant aynan o'shanga
   * tushib, bejiz yiqilgan edi.
   */
  const columns = [...migration.matchAll(/^\s*(\w+)\s+(text|varchar|bytea)\b/gim)].map((m) => m[1]);
  for (const column of columns) {
    assert.ok(
      !/password|parol|secret/i.test(column),
      `migratsiyada shubhali ustun: ${column}`,
    );
  }

  // Kodda ham parol qiymati o'zgaruvchiga olinmaydi.
  assert.ok(!/\bpassword\s*[:=]\s*[^=]/i.test(code), "kodda parol qiymati bor");
  assert.ok(!/plaintext|ochiq_parol/i.test(code));
});

test("token FAQAT hash sifatida saqlanadi", () => {
  const migration = readFileSync(
    "supabase/migrations/20260920180000_candidate_activations.sql",
    "utf8",
  );
  const table = migration.match(/create table if not exists public\.candidate_activations[\s\S]*?\n\);/)?.[0] ?? "";

  assert.ok(table.length > 0, "jadval topilmadi");
  assert.match(table, /token_hash text not null unique/);
  assert.ok(!/\btoken text\b/.test(table), "ochiq token ustuni bor");
});

test("faollashtirish jadvali HECH KIMGA ochilmagan", () => {
  /*
   * Admin ham PostgREST orqali o'qimaydi: ro'yxatni server
   * tayyorlaydi. Anon esa taklifnomalarni sanab chiqa
   * olmasligi kerak.
   */
  const migration = readFileSync(
    "supabase/migrations/20260920180000_candidate_activations.sql",
    "utf8",
  );

  assert.match(migration, /alter table public\.candidate_activations enable row level security/);
  assert.ok(
    !/create policy \w+ on public\.candidate_activations/.test(migration),
    "candidate_activations uchun siyosat yaratilgan",
  );
});

test("bitta auth hisob — bitta nomzod", () => {
  const migration = readFileSync(
    "supabase/migrations/20260920180000_candidate_activations.sql",
    "utf8",
  );

  assert.match(migration, /create unique index if not exists candidates_user_id_uidx/);
  // Mavjud dublikatlar jimgina "tuzatilmaydi" — migratsiya to'xtaydi.
  assert.match(migration, /raise exception/);
});

test("bitta nomzod — bitta amaldagi taklifnoma", () => {
  const migration = readFileSync(
    "supabase/migrations/20260920180000_candidate_activations.sql",
    "utf8",
  );
  assert.match(migration, /candidate_activations_one_active_uidx/);
});

// ---------------------------------------------------------------
// RUXSAT VA IDEMPOTENTLIK
// ---------------------------------------------------------------

test("barcha hisob action'lari members.manage talab qiladi", () => {
  /*
   * Tugmani yashirish himoya emas: action'ni to'g'ridan-to'g'ri
   * chaqirib bo'ladi.
   */
  const code = src("src/lib/actions/accounts.ts");
  const actions = [...code.matchAll(/export async function (\w+Action)\s*\([\s\S]*?\n\}/g)];

  assert.ok(actions.length >= 4, `kutilganidan kam action: ${actions.length}`);
  for (const [body, name] of actions) {
    assert.match(body, /requirePermission\("members\.manage"\)/, `${name} ruxsatni tekshirmaydi`);
  }
});

test("bekor qilish va bloklash SHARTLI UPDATE ishlatadi", () => {
  /*
   * Avval o'qib keyin yozsak, ikki admin bir vaqtda bosganda
   * ikkalasiga ham "mumkin" ko'rinardi.
   */
  const service = src("src/lib/accounts/activation-service.ts");
  assert.match(service, /\.is\("consumed_at", null\)[\s\S]*?\.is\("revoked_at", null\)/);

  const actions = src("src/lib/actions/accounts.ts");
  assert.match(actions, /\.eq\("status", "disabled"\)/);
});

test("taklifnomani egallash MUTEX sifatida ishlaydi", () => {
  const service = src("src/lib/accounts/activation-service.ts");
  const consume = service.match(/export async function consumeActivation\([\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(consume.length > 0, "consumeActivation topilmadi");
  // Egallash shartlari: ishlatilmagan, bekor qilinmagan, muddati o'tmagan.
  assert.match(consume, /\.is\("consumed_at", null\)/);
  assert.match(consume, /\.is\("revoked_at", null\)/);
  assert.match(consume, /\.gt\("expires_at", nowIso\)/);
  // Nomzodni bog'lash ham shartli.
  assert.match(consume, /\.is\("user_id", null\)/);
});

test("bloklash MA'LUMOTNI O'CHIRMAYDI", () => {
  /*
   * Bloklash — kirishni cheklash. Nomzod sahifasi, maqolasi,
   * MEHR tarixi va sertifikatlari joyida qolishi SHART.
   */
  const code = src("src/lib/actions/accounts.ts");
  const fn = code.match(/export async function blockAccountAction\([\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(fn.length > 0, "blockAccountAction topilmadi");
  assert.ok(!/\.delete\(\)/.test(fn), "bloklash o'chirish qilyapti");
  assert.ok(!/from\("candidates"\)/.test(fn), "bloklash nomzodga tegyapti");
  assert.match(fn, /status: "disabled"/);
});

test("admin yangi parolni KO'RMAYDI", () => {
  const code = src("src/lib/actions/accounts.ts");
  const fn = code.match(/export async function sendPasswordResetAction\([\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(fn.length > 0);
  assert.match(fn, /resetPasswordForEmail/);
  // Javobda parol yo'q — faqat "yuborildi" fakti.
  assert.ok(!/password:/i.test(fn));
});

// ---------------------------------------------------------------
// MIJOZ/SERVER CHEGARASI
// ---------------------------------------------------------------

test("hisob sahifasi server-only moduldan QIYMAT import qilmaydi", () => {
  const serverOnly = ["src/lib/accounts/activation-service.ts", "src/lib/accounts/account-report.ts"]
    .filter((f) => /^import ["']server-only["']/m.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(/^src\//, "@/").replace(/\.ts$/, ""));

  assert.equal(serverOnly.length, 2);

  const code = readFileSync("src/app/(admin)/foydalanuvchilar/account-table.tsx", "utf8");
  assert.match(code, /^["']use client["']/m);

  for (const statement of code.match(/^import\s+[\s\S]*?from\s+["'][^"']+["'];/gm) ?? []) {
    if (/^import\s+type\s/.test(statement)) continue;
    const mod = statement.match(/from\s+["']([^"']+)["']/)?.[1];
    if (mod && serverOnly.includes(mod)) {
      assert.fail(`account-table.tsx ${mod} dan QIYMAT import qilyapti`);
    }
  }
});

test("tiplar moduli server-only emas", () => {
  const code = src("src/lib/accounts/account-types.ts");
  assert.ok(!/import\s+["']server-only["']/.test(code));
  assert.ok(!/from\s+["']@\/lib\/supabase/.test(code));
});

test("holat yorliqlari to'liq", () => {
  assert.equal(Object.keys(ACCOUNT_STATE_LABEL).length, 5);
  assert.equal(Object.keys(ACCOUNT_FILTER_LABEL).length, 7);
  assert.equal(ACCOUNT_STATE_LABEL.needs_attention, "E'tibor kerak");
});

function stripAll(paths: string[]): string {
  return paths.map((p) => src(p)).join("\n");
}
