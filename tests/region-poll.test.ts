import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UZBEKISTAN_REGIONS,
  REGION_POLL_QUESTION,
  REGION_POLL_BUTTON_LABEL,
  REGION_POLL_COMMAND,
  buildRegionPollHint,
  buildRegionPolls,
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
  // Ro'yxat alifbo tartibida: "shahri" < "viloyati".
  assert.deepEqual(toshkent, ["Toshkent shahri", "Toshkent viloyati"]);
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

test("HAR BO‘LAK Telegram chegaralariga sig‘adi", () => {
  for (const poll of buildRegionPolls()) {
    const checked = validateRegionPoll(poll);
    assert.equal(checked.ok, true, checked.error ?? "");
    assert.ok(poll.question.length <= POLL_QUESTION_MAX, poll.question);
    assert.ok(poll.options.length <= POLL_OPTIONS_MAX, `${poll.options.length} ta variant`);
    for (const option of poll.options) {
      assert.ok(option.length <= POLL_OPTION_MAX, option);
    }
  }
});

test("chegara AYNAN Telegram aytgan son", () => {
  /*
   * BU TEST ILGARI BO'SH EDI: u `POLL_OPTIONS_MAX === 30` deb
   * tekshirardi, ya'ni konstantani O'ZIGA solishtirardi. 30 qiymati
   * hujjatni o'qigan yordamchi xulosasidan olingan va noto'g'ri
   * chiqdi — Telegram jonli javobda aytdi:
   *
   *   "Bad Request: poll can't have more than 12 options"
   *
   * Hujjat ham shuni aytadi: "A JSON-serialized list of 1-12
   * answer options".
   *
   * Endi chegara SO'ROVNOMA QURILISHINI boshqaradi: qiymat
   * noto‘g‘ri bo‘lsa, yuqoridagi bo‘lak testi darhol yiqiladi.
   */
  assert.equal(POLL_OPTIONS_MAX, 12);
});

test("14 hudud 12 ta chegaraga BO‘LINADI, hech biri yo‘qolmaydi", () => {
  const polls = buildRegionPolls();
  assert.ok(polls.length > 1, "14 > 12, demak bitta so‘rovnoma yetmaydi");

  const all = polls.flatMap((poll) => poll.options);
  assert.equal(all.length, UZBEKISTAN_REGIONS.length, "bironta hudud tushib qolmasin");
  assert.deepEqual([...all].sort(), [...UZBEKISTAN_REGIONS].sort());
  assert.equal(new Set(all).size, all.length, "hech bir hudud ikki bo‘lakda bo‘lmasin");
});

test("bo‘laklar TENG — ikkinchisi “qo‘shimcha” bo‘lib qolmasin", () => {
  // 12+2 bo'lganda ikkinchisi e'tibordan qolardi va o'sha ikki
  // hudud ovoz bermay ketardi.
  const sizes = buildRegionPolls().map((poll) => poll.options.length);
  assert.deepEqual(sizes, [7, 7]);
});

test("savolda oralig‘i aytiladi — odam qayerga qarashni bilsin", () => {
  const polls = buildRegionPolls();
  assert.match(polls[0].question, /1\/2/);
  assert.match(polls[0].question, /Andijondan/);
  assert.match(polls[1].question, /2\/2/);
  assert.match(polls[1].question, /Xorazmgacha/);
});

test("chegaraga sig‘sa BITTA so‘rovnoma bo‘ladi", () => {
  // Bo'lish avtomatik: hudud soni kamaysa yoki chegara o'zgarsa,
  // kod o'zi moslashadi.
  const few = buildRegionPolls(["Andijon", "Buxoro", "Xorazm"]);
  assert.equal(few.length, 1);
  assert.equal(few[0].question, REGION_POLL_QUESTION);
  assert.ok(!few[0].question.includes("/"), "bitta bo‘lakda raqam yozilmasin");
});

test("tekshiruv haqiqiy xatolarni TUTADI", () => {
  const base = buildRegionPolls()[0];

  assert.equal(validateRegionPoll({ ...base, question: "" }).ok, false);
  assert.equal(validateRegionPoll({ ...base, question: "x".repeat(301) }).ok, false);
  assert.equal(validateRegionPoll({ ...base, options: [] }).ok, false);
  // Chegaradan BITTA ortiq ham rad etilishi kerak — aynan shu
  // chegara noto‘g‘ri bo‘lganda Telegram bizni rad etgan edi.
  assert.equal(
    validateRegionPoll({
      ...base,
      options: Array.from({ length: POLL_OPTIONS_MAX + 1 }, (_, i) => `v${i}`),
    }).ok,
    false,
  );
  assert.equal(
    validateRegionPoll({
      ...base,
      options: Array.from({ length: POLL_OPTIONS_MAX }, (_, i) => `v${i}`),
    }).ok,
    true,
  );
  assert.equal(validateRegionPoll({ ...base, options: ["a", "a"] }).ok, false);
  assert.equal(validateRegionPoll({ ...base, options: ["a", "x".repeat(101)] }).ok, false);
});

/* ======================= 4. KANALGA UZATISH ============================ */

test("izoh ikki qismli ekanini TUSHUNTIRADI", () => {
  // Moderator nega ikkita so'rovnoma kelganini bilishi kerak,
  // aks holda u bittasini uzatib, hududlarning yarmini so'ramay
  // qolardi.
  const hint = buildRegionPollHint(2);
  assert.match(hint, /2 qism/);
  assert.match(hint, /Ikkalasini ham kanalga uzating/);
  assert.match(hint, /yig‘indisi/);

  const single = buildRegionPollHint(1);
  assert.ok(!single.includes("qism"));
});

test("so‘rovnoma ANONIM — aks holda kanalga uzatib bo‘lmaydi", () => {
  /*
   * Telegram kanallarda faqat anonim so'rovnomaga ruxsat beradi va
   * anonim bo'lmaganini kanalga forward qilib ham bo'lmaydi. Bu
   * qiymat o'zgarsa, butun ish bekor bo'lardi.
   */
  for (const poll of buildRegionPolls()) assert.equal(poll.isAnonymous, true);
});

test("bitta odam bitta hudud tanlaydi", () => {
  for (const poll of buildRegionPolls()) assert.equal(poll.allowsMultipleAnswers, false);
});

test("bot MODERATOR chatiga yuboradi, kanalga emas", () => {
  // Kanal identifikatori hech qayerda saqlanmagan va bot u yerda
  // admin ekani kafolatlanmagan. Moderator bir bosishda uzatadi.
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

test("yarim yuborilgan so‘rovnoma haqida OGOHLANTIRADI", () => {
  // Birinchi qism ketib ikkinchisi yiqilsa, moderator yarim
  // ro'yxatni kanalga uzatib, hududlarning yarmini so'ramay
  // qolardi.
  const fn = code(router).slice(code(router).indexOf("async function sendRegionPoll"));
  assert.ok(fn.includes("UZATMANG"), "to‘liq emasligi aytilsin");
});

test("yuborish xatosi jim qolmaydi", () => {
  const fn = code(router).slice(code(router).indexOf("async function sendRegionPoll"));
  assert.ok(fn.includes("catch"), "xato ushlansin");
  assert.ok(fn.includes("qismi yuborilmadi"), "moderatorga aytilsin");
});

test("variantlar Telegram’ga JSON satri sifatida ketadi", () => {
  // Telegram `options` ni massiv emas, JSON-serialized satr kutadi.
  const fn = code(api).slice(code(api).indexOf("export async function sendTelegramPoll"));
  assert.ok(fn.includes("JSON.stringify(input.options)"));
});

test("tugma yorlig‘i router’da takrorlanmaydi", () => {
  assert.ok(!router.includes(REGION_POLL_BUTTON_LABEL), "konstantadan olinsin");
});
