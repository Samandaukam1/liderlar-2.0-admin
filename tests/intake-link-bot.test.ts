import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INTAKE_LINK_BUTTON_LABEL,
  INTAKE_LINK_COMMAND,
  INTAKE_LINK_NAME_PROMPT,
  isIntakeLinkNamePrompt,
  buildGenderPrompt,
  parseNameFromGenderPrompt,
  buildGenderKeyboard,
  intakeGenderCallbackData,
  parseIntakeGenderCallback,
  buildIntakeLinkResult,
  buildNameRetryPrompt,
  cleanNameInput,
  GENDER_LABELS,
  INTAKE_INSTRUCTIONS,
} from "../src/lib/intake/intake-link-messages.ts";
import { validateFullName } from "../src/lib/sales/flow/full-name.ts";

const router = readFileSync("src/lib/post-studio/bot-router.ts", "utf8");
const operator = readFileSync("src/lib/sales/operator-router.ts", "utf8");
const transport = readFileSync("src/lib/sales/telegram-sales-api.ts", "utf8");
const webhook = readFileSync("src/app/api/telegram-sales/webhook/route.ts", "utf8");

/** Izohlar tashlanadi: tekshiruv KODNI o‘qishi kerak. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ========================= 1. IKKI QADAMLI OQIM ========================= */

test("savol force_reply bilan ketadi va javob taniladi", () => {
  assert.ok(isIntakeLinkNamePrompt(INTAKE_LINK_NAME_PROMPT));
  assert.ok(!isIntakeLinkNamePrompt("Qora ro‘yxatga ism kiriting"));
  assert.ok(!isIntakeLinkNamePrompt(null));
  assert.ok(!isIntakeLinkNamePrompt(""));
});

test("ism BOT XABARIDAN o‘qiladi — chat holati saqlanmaydi", () => {
  // Holat bazada saqlansa, yarim tashlab ketilgan suhbat keyingi
  // har qanday xabarni "ism" deb o'qib yuborardi.
  const prompt = buildGenderPrompt("Karimov Aziz Abdullayevich", "male");
  assert.equal(parseNameFromGenderPrompt(prompt), "Karimov Aziz Abdullayevich");
});

test("taxmin KO‘RSATILADI, lekin tanlanmaydi", () => {
  // Ism bo'yicha jins ko'p hollarda xato bo'ladi va noto'g'ri jins
  // anketa mavzusini ham, rasm promtini ham buzadi.
  const withHint = buildGenderPrompt("Karimova Dilnoza", "female");
  assert.match(withHint, /Taxmin: ayol/);
  assert.match(withHint, /Jinsini tanlang/);

  const noHint = buildGenderPrompt("Qwerty Asdfgh", null);
  assert.ok(!noHint.includes("Taxmin"));
  assert.match(noHint, /Jinsini tanlang/);
});

test("natija xabaridan ism O‘QILMAYDI — takroriy bosish to‘xtaydi", () => {
  /*
   * BU HIMOYANING O'ZAGI. Tugma ikki marta bosilsa ikkita anketa
   * yaratilardi. Natija xabarida ism belgisi yo'q, shuning uchun
   * ikkinchi callback ismni topa olmaydi.
   */
  const result = buildIntakeLinkResult({
    fullName: "Karimov Aziz",
    gender: "male",
    link: "https://liderlar.uz/anketa/abc123",
    expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  });
  assert.equal(parseNameFromGenderPrompt(result), null);
});

test("bo‘sh yoki buzilgan xabardan ism o‘qilmaydi", () => {
  assert.equal(parseNameFromGenderPrompt(null), null);
  assert.equal(parseNameFromGenderPrompt(""), null);
  assert.equal(parseNameFromGenderPrompt("boshqa xabar"), null);
  // Sarlavha bor, lekin ism qatori yo'q.
  assert.equal(parseNameFromGenderPrompt("🔗 ANKETA HAVOLASI\n\nJinsini tanlang:"), null);
});

/* ============================ 2. CALLBACK ============================== */

test("callback round-trip va 64 bayt chegarasi", () => {
  for (const gender of ["male", "female"] as const) {
    const data = intakeGenderCallbackData(gender);
    assert.equal(parseIntakeGenderCallback(data), gender);
    assert.ok(Buffer.byteLength(data, "utf8") <= 64, data);
  }
});

test("begona callback qabul qilinmaydi", () => {
  for (const bad of [null, undefined, "", "crm:w:t:1", "chn:abc", "ilg:", "ilg:x", "ilg"]) {
    assert.equal(parseIntakeGenderCallback(bad as string | null), null, String(bad));
  }
});

test("tugma yorlig‘i ikkala botda BIR XIL manbadan", () => {
  // Yorliq matni HECH QAYERDA takrorlanmaydi — ikkala bot ham
  // konstantani import qiladi. Nusxa yozilsa, bittasi o'zgarganda
  // moderator ikki botda ikki xil tugma ko'rardi.
  assert.ok(router.includes("INTAKE_LINK_BUTTON_LABEL"));
  assert.ok(operator.includes("INTAKE_LINK_BUTTON_LABEL"));
  assert.ok(!router.includes(INTAKE_LINK_BUTTON_LABEL), "matn nusxasi bo‘lmasin");
  assert.match(INTAKE_LINK_BUTTON_LABEL, /Anketa/);
});

test("jins yorliqlari o‘zbekcha", () => {
  assert.equal(GENDER_LABELS.male, "erkak");
  assert.equal(GENDER_LABELS.female, "ayol");
});

test("ikkita tugma — erkak va ayol", () => {
  const keyboard = buildGenderKeyboard();
  assert.equal(keyboard.length, 1);
  assert.equal(keyboard[0].length, 2);
  assert.match(keyboard[0][0].text, /Erkak/);
  assert.match(keyboard[0][1].text, /Ayol/);
});

/* ========================== 3. ISM TEKSHIRUVI ========================== */

test("bitta so‘z yetarli emas — oqim UZILMAYDI", () => {
  // Jimgina to'xtash moderatorni "bot ishlamayapti" degan xulosaga
  // olib kelardi.
  const checked = validateFullName("Aziz");
  assert.equal(checked.ok, false);
  const retry = buildNameRetryPrompt(checked.reason ?? "xato");
  assert.ok(isIntakeLinkNamePrompt(retry), "qayta so‘rash ham o‘sha oqimda qolsin");
  assert.match(retry, /Kamida familiya va ism/);
});

test("apostrof variantlari bir xillashtiriladi", () => {
  // "O‘ktam" va "O'ktam" bir xil nomzod bo'lishi kerak.
  assert.equal(cleanNameInput("G‘ulomov O‘ktam"), "G'ulomov O'ktam");
  assert.equal(cleanNameInput("  Karimov   Aziz  "), "Karimov   Aziz");
});

test("juda uzun ism kesiladi", () => {
  const long = cleanNameInput("A".repeat(500));
  assert.ok(long.length <= 200);
});

test("ism bosh harflarga keltiriladi", () => {
  const checked = validateFullName("karimov aziz abdullayevich");
  assert.equal(checked.ok, true);
  assert.equal(checked.fullName, "Karimov Aziz Abdullayevich");
});

/* =========================== 4. NATIJA MATNI =========================== */

test("butun matn BITTA nusxalanadigan blokda", () => {
  // Moderator havolani va ko'rsatmani alohida belgilab o'tirmasin:
  // Telegram'da <pre> ustiga bir bosish hammasini nusxalaydi.
  const text = buildIntakeLinkResult({
    fullName: "Karimov Aziz",
    gender: "male",
    link: "https://liderlar.uz/anketa/abc123",
    expiresAt: null,
  });
  assert.ok(text.startsWith("<pre>"));
  assert.ok(text.endsWith("</pre>"));
  assert.equal((text.match(/<pre>/g) ?? []).length, 1);
});

test("ORTIQCHA SO‘Z YO‘Q — matn nomzodga ketadi", () => {
  const text = buildIntakeLinkResult({
    fullName: "Karimov Aziz",
    gender: "male",
    link: "https://liderlar.uz/anketa/abc123",
    expiresAt: new Date().toISOString(),
  });
  // Sarlavha, ism, jins va muddat qatorlari bo'lmasligi kerak: ular
  // nusxalashda ham ko'chib o'tardi.
  assert.ok(!text.includes("ANKETA HAVOLASI TAYYOR"));
  assert.ok(!text.includes("Karimov Aziz"));
  assert.ok(!text.includes("erkak"));
  assert.ok(!text.includes("Amal qilish muddati"));
  assert.ok(!text.includes("Havolani nomzodga yuboring"));
});

test("havola BIRINCHI qatorda, keyin ko‘rsatma", () => {
  const link = "https://liderlar.uz/anketa/abc123";
  const text = buildIntakeLinkResult({
    fullName: "Karimov Aziz",
    gender: "male",
    link,
    expiresAt: null,
  });
  const inner = text.replace(/^<pre>/, "").replace(/<\/pre>$/, "");
  assert.equal(inner.split("\n")[0], link);
  assert.ok(inner.includes("Rasm AYNAN linkdagi birinchi sahifadagi promt bilan"));
  assert.ok(inner.includes("ChatGPT yoki Gemini"));
  assert.ok(inner.includes("maqola chiqarilmaydi"));
});

test("ko‘rsatma matni sotuv shabloni bilan AYNAN bir xil", () => {
  // Ikki nusxa yozilsa, bir xil nomzod kanalga qarab boshqa-boshqa
  // ko'rsatma olardi.
  const templates = readFileSync("src/lib/sales/flow/templates.ts", "utf8");
  const start = templates.indexOf('key: "intake_instructions"');
  const body = templates.slice(templates.indexOf("body: `", start) + 7);
  const templateText = body.slice(0, body.indexOf("`,"));
  assert.equal(INTAKE_INSTRUCTIONS, templateText);
});

test("HTML belgilari qochiriladi", () => {
  // Havola odatda toza, lekin qochirish bo'lmasa bitta `<` butun
  // yuborishni 400 bilan yiqitardi.
  const text = buildIntakeLinkResult({
    fullName: "X",
    gender: "male",
    link: "https://liderlar.uz/anketa/a<b&c",
    expiresAt: null,
  });
  assert.ok(text.includes("a&lt;b&amp;c"));
});

test("natija xabaridan ism o‘qilmaydi — takror himoyasi saqlanadi", () => {
  const text = buildIntakeLinkResult({
    fullName: "Karimov Aziz",
    gender: "male",
    link: "https://liderlar.uz/anketa/x",
    expiresAt: null,
  });
  assert.equal(parseNameFromGenderPrompt(text), null);
});

/* ====================== 4b. HAVOLA DOMENI ============================== */

test("havola OMMAVIY saytdan yasaladi, admin domenidan emas", () => {
  /*
   * XATO SHU YERDA EDI: havola `getSiteUrl()` dan yasalardi, u esa
   * productionda admin manzilini beradi. Nomzodga
   * `liderlar-2-0-admin.vercel.app/anketa/...` ketardi va bunday
   * havola umuman ochilmaydi — anketa sahifasi ommaviy saytda.
   */
  const bot = readFileSync("src/lib/intake/intake-link-bot.ts", "utf8");
  const engine = readFileSync("src/lib/sales/flow/engine.ts", "utf8");
  for (const [name, src] of [["bot", bot], ["engine", engine]] as const) {
    assert.ok(src.includes("buildIntakeBaseUrl()"), `${name}: ommaviy manba ishlatilsin`);
    assert.ok(!/getSiteUrl\(\)[^\n]*anketa/.test(src), `${name}: admin domeni qolmasin`);
  }

  // Manba `*.vercel.app` ni rad etadigan resolverga tayanadi.
  const base = readFileSync("src/lib/intake/intake-base-url.ts", "utf8");
  assert.ok(base.includes("resolvePublicWebUrl"));
});

/* ====================== 5. IKKALA BOTGA ULANGAN ======================== */

test("post botda tugma ham, komanda ham bor", () => {
  assert.ok(code(router).includes("INTAKE_LINK_BUTTON_LABEL"));
  assert.ok(code(router).includes("INTAKE_LINK_COMMAND"));
  assert.ok(router.includes(INTAKE_LINK_COMMAND), "yordam matnida ham ko‘rinsin");
});

test("post botda anketa oqimi TAHRIRIYAT bilan cheklangan", () => {
  // Tugma yorlig'i oddiy matn — uni har kim yozishi mumkin.
  const branch = code(router).slice(code(router).indexOf("INTAKE_LINK_COMMAND || text ==="));
  const guard = branch.indexOf("if (!editorial) return deny(");
  const send = branch.indexOf("INTAKE_LINK_NAME_PROMPT");
  assert.ok(guard !== -1 && guard < send, "ruxsat tekshiruvi yuborishdan OLDIN");
});

test("post botda jins callback’i ham tekshiriladi", () => {
  const branch = code(router).slice(code(router).indexOf("parseIntakeGenderCallback(query.data)"));
  const guard = branch.indexOf("isEditorialChat");
  const create = branch.indexOf("createIntakeLinkFromBot(");
  assert.ok(guard !== -1 && guard < create);
});

test("sotuv botida ham o‘sha oqim va O‘SHA kod", () => {
  // Ikki nusxa yozilsa, ular vaqt o'tib ajralib ketardi.
  assert.ok(operator.includes("handleIntakeNameStep"));
  assert.ok(operator.includes("createIntakeLinkFromBot"));
  assert.ok(operator.includes("parseNameFromGenderPrompt"));
});

/* ==================== 6. MIJOZGA YOZISH HIMOYASI ======================= */

test("operator yo‘li MIJOZGA yoza olmaydi", () => {
  /*
   * Eng xavfli yo'l `ALLOWED_SALES_BOT_METHODS` ga `sendMessage` ni
   * qo'shish bo'lardi — shunda har qanday kod mijozga yozardi.
   * Buning o'rniga alohida funksiya, ikki tuzilmaviy kafolat bilan.
   */
  const allowed = transport.slice(
    transport.indexOf("ALLOWED_SALES_BOT_METHODS = ["),
    transport.indexOf("] as const;", transport.indexOf("ALLOWED_SALES_BOT_METHODS = [")),
  );
  assert.ok(!allowed.includes('"sendMessage"'), "sendMessage oq ro‘yxatga qo‘shilmasin");

  // 1-kafolat: business_connection_id umuman qabul qilinmaydi.
  const operatorFn = code(transport).slice(
    code(transport).indexOf("export async function sendSalesOperatorMessage"),
  );
  const body = operatorFn.slice(0, operatorFn.indexOf("\n}"));
  assert.ok(!body.includes("business_connection_id"), "business chatga yo‘l bo‘lmasin");

  // 2-kafolat: chat tahririyat ro'yxatidan tekshiriladi.
  assert.ok(body.includes("isSalesOperatorChat"));
});

test("ro‘yxat bo‘sh bo‘lsa hech kim operator emas", () => {
  // Post yetkazishda bo'sh ro'yxat "hammaga" degani edi; bu yerda
  // teskarisi xavfsiz.
  const fn = code(transport).slice(code(transport).indexOf("async function isSalesOperatorChat"));
  assert.ok(fn.includes("configured.includes(chatId)"));
});

test("operator updatelari mijoz oqimiga TUSHMAYDI", () => {
  const route = code(webhook);
  const operatorAt = route.indexOf("routeOperatorUpdate(update)");
  const customerAt = route.indexOf("parseSalesUpdate(");
  assert.ok(operatorAt !== -1 && operatorAt < customerAt, "operator yo‘li oldin tekshirilsin");
  assert.match(route, /if \(await routeOperatorUpdate\(update\)\) return;/);
});

test("webhook yangi update turlarini so‘raydi", () => {
  assert.ok(transport.includes('"message"'));
  assert.ok(transport.includes('"callback_query"'));
});

test("operator yo‘li sendSalesMessage’ni CHAQIRMAYDI", () => {
  // U muhrlangan ruxsat talab qiladi va mijoz chatiga yozadi.
  assert.ok(!code(operator).includes("sendSalesMessage("));
});
