import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizePromoCode,
  promoCodesMatch,
  resolvePromoRouting,
  validatePromoCode,
  PROMO_CODE_MAX_LENGTH,
} from "../src/lib/coordinators/promo-code.ts";
import { buildLeadNotification } from "../src/lib/coordinators/bot-messages.ts";
import { buildBotStatusReportText } from "../src/lib/intake/payment-messages.ts";

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/* ===================================================================== *
 * KOD NORMALLASHTIRISH
 * ===================================================================== */

test("kod registr va ajratgichlarga qaramasdan bir xil bo‘ladi", () => {
  /*
   * Nomzod "ali-2026" deb yozadi, koordinator "ALI 2026" deb
   * kiritadi. Ikkovi bir xil bo'lmasa, lid egasiga yetib bormaydi
   * va buni hech kim sezmaydi.
   */
  const forms = ["ALI2026", "ali2026", "ALI-2026", "ali_2026", "ALI 2026", "a l i 2 0 2 6"];
  const normalized = forms.map((form) => normalizePromoCode(form));
  assert.equal(new Set(normalized).size, 1, JSON.stringify(normalized));
  assert.equal(normalized[0], "ALI2026");
});

test("bo‘sh kod XATO emas — u ixtiyoriy", () => {
  assert.equal(validatePromoCode("").ok, true);
  assert.equal(validatePromoCode("   ").code, "");
  assert.equal(validatePromoCode(null).ok, true);
});

test("juda qisqa, juda uzun va belgili kod rad etiladi", () => {
  assert.equal(validatePromoCode("AB").ok, false);
  assert.equal(validatePromoCode("A".repeat(PROMO_CODE_MAX_LENGTH + 1)).ok, false);
  // Nomzod emojili kodni xatosiz ko'chirib yoza olmaydi.
  assert.equal(validatePromoCode("ALI🎁2026").ok, false);
  assert.equal(validatePromoCode("ALI#2026").ok, false);
});

test("kirill kod qabul qilinadi, lekin lotinga TENGLASHTIRILMAYDI", () => {
  /*
   * Kod identifikator, matn emas: "ALI" ni "АЛИ" ga tenglashtirsak,
   * ikki boshqa koordinatorning kodi bir-biriga urilib ketardi.
   */
  assert.equal(validatePromoCode("АЛИ2026").ok, true);
  assert.equal(promoCodesMatch("ALI2026", "АЛИ2026"), false);
});

test("bo‘sh kod hech narsaga MOS KELMAYDI", () => {
  // Aks holda kodsiz ariza tasodifiy koordinatorga biriktirilardi.
  assert.equal(promoCodesMatch("", ""), false);
  assert.equal(promoCodesMatch(null, null), false);
  assert.equal(promoCodesMatch("  ", "ALI2026"), false);
});

/* ===================================================================== *
 * MARSHRUTLASH QARORI
 * ===================================================================== */

const OWNERS = [
  { id: "c-ali", promoCode: "ALI2026", isActive: true },
  { id: "c-vali", promoCode: "VALI-7", isActive: true },
  { id: "c-eski", promoCode: "ESKI1", isActive: false },
];

test("kod topilsa lid EGASIGA biriktiriladi", () => {
  const decision = resolvePromoRouting("ali 2026", OWNERS);
  assert.equal(decision.coordinatorId, "c-ali");
  assert.equal(decision.reason, "promo_match");
});

test("promo lid MUDDAT TUGAGANDA boshqasiga o‘tmaydi", () => {
  /*
   * Tijoriy sabab: promo kod bilan kelgan nomzod TEKINGA
   * chiqariladi, ya'ni bu lid boshqa koordinatorning ishi emas va
   * uning hisobiga yozilmasligi kerak.
   */
  assert.equal(resolvePromoRouting("ALI2026", OWNERS).reassignOnExpiry, false);
});

test("kodsiz ariza ODDIY marshrutlashda qoladi", () => {
  const decision = resolvePromoRouting(null, OWNERS);
  assert.equal(decision.coordinatorId, null);
  assert.equal(decision.reason, "no_promo");
  assert.equal(decision.reassignOnExpiry, true);
});

test("noma’lum kod lidni YO‘QOTMAYDI", () => {
  /*
   * Noto'g'ri yozilgan kod uchun nomzodni javobsiz qoldirish eng
   * yomon natija bo'lardi — lid oddiy navbatga tushadi.
   */
  const decision = resolvePromoRouting("BUNDAYKODYOQ", OWNERS);
  assert.equal(decision.coordinatorId, null);
  assert.equal(decision.reason, "promo_unknown");
  assert.equal(decision.reassignOnExpiry, true);
});

test("FAOLSIZ koordinatorning kodi ishlamaydi", () => {
  const decision = resolvePromoRouting("ESKI1", OWNERS);
  assert.equal(decision.coordinatorId, null);
  assert.equal(decision.reason, "promo_unknown");
});

/* ===================================================================== *
 * XABAR
 * ===================================================================== */

test("promo lid xabarida ism, telefon, username va yosh bor", () => {
  const text = buildLeadNotification({
    fullName: "Nomzod Nomzodov",
    regionName: "Toshkent",
    appliedAt: null,
    claimWindowMinutes: 10,
    promo: { code: "ALI2026" },
    contact: { phone: "+998900000000", telegram: "@nomzod", ageRange: "19-24" },
  });
  assert.match(text, /Nomzod Nomzodov/);
  assert.match(text, /\+998900000000/);
  assert.match(text, /@nomzod/);
  assert.match(text, /19-24/);
  assert.match(text, /ALI2026/);
  assert.match(text, /TEKINGA/);
});

test("promo lid xabarida MUDDAT aytilmaydi", () => {
  /*
   * "10 daqiqa" deb yozib, keyin muddatni qo'llamaslik —
   * koordinatorni chalg'itish.
   */
  const text = buildLeadNotification({
    fullName: "Nomzod Nomzodov",
    regionName: null,
    appliedAt: null,
    claimWindowMinutes: 10,
    promo: { code: "ALI2026" },
    contact: null,
  });
  assert.ok(!/10 daqiqa/.test(text), text);
  assert.match(text, /o‘tmaydi/);
});

test("ODDIY lid xabarida kontakt YO‘Q", () => {
  /*
   * Oddiy lid bir nechta koordinatorga ketishi mumkin, shuning
   * uchun kontakt band qilingandan keyin beriladi. Bu mavjud
   * maxfiylik qoidasi va u buzilmadi.
   */
  const text = buildLeadNotification({
    fullName: "Nomzod Nomzodov",
    regionName: "Toshkent",
    appliedAt: null,
    claimWindowMinutes: 10,
    // Kontakt BERILGAN bo'lsa ham promo emas — chiqmasligi kerak.
    contact: { phone: "+998900000000", telegram: "@nomzod", ageRange: "19-24" },
  });
  assert.ok(!/\+998900000000/.test(text), "oddiy lidda telefon chiqib ketdi");
  assert.ok(!/@nomzod/.test(text));
  assert.match(text, /10 daqiqa/);
});

/* ===================================================================== *
 * DVIGATEL ULANISHI
 * ===================================================================== */

test("promo lid FAQAT egasiga taklif qilinadi", () => {
  const routing = src("src/lib/coordinators/routing-service.ts");
  assert.match(routing, /if \(promoCoordinatorId\) \{/);
  // Muddat qo'yilmaydi: muddat yig'uvchisi uni ololmasin.
  assert.match(routing, /claim_deadline: null/);
});

test("muddat yig‘uvchisi promo lidga TEGMAYDI", () => {
  const routing = src("src/lib/coordinators/routing-service.ts");
  const sweep = routing.match(/runExpirySweep[\s\S]*?\.limit\(50\);/);
  assert.ok(sweep, "muddat so‘rovi topilmadi");
  assert.match(sweep[0], /\.is\("promo_coordinator_id", null\)/);
});

test("promo lidga hudud SHART emas", () => {
  /*
   * Hududsiz deb rad etish tekinga chiqariladigan nomzodni
   * butunlay yo'qotardi.
   */
  const intake = src("src/lib/coordinators/lead-intake.ts");
  assert.match(intake, /!application\.region_id && promo\.coordinatorId == null/);
});

test("kontakt FAQAT promo lidda o‘qiladi", () => {
  // Shaxsiy ma'lumotni keraksiz joyda o'qimaslik eng arzon himoya.
  const intake = src("src/lib/coordinators/lead-intake.ts");
  assert.match(intake, /if \(isPromo && row\?\.application_id\)/);
});

test("baza darajasida bitta kod — bitta faol koordinator", () => {
  const migration = src("supabase/migrations/20260927130000_coordinator_promo_codes.sql");
  assert.match(migration, /create unique index[\s\S]*?upper\(promo_code\)/);
  assert.match(migration, /where promo_code is not null and is_active/);
});

test("panel kodni tekshiradi va band kodni rad etadi", () => {
  const actions = src("src/lib/actions/coordinators.ts");
  assert.match(actions, /promoCodeTaken\(/);
  assert.match(actions, /promo kod boshqa faol koordinatorda band/);
});

/* ===================================================================== *
 * HISOBOT
 * ===================================================================== */

test("hisobotda TEKIN chiqarilganlar qatori bor", () => {
  const text = buildBotStatusReportText({
    todayDate: "2026-09-27",
    total: {
      filling: 1, submitted: 2, paid: 1, unpaid: 1, paymentUnknown: 0,
      posts: 1, published: 5, publishedFree: 2,
    },
    today: {
      filling: 0, submitted: 1, paid: 0, unpaid: 1, paymentUnknown: 0,
      posts: 0, published: 1, publishedFree: 1,
    },
    applications: { today: 0, total: 0, since: null },
    applicationWindowLabel: "26-sen 19:00 → 19:00",
  });

  const lines = text.split("\n").filter((line) => line.includes("TEKIN"));
  assert.equal(lines.length, 2, `bugun va jami uchun ikkita qator kerak: ${lines.length}`);
  assert.match(text, /TEKIN chiqarilgan: 1/);
  assert.match(text, /TEKIN chiqarilgan: 2/);
});

test("tekin soni CHOP ETILGANLAR ichidan sanaladi", () => {
  /*
   * Bu son `published` ning QISMI. Uni alohida guruh deb ko'rsatish
   * jamini noto'g'ri chiqarardi, shuning uchun matnda "Shundan"
   * deb yozilgan.
   */
  const messages = src("src/lib/intake/payment-messages.ts");
  assert.match(messages, /Shundan TEKIN chiqarilgan/);

  const payment = src("src/lib/intake/payment.ts");
  // 'unknown' tekin deb sanalmaydi: so'ralmagan holat tekin degani emas.
  assert.match(payment, /\.eq\("status", "published"\)\.eq\("payment_status", "unpaid"\)/);
});
