import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UZBEKISTAN_REGIONS,
  REGION_POLL_QUESTION,
  REGION_POLL_BUTTON_LABEL,
  REGION_POLL_COMMAND,
  REGION_POLL_HINT,
  buildRegionPoll,
  validateRegionPoll,
  POLL_OPTION_MAX,
  POLL_OPTIONS_MAX,
  POLL_QUESTION_MAX,
} from "../src/lib/post-studio/region-poll.ts";

const router = readFileSync("src/lib/post-studio/bot-router.ts", "utf8");
const api = readFileSync("src/lib/post-studio/telegram-api.ts", "utf8");
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ========================= 1. HUDUDLAR RO'YXATI ======================== */

test("aynan 14 ta hudud", () => {
  // 12 viloyat + Qoraqalpog'iston Respublikasi + Toshkent shahri.
  assert.equal(UZBEKISTAN_REGIONS.length, 14);
});

test("12 ta viloyat, respublika va shahar alohida", () => {
  const viloyat = UZBEKISTAN_REGIONS.filter((r) => r.endsWith("viloyati"));
  assert.equal(viloyat.length, 12, `viloyatlar: ${viloyat.length}`);
  assert.ok(UZBEKISTAN_REGIONS.includes("Qoraqalpog‘iston Respublikasi"));
  assert.ok(UZBEKISTAN_REGIONS.includes("Toshkent shahri"));
});

test("barcha 12 viloyat nomma-nom bor", () => {
  for (const name of [
    "Andijon", "Buxoro", "Farg‘ona", "Jizzax", "Namangan", "Navoiy",
    "Qashqadaryo", "Samarqand", "Sirdaryo", "Surxondaryo", "Toshkent", "Xorazm",
  ]) {
    assert.ok(
      UZBEKISTAN_REGIONS.includes(`${name} viloyati`),
      `${name} viloyati yo‘q`,
    );
  }
});

test("Toshkent IKKI marta — viloyat va shahar alohida", () => {
  // Ularni birlashtirish poytaxt va uning atrofidagi tumanlarni bir
  // xil deb ko'rsatardi — bu ikki boshqa auditoriya.
  const toshkent = UZBEKISTAN_REGIONS.filter((r) => r.startsWith("Toshkent"));
  assert.deepEqual(toshkent, ["Toshkent viloyati", "Toshkent shahri"]);
});

test("hech bir hudud takrorlanmaydi", () => {
  // Takroriy variant ovozlarni ikkiga bo‘lib, natijani ma’nosiz qiladi.
  assert.equal(new Set(UZBEKISTAN_REGIONS).size, UZBEKISTAN_REGIONS.length);
});

test("nomlarda o‘zbek apostrofi ishlatilgan", () => {
  // ASCII ' emas, tipografik ‘ — qolgan matnlar bilan bir xil.
  assert.ok(UZBEKISTAN_REGIONS.includes("Farg‘ona viloyati"));
  assert.ok(UZBEKISTAN_REGIONS.includes("Qoraqalpog‘iston Respublikasi"));
  for (const region of UZBEKISTAN_REGIONS) {
    assert.ok(!region.includes("'"), `ASCII apostrof: ${region}`);
  }
});

/* ========================== 2. SAVOL MATNI ============================= */

test("savol so‘ralgan shaklda", () => {
  assert.equal(REGION_POLL_QUESTION, "Qaysi viloyatdan bizni kuzatyapsiz siz?");
});

/* ===================== 3. TELEGRAM CHEGARALARI ========================= */

test("so‘rovnoma Telegram chegaralariga sig‘adi", () => {
  const poll = buildRegionPoll();
  const checked = validateRegionPoll(poll);
  assert.equal(checked.ok, true, checked.error ?? "");

  assert.ok(poll.question.length <= POLL_QUESTION_MAX);
  assert.ok(poll.options.length <= POLL_OPTIONS_MAX);
  for (const option of poll.options) {
    assert.ok(option.length <= POLL_OPTION_MAX, option);
  }
});

test("14 ta variant chegaradan oshmaydi", () => {
  // Chegara 30 ta (Bot API hujjatidan tekshirildi). Eski 10/12
  // chegarasi haqidagi taxmin bu yerda ishlatilmaydi.
  assert.equal(POLL_OPTIONS_MAX, 30);
  assert.ok(UZBEKISTAN_REGIONS.length < POLL_OPTIONS_MAX);
});

test("tekshiruv haqiqiy xatolarni TUTADI", () => {
  const base = buildRegionPoll();

  assert.equal(validateRegionPoll({ ...base, question: "" }).ok, false);
  assert.equal(validateRegionPoll({ ...base, question: "x".repeat(301) }).ok, false);
  assert.equal(validateRegionPoll({ ...base, options: [] }).ok, false);
  assert.equal(
    validateRegionPoll({ ...base, options: Array.from({ length: 31 }, (_, i) => `v${i}`) }).ok,
    false,
  );
  assert.equal(validateRegionPoll({ ...base, options: ["a", "a"] }).ok, false);
  assert.equal(validateRegionPoll({ ...base, options: ["a", "x".repeat(101)] }).ok, false);
});

/* ======================= 4. KANALGA UZATISH ============================ */

test("so‘rovnoma ANONIM — aks holda kanalga uzatib bo‘lmaydi", () => {
  /*
   * Telegram kanallarda faqat anonim so'rovnomaga ruxsat beradi va
   * anonim bo'lmaganini kanalga forward qilib ham bo'lmaydi. Bu
   * qiymat o'zgarsa, butun ish bekor bo'lardi.
   */
  const poll = buildRegionPoll();
  assert.equal(poll.isAnonymous, true);
});

test("bitta odam bitta hudud tanlaydi", () => {
  assert.equal(buildRegionPoll().allowsMultipleAnswers, false);
});

test("bot MODERATOR chatiga yuboradi, kanalga emas", () => {
  // Kanal identifikatori hech qayerda saqlanmagan va bot u yerda
  // admin ekani kafolatlanmagan. Moderator bir bosishda uzatadi.
  assert.match(REGION_POLL_HINT, /kanalga uzating/i);
  const fn = code(router).slice(code(router).indexOf("async function sendRegionPoll"));
  assert.ok(fn.includes("sendTelegramPoll(chatId"), "moderator chatiga");
});

/* ========================= 5. BOTGA ULANGAN =========================== */

test("tugma ham, komanda ham bor va tahririyat bilan cheklangan", () => {
  assert.ok(code(router).includes("REGION_POLL_BUTTON_LABEL"));
  assert.ok(router.includes(REGION_POLL_COMMAND), "yordam matnida ko‘rinsin");

  const branch = code(router).slice(code(router).indexOf("REGION_POLL_COMMAND || text ==="));
  const guard = branch.indexOf("if (!editorial) return deny(");
  const send = branch.indexOf("sendRegionPoll(");
  assert.ok(guard !== -1 && guard < send, "ruxsat tekshiruvi yuborishdan OLDIN");
});

test("chegara CHAQIRUVDAN OLDIN tekshiriladi", () => {
  // Telegram chegaradan oshganini 400 bilan rad etadi va moderator
  // "nega ishlamadi" degan savol bilan qolardi.
  const fn = code(router).slice(code(router).indexOf("async function sendRegionPoll"));
  const validate = fn.indexOf("validateRegionPoll(poll)");
  const send = fn.indexOf("sendTelegramPoll(");
  assert.ok(validate !== -1 && validate < send);
});

test("yuborish xatosi jim qolmaydi", () => {
  const fn = code(router).slice(code(router).indexOf("async function sendRegionPoll"));
  assert.ok(fn.includes("catch"), "xato ushlansin");
  assert.ok(fn.includes("So‘rovnoma yuborilmadi"), "moderatorga aytilsin");
});

test("variantlar Telegram’ga JSON satri sifatida ketadi", () => {
  // Telegram `options` ni massiv emas, JSON-serialized satr kutadi.
  const fn = code(api).slice(code(api).indexOf("export async function sendTelegramPoll"));
  assert.ok(fn.includes("JSON.stringify(input.options)"));
});

test("tugma yorlig‘i router’da takrorlanmaydi", () => {
  assert.ok(!router.includes(REGION_POLL_BUTTON_LABEL), "konstantadan olinsin");
});
