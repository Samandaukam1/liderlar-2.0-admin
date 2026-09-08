import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isStaleRun,
  PIPELINE_STALE_AFTER_MS,
  recoveredIntakeStatus,
} from "../src/lib/post-studio/pipeline-recovery.ts";
import { formatDate } from "../src/lib/utils.ts";
import { TASHKENT_TZ } from "../src/lib/tashkent-day.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const NOW = new Date("2026-09-07T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

/* ================= 1. UZILGAN YUGURISHNI ANIQLASH ====================== */

test("hali ishlayotgan yugurish o‘lgan deb belgilanmaydi", () => {
  // Cron funksiyasining chegarasi 300s; 5 daqiqalik yugurish normal.
  assert.equal(isStaleRun(minutesAgo(5), NOW), false);
  assert.equal(isStaleRun(minutesAgo(14), NOW), false);
});

test("15 daqiqadan oshgan yugurish o‘lgan deb hisoblanadi", () => {
  assert.equal(isStaleRun(minutesAgo(15), NOW), true);
  assert.equal(isStaleRun(minutesAgo(120), NOW), true);
  assert.equal(PIPELINE_STALE_AFTER_MS, 15 * 60 * 1000);
});

test("boshlanish vaqti noma’lum bo‘lsa ham tiklanadi", () => {
  // Eski yozuvlarda `post_pipeline_started_at` bo'lmasligi mumkin —
  // ular abadiy osilib qolmasligi kerak.
  assert.equal(isStaleRun(null, NOW), true);
  assert.equal(isStaleRun(undefined, NOW), true);
  assert.equal(isStaleRun("buzuq-sana", NOW), true);
});

/* ================= 2. "AI KO‘RMOQDA" DAN QAYTISH ======================= */

test("tasdiqlangan anketa approved ga qaytadi", () => {
  assert.equal(recoveredIntakeStatus("ai_reviewing", "2026-09-01T10:00:00Z"), "approved");
});

test("tasdiqlanmagan anketa submitted ga qaytadi", () => {
  assert.equal(recoveredIntakeStatus("ai_reviewing", null), "submitted");
});

test("boshqa statuslarga TEGILMAYDI", () => {
  // `published` yoki `needs_clarification` ni orqaga surish real
  // ma'lumotni yo'qotardi.
  for (const status of ["published", "needs_clarification", "approved", "promoted", "draft"]) {
    assert.equal(recoveredIntakeStatus(status, null), null, status);
  }
});

/* ============ 3. TIKLASH HAQIQATAN QUVURGA ULANGAN ===================== */

const PIPELINE = readFileSync(join(ROOT, "src/lib/post-studio/pipeline.ts"), "utf8");

test("uzilgan yugurishlar HAR yugurishdan oldin tiklanadi", () => {
  assert.match(PIPELINE, /export async function recoverStalePipelines/);
  const runDue = PIPELINE.slice(PIPELINE.indexOf("export async function runDuePipelines"));
  // Tiklash `findDueIntakes` dan OLDIN turishi shart, aks holda o'sha
  // tikda ular baribir ko'rinmaydi.
  assert.ok(
    runDue.indexOf("recoverStalePipelines()") < runDue.indexOf("findDueIntakes"),
    "tiklash navbatni o‘qishdan keyin qolib ketgan",
  );
});

test("tiklash urinishlar sonini nolga qaytarmaydi", () => {
  // Aks holda doim yiqiladigan anketa cheksiz aylanardi:
  // PIPELINE_MAX_ATTEMPTS cheklovi kuchda qolishi shart.
  const block = PIPELINE.slice(
    PIPELINE.indexOf("export async function recoverStalePipelines"),
    PIPELINE.indexOf("async function markPipeline"),
  );
  assert.ok(!/post_pipeline_attempts\s*:/.test(block), "urinishlar soni qayta yozilyapti");
  assert.match(block, /post_pipeline_status: "pending"/);
});

/* ========== 4. TO‘LOV QILGAN NOMZOD NAVBATDA KUTIB QOLMAYDI ============ */

test("to‘lov quvuri nashr navbati bilan raqobatlashmaydi", () => {
  const cron = readFileSync(
    join(ROOT, "src/app/api/cron/intake-publish-batches/route.ts"),
    "utf8",
  );
  // Izohlar olib tashlanadi: eski shart aynan izohda TUSHUNTIRILGAN
  // va uni matn sifatida qidirish o‘z hujjatimizni xato deb ko‘rsatardi.
  const code = cron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  // Oldin `batch.itemId ? [] : ...` edi — navbat ishlayotganda to'lov
  // qilgan nomzod UMUMAN ishlanmasdi.
  assert.ok(!/batch\.itemId\s*\?/.test(code), "to‘lov quvuri navbatga bog‘liq qolgan");
  assert.match(code, /const paymentTriggered = await runDuePipelines\(1\)/);
});

test("to‘lov tasdiqlangach kechikish YO‘Q", () => {
  const messages = readFileSync(join(ROOT, "src/lib/intake/payment-messages.ts"), "utf8");
  assert.match(messages, /INTAKE_PUBLISH_DELAY_MINUTES/);
  // Standart qiymat — darhol.
  assert.match(messages, /\?\?\s*"0"/);
  assert.ok(!/PAYMENT_PUBLISH_DELAY_MS = 10 \* 60 \* 1000/.test(messages));
});

test("“AI ko‘rmoqda” anketa navbat taxtasidan yo‘qolmaydi", () => {
  const batch = readFileSync(join(ROOT, "src/lib/intake/publish-batch.ts"), "utf8");
  const queue = batch.slice(batch.indexOf("const QUEUE_STATUSES"), batch.indexOf("export type PaymentStatus"));
  assert.ok(queue.includes('"ai_reviewing"'));
});

test("quvur har daqiqada tekshiriladi", () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const cron = vercel.crons.find((c) => c.path === "/api/cron/intake-publish-batches");
  assert.equal(cron?.schedule, "* * * * *");
});

/* ================== 5. VAQT — ASIA/TASHKENT BO‘YICHA =================== */

test("vaqt UTC emas, Toshkent bo‘yicha ko‘rsatiladi", () => {
  // Vercel serveri UTC'da ishlaydi. Zona ko'rsatilmasa, kechqurun
  // 21:30 da topshirilgan ariza ro'yxatda 16:30 bo'lib chiqardi.
  const formatted = formatDate("2026-09-07T16:30:00.000Z", true);
  assert.match(formatted, /21:30/);
  assert.ok(!formatted.includes("16:30"));
});

test("yarim tundan keyingi ariza to‘g‘ri KUNDA ko‘rinadi", () => {
  // UTC 20:00 = Toshkent ertasi kun 01:00. Zona hisobga olinmasa,
  // ariza bir kun oldin topshirilgandek ko'rinardi.
  const formatted = formatDate("2026-09-07T20:00:00.000Z", true);
  assert.match(formatted, /08/);
  assert.match(formatted, /01:00/);
});

test("soat 24 formatda — tushdan keyingimi, kechasimi degan savol qolmasin", () => {
  const formatted = formatDate("2026-09-07T10:00:00.000Z", true);
  assert.match(formatted, /15:00/);
  assert.ok(!/AM|PM/i.test(formatted));
});

test("sana ham zonaga bog‘langan va zona bitta manbadan", () => {
  assert.equal(TASHKENT_TZ, "Asia/Tashkent");
  const utils = readFileSync(join(ROOT, "src/lib/utils.ts"), "utf8");
  // Ikkala formatlagichda ham zona ko'rsatilgan bo'lishi shart.
  const block = utils.slice(utils.indexOf("export function formatDate"), utils.indexOf("export function timeAgo"));
  assert.equal((block.match(/timeZone: TASHKENT_TZ/g) ?? []).length, 2);
});

test("bo‘sh yoki buzuq sana chiziqcha beradi", () => {
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(undefined), "—");
  assert.equal(formatDate("buzuq"), "—");
});
