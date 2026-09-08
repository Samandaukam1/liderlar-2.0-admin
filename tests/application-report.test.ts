import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tashkentReportWindow } from "../src/lib/tashkent-day.ts";
import {
  buildBotStatusReportText,
  type ApplicationCounts,
  type BotStatusCounts,
} from "../src/lib/intake/payment-messages.ts";

const ROOT = new URL("..", import.meta.url).pathname;

/* ==================== 1. 19:00 → 19:00 OYNASI ========================== */

test("kechqurun 19:00 dan keyin oyna BUGUN boshlanadi", () => {
  // Toshkentda 20:00 = UTC 15:00.
  const window = tashkentReportWindow(new Date("2026-09-07T15:00:00.000Z"));
  assert.equal(window.date, "2026-09-07");
  // 19:00 Toshkent = 14:00 UTC.
  assert.equal(window.startIso, "2026-09-07T14:00:00.000Z");
  assert.equal(window.endIso, "2026-09-08T14:00:00.000Z");
});

test("ertalab oyna KECHA boshlangan bo‘ladi", () => {
  // Toshkentda 09:00 = UTC 04:00 — hali 19:00 bo‘lmagan.
  const window = tashkentReportWindow(new Date("2026-09-07T04:00:00.000Z"));
  assert.equal(window.date, "2026-09-06");
  assert.equal(window.startIso, "2026-09-06T14:00:00.000Z");
  assert.equal(window.endIso, "2026-09-07T14:00:00.000Z");
});

test("aynan 19:00 da yangi oyna boshlanadi", () => {
  // Chegara EKSKLYUZIV: 19:00:00 da kelgan ariza faqat yangi oynaga tegishli.
  const at19 = tashkentReportWindow(new Date("2026-09-07T14:00:00.000Z"));
  assert.equal(at19.date, "2026-09-07");
  const justBefore = tashkentReportWindow(new Date("2026-09-07T13:59:59.000Z"));
  assert.equal(justBefore.date, "2026-09-06");
  // Ikki oyna tutashadi — orada tushib qolgan soniya yo‘q.
  assert.equal(justBefore.endIso, at19.startIso);
});

test("oyna doim aniq 24 soat", () => {
  for (const iso of ["2026-01-15T02:00:00Z", "2026-06-30T22:00:00Z", "2026-12-31T14:00:00Z"]) {
    const window = tashkentReportWindow(new Date(iso));
    const hours =
      (new Date(window.endIso).getTime() - new Date(window.startIso).getTime()) / 3_600_000;
    assert.equal(hours, 24, iso);
  }
});

test("yarim tun oynani BUZMAYDI", () => {
  // Toshkent 23:00 (UTC 18:00) va 01:00 (UTC 20:00) — bir xil oyna.
  const before = tashkentReportWindow(new Date("2026-09-07T18:00:00.000Z"));
  const after = tashkentReportWindow(new Date("2026-09-07T20:00:00.000Z"));
  assert.equal(before.startIso, after.startIso);
  assert.equal(before.date, "2026-09-07");
});

/* ================= 2. XATCHO‘P MANTIG‘I (manba darajasida) ============= */

const PAYMENT = readFileSync(join(ROOT, "src/lib/intake/payment.ts"), "utf8");
const COUNTER = PAYMENT.slice(
  PAYMENT.indexOf("async function countNewApplications"),
  PAYMENT.indexOf("/** Counts for the bot's"),
);

test("faqat YANGI statusdagi arizalar sanaladi", () => {
  assert.match(COUNTER, /\.eq\("status", "new"\)/);
});

test("xatcho‘p — statusi o‘zgartirilgan ENG SO‘NGGI ariza", () => {
  assert.match(COUNTER, /\.neq\("status", "new"\)/);
  assert.match(COUNTER, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(COUNTER, /\.limit\(1\)/);
});

test("xatcho‘pning O‘ZI qayta sanalmaydi", () => {
  // `gte` bo'lsa, belgilangan arizaning o'zi har safar qaytib kelardi.
  assert.match(COUNTER, /\.gt\("created_at", since\)/);
  assert.ok(!/\.gte\("created_at", since\)/.test(COUNTER));
});

test("xatcho‘p yo‘q bo‘lsa hammasi sanaladi", () => {
  // Birinchi ishlatishda hech qanday status o'zgartirilmagan bo'ladi.
  assert.match(COUNTER, /since \? query\.gt\([^)]*\) : query/);
});

test("bugungi sanoq 19:00 oynasidan oladi", () => {
  assert.match(COUNTER, /\.gte\("created_at", window\.startIso\)/);
  assert.match(COUNTER, /\.lt\("created_at", window\.endIso\)/);
  // Hisobot aynan shu oynani uzatadi.
  assert.match(PAYMENT, /const applicationWindow = tashkentReportWindow\(\)/);
});

test("anketa bloklari kalendar kunida QOLADI", () => {
  // Faqat arizalar 19:00 oynasida — mavjud bloklar o'zgarmaydi.
  assert.match(PAYMENT, /const day = tashkentDayRange\(\)/);
  assert.match(PAYMENT, /todayDate: day\.date/);
});

/* ======================= 3. HISOBOT MATNI ============================== */

const counts = (n: number): BotStatusCounts => ({
  filling: n,
  submitted: n,
  paid: n,
  unpaid: n,
  paymentUnknown: n,
  posts: n,
  published: n,
});

const report = (applications: ApplicationCounts) =>
  buildBotStatusReportText({
    todayDate: "2026-09-07",
    total: counts(10),
    today: counts(1),
    applications,
    applicationWindowLabel: "06-sen 19:00 → 19:00",
  });

test("arizalar soni bugun va jami ko‘rsatiladi", () => {
  const text = report({ today: 4, total: 11, since: "2026-09-06T04:00:00.000Z" });
  assert.match(text, /YANGI ARIZALAR/);
  assert.match(text, /Bugun \(06-sen 19:00 → 19:00\): 4/);
  assert.match(text, /Jami ko‘rilmagan: 11/);
});

test("arizalar bloki BIRINCHI turadi", () => {
  // Moderator hisobotni aynan shu son uchun ochadi.
  const text = report({ today: 4, total: 11, since: null });
  assert.ok(text.indexOf("YANGI ARIZALAR") < text.indexOf("— BUGUN"));
});

test("xatcho‘p vaqti ko‘rsatiladi — hisobot qayerdan boshlangani bilinsin", () => {
  const text = report({ today: 4, total: 11, since: "2026-09-06T04:00:00.000Z" });
  assert.match(text, /Oxirgi belgilangan arizadan keyin/);
  // Toshkent vaqtida: UTC 04:00 = 09:00.
  assert.match(text, /09:00/);
});

test("xatcho‘p yo‘qligi ham OCHIQ aytiladi", () => {
  // "0 dan boshlab sanaldi" degan ma'no yashirin qolmasligi kerak.
  const text = report({ today: 0, total: 0, since: null });
  assert.match(text, /Hali birorta ariza belgilanmagan/);
  assert.ok(!text.includes("Oxirgi belgilangan"));
});

test("mavjud bloklar joyida qoladi", () => {
  const text = report({ today: 0, total: 0, since: null });
  assert.match(text, /— BUGUN \(2026-09-07\) —/);
  assert.match(text, /— JAMI —/);
  assert.match(text, /To‘lov qilgan/);
});
