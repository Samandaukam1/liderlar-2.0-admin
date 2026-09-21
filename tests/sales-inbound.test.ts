import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveTransition,
  INBOUND_TRANSITIONS,
  STAGE_TRANSITIONS,
} from "../src/lib/sales/flow/stages.ts";
import { getTemplate, SALES_TEMPLATE_KEYS } from "../src/lib/sales/flow/templates.ts";

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ---------------------------------------------------------------
// KIRUVCHI SSENARIY
// ---------------------------------------------------------------

test("kiruvchi suhbat ARIZA SAVOLINI so'ramaydi", () => {
  /*
   * O'zi yozgan odamga "Siz ariza qoldirgansiz, shunaqami?"
   * deb so'rash xato: u hech qanday ariza qoldirmagan va
   * savol uni chalkashtiradi.
   */
  const inbound = resolveTransition("new", "other", "inbound");

  assert.ok(inbound, "kiruvchi o'tish topilmadi");
  assert.ok(!inbound.templates.includes("application_confirm"));
  assert.equal(inbound.templates[0], "inbound_greeting");
});

test("chiquvchi suhbat O'ZGARISHSIZ qoladi", () => {
  /*
   * Mavjud oqim ishlab turibdi. Kiruvchi yo'l qo'shilgani
   * uni o'zgartirmasligi SHART.
   */
  const outbound = resolveTransition("new", "other", "outbound");

  assert.ok(outbound);
  assert.deepEqual(outbound.templates, ["application_confirm"]);
});

test("entry berilmasa — chiquvchi deb qabul qilinadi", () => {
  /*
   * Mavjud chaqiruvlar uch argumentsiz ishlaydi va xulqi
   * o'zgarmaydi.
   */
  assert.deepEqual(
    resolveTransition("new", "other"),
    resolveTransition("new", "other", "outbound"),
  );
});

test("kiruvchi yo'l foyda va narxni BIR YO'LA yuboradi", () => {
  const inbound = resolveTransition("new", "other", "inbound");

  assert.deepEqual(inbound!.templates, [
    "inbound_greeting",
    "benefits_full",
    "benefits_review_prompt",
    "price_offer_inbound",
  ]);
  assert.equal(inbound!.to, "offer_sent");
  // Javob kelmasa eslatma rejalashtiriladi.
  assert.equal(inbound!.followup?.type, "offer_review");
});

test("kiruvchi yo'l barcha boshlang'ich niyatlarni qamraydi", () => {
  /*
   * Mijoz birinchi xabarida salom, savol yoki "ma'lumot
   * bering" deb yozishi mumkin — hammasi bir xil boshlanadi.
   */
  for (const intent of ["other", "yes", "question", "need_info"] as const) {
    const t = resolveTransition("new", intent, "inbound");
    assert.ok(t, `${intent} uchun o'tish yo'q`);
    assert.equal(t.templates[0], "inbound_greeting");
  }
});

test("'ha' desa TO'LOV MA'LUMOTI va namuna maqolalar yuboriladi", () => {
  const t = resolveTransition("article_decision", "yes", "inbound");

  assert.ok(t);
  assert.deepEqual(t.templates, ["payment_details", "request_full_name_with_samples"]);
  assert.equal(t.to, "need_full_name");
});

test("chiquvchida 'ha' faqat F.I.Sh. so'raydi — tartib o'zgarmadi", () => {
  const t = resolveTransition("article_decision", "yes", "outbound");

  assert.ok(t);
  assert.deepEqual(t.templates, ["request_full_name"]);
});

test("kiruvchi jadval QISQA — qolgani umumiy jadvaldan", () => {
  /*
   * Butun jadvalni ikki nusxada saqlash ularning vaqt o'tib
   * ajralib ketishiga olib kelardi.
   */
  assert.ok(
    INBOUND_TRANSITIONS.length < STAGE_TRANSITIONS.length / 3,
    `kiruvchi jadval juda katta: ${INBOUND_TRANSITIONS.length}`,
  );

  // Masalan to'lov qadamlari faqat umumiy jadvalda.
  assert.ok(!INBOUND_TRANSITIONS.some((t) => t.from === "waiting_payment"));
});

// ---------------------------------------------------------------
// SHABLONLAR
// ---------------------------------------------------------------

test("yangi shablonlar mavjud va AI ularni qayta yozmaydi", () => {
  for (const key of [
    "inbound_greeting",
    "price_offer_inbound",
    "request_full_name_with_samples",
  ]) {
    const template = getTemplate(key);
    assert.ok(template, `${key} topilmadi`);
    // Narx va to'lov matnini model "yaxshilashi" mumkin emas.
    assert.equal(template.isExact, true, `${key} aynan yuborilmaydi`);
    assert.ok(template.body.trim().length > 20, `${key} bo'sh`);
  }
});

test("kiruvchi salomlashish ariza haqida GAPIRMAYDI", () => {
  const body = getTemplate("inbound_greeting")!.body.toLowerCase();

  assert.ok(body.includes("rahmat"));
  assert.ok(!body.includes("ariza"), "salomlashishda ariza tilga olingan");
});

test("narx matnida ikkala son ham bor", () => {
  const body = getTemplate("price_offer_inbound")!.body;

  assert.match(body, /100 000/);
  assert.match(body, /38 MING/i);
  assert.match(body, /promo/i);
});

test("namuna maqola havolalari AYNAN berilgan ikkitasi", () => {
  const body = getTemplate("request_full_name_with_samples")!.body;

  assert.match(body, /https:\/\/t\.me\/uzlye_rasmiy\/2405/);
  assert.match(body, /https:\/\/t\.me\/uzlye_rasmiy\/2344/);
});

test("barcha o'tishlardagi shablonlar MAVJUD", () => {
  /*
   * Mavjud bo'lmagan kalit ssenariyni jimgina to'xtatardi:
   * bot hech nima yubormasdi va sabab ko'rinmasdi.
   */
  const known = new Set(SALES_TEMPLATE_KEYS);

  for (const transition of [...STAGE_TRANSITIONS, ...INBOUND_TRANSITIONS]) {
    for (const key of transition.templates) {
      assert.ok(known.has(key), `shablon yo'q: ${key}`);
    }
  }
});

// ---------------------------------------------------------------
// SUHBAT TURINI ANIQLASH
// ---------------------------------------------------------------

test("tur FAQAT birinchi xabarda belgilanadi", () => {
  /*
   * Har xabarda yozilsa, keyingi chiquvchi xabar uni
   * "outbound" ga qaytarib, ssenariy o'rtada almashib
   * ketardi.
   */
  const code = src("src/lib/sales/repository.ts");
  const block = code.match(/if \(!conversation\.first_message_at[\s\S]*?\n  \}/)?.[0] ?? "";

  assert.ok(block.length > 0, "tur belgilash bloki topilmadi");
  assert.match(block, /message\.direction === "incoming"/);
  assert.match(block, /\.eq\("entry", "outbound"\)/);
});

test("noma'lum tur XAVFSIZ tomonga og'adi", () => {
  /*
   * Yangi xulqni taxminga asoslab yoqish, eskisini
   * qoldirishdan xavfliroq.
   */
  const code = src("src/lib/sales/flow/engine.ts");
  assert.match(code, /entry: row\.entry === "inbound" \? "inbound" : "outbound"/);
});

// ---------------------------------------------------------------
// KOORDINATORGA XABAR
// ---------------------------------------------------------------

test("chek kelganda koordinatorga xabar yuboriladi", () => {
  const code = src("src/lib/sales/flow/payment-evidence.ts");
  assert.match(code, /alertCoordinatorsOnPayment\(/);
});

test("xabar yuborilmasa ham sotuv oqimi to'xtamaydi", () => {
  /*
   * Xabar yetmagani yomon, lekin chek yozuvi bazada qoladi
   * va admin uni panelda ko'radi.
   */
  const code = src("src/lib/sales/flow/payment-evidence.ts");
  const block = code.match(/try \{[\s\S]*?alertCoordinatorsOnPayment[\s\S]*?\n  \}/)?.[0] ?? "";

  assert.ok(block.length > 0, "xato ushlanmayapti");
  assert.match(block, /catch/);
});

test("koordinator xabari to'lovni TASDIQLAMAYDI", () => {
  /*
   * Chek kelgani pul kelganini bildirmaydi. Matn buni
   * chalkashtirmasligi kerak.
   */
  const code = readFileSync("src/lib/sales/flow/coordinator-alert.ts", "utf8");
  const text = code.match(/const text = \[[\s\S]*?\]\.join\("\\n"\);/)?.[0] ?? "";

  assert.ok(text.length > 0, "xabar matni topilmadi");
  assert.match(text, /TASDIQLANMAGAN/);
  assert.ok(!/to'lov qabul qilindi/i.test(text));
});

test("koordinator raqamli id bo'yicha topiladi", () => {
  const code = src("src/lib/sales/flow/coordinator-alert.ts");

  assert.match(code, /telegram_user_id/);
  assert.ok(!/telegram_username/.test(code), "username bo'yicha yuborilyapti");
});

test("ism Telegram HTML ni buzmaydi", () => {
  const code = src("src/lib/sales/flow/coordinator-alert.ts");
  assert.match(code, /function escapeHtml/);
  assert.match(code, /escapeHtml\(name\)/);
});
