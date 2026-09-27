import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  codesLookAlike,
  editDistance,
  groupByPromoCode,
  skeletonOf,
  toleranceFor,
  type PromoApplicant,
} from "../src/lib/applications/promo-similarity.ts";

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const person = (
  id: string,
  fullName: string,
  promoCode: string,
): PromoApplicant => ({
  id,
  fullName,
  promoCode,
  phone: "+998900000000",
  telegram: "@u",
  ageRange: "19-24",
  createdAt: "2026-09-20T10:00:00.000Z",
});

/* ===================================================================== *
 * YOZUVDA CHALKASHISH
 * ===================================================================== */

test("chalkashadigan belgilar bir shaklga tushadi", () => {
  /*
   * Promo kodni nomzod QO'LDA ko'chirib yozadi. "ALI2026" o'rniga
   * "AL12026" (I -> 1) tushadi va bazada ikki alohida kod bo'lib
   * yotadi — kim nechta nomzod olib kelgani noto'g'ri chiqadi.
   */
  assert.equal(skeletonOf("ALI2026"), skeletonOf("AL12026"));
  assert.equal(skeletonOf("B0SS10"), skeletonOf("BOSS1O"));
  assert.equal(skeletonOf("ali-2026"), skeletonOf("ALI 2026"));
});

test("masofa O‘RIN ALMASHISHNI bitta xato deb sanaydi", () => {
  // "ALI" ni shoshib yozganda "AIL" chiqadi — bu bitta xato.
  assert.equal(editDistance("ALI2026", "AIL2026"), 1);
  assert.equal(editDistance("ABC", "ABC"), 0);
  assert.equal(editDistance("ABC", "ABD"), 1);
});

test("chidam UZUNLIKKA qarab beriladi", () => {
  /*
   * Qisqa kodda bitta xato uni BOSHQA kodga aylantiradi
   * ("AB1" va "AB2" — ikki boshqa koordinator).
   */
  assert.equal(toleranceFor(3), 0);
  assert.equal(toleranceFor(7), 1);
  assert.equal(toleranceFor(12), 2);
});

test("qisqa kodlar o‘xshash deb BIRLASHTIRILMAYDI", () => {
  assert.equal(codesLookAlike("AB1", "AB2"), false);
  assert.equal(codesLookAlike("XYZ", "XYQ"), false);
});

test("uzun kodlardagi bitta xato o‘xshash deb topiladi", () => {
  assert.equal(codesLookAlike("ALI2026", "AL12026"), true);
  assert.equal(codesLookAlike("TEKIN2026", "TEKIN2O26"), true);
});

test("butunlay boshqa kodlar o‘xshash EMAS", () => {
  assert.equal(codesLookAlike("ALI2026", "TEKIN2026"), false);
  assert.equal(codesLookAlike("BOSS10", "VALI7"), false);
});

test("bo‘sh kod hech narsaga o‘xshamaydi", () => {
  assert.equal(codesLookAlike("", "ALI2026"), false);
  assert.equal(codesLookAlike("   ", ""), false);
});

/* ===================================================================== *
 * GURUHLASH
 * ===================================================================== */

const ROWS: PromoApplicant[] = [
  person("1", "Abdumajidova O‘g‘iloy", "ALI2026"),
  person("2", "Maxmatmurodova Shaxnoza", "ali 2026"),
  person("3", "Maratova Gulruh", "AL12026"),
  person("4", "Karimov Aziz", "TEKIN2026"),
  person("5", "Sobirov Diyorbek", ""),
];

test("aynan bir xil kodlar BITTA ro‘yxatga yig‘iladi", () => {
  const groups = groupByPromoCode(ROWS);
  const ali = groups.find((group) => group.code === "ALI2026");
  assert.ok(ali, "ALI2026 guruhi topilmadi");
  // "ali 2026" normallashib AYNAN o'sha kod bo'ladi.
  assert.equal(ali.exact.length, 2);
  assert.deepEqual(
    ali.exact.map((applicant) => applicant.fullName).sort(),
    ["Abdumajidova O‘g‘iloy", "Maxmatmurodova Shaxnoza"],
  );
});

test("o‘xshash yozuv ALOHIDA turadi, avtomatik qo‘shilmaydi", () => {
  /*
   * "Bu ham o'sha kod" degan qaror ODAMNIKI. Avtomatik
   * birlashtirish noto'g'ri bo'lsa, ikki koordinatorning nomzodi
   * aralashib ketardi.
   */
  const ali = groupByPromoCode(ROWS).find((group) => group.code === "ALI2026");
  assert.ok(ali);
  assert.equal(ali.similar.length, 1);
  assert.equal(ali.similar[0].code, "AL12026");
  assert.equal(ali.exact.some((a) => a.fullName === "Maratova Gulruh"), false);
  // Jami esa ikkalasini ham hisoblaydi.
  assert.equal(ali.total, 3);
});

test("kodsiz ariza hisobotga UMUMAN tushmaydi", () => {
  const groups = groupByPromoCode(ROWS);
  const names = groups.flatMap((group) => [
    ...group.exact.map((a) => a.fullName),
    ...group.similar.flatMap((v) => v.applicants.map((a) => a.fullName)),
  ]);
  assert.equal(names.includes("Sobirov Diyorbek"), false);
});

test("harflar kiritilganda faqat mos kodlar qoladi", () => {
  const groups = groupByPromoCode(ROWS, "ALI");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].code, "ALI2026");
});

test("qidiruv ham CHALKASHISHNI hisobga oladi", () => {
  // Admin "AL1" deb yozsa ham "ALI…" guruhi topilishi kerak.
  const groups = groupByPromoCode(ROWS, "AL1");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].code, "ALI2026");
});

test("bo‘sh qidiruvda barcha guruhlar chiqadi", () => {
  const groups = groupByPromoCode(ROWS, "   ");
  assert.equal(groups.length, 2);
});

test("guruhlar KATTALIGI bo‘yicha tartiblanadi", () => {
  const groups = groupByPromoCode(ROWS);
  for (let i = 1; i < groups.length; i += 1) {
    assert.ok(groups[i - 1].total >= groups[i].total, "tartib buzilgan");
  }
});

/* ===================================================================== *
 * PDF
 * ===================================================================== */

test("shrift fayllari repoda bor", () => {
  /*
   * Shrift `public/` da turadi va ish vaqtida o'qiladi. Fayl
   * yo'qolsa, hisobot production'da yiqiladi — build buni
   * tutmaydi.
   */
  assert.ok(existsSync("public/assets/reports/fonts/tinos-regular.ttf"));
  assert.ok(existsSync("public/assets/reports/fonts/tinos-bold.ttf"));
  // Litsenziya ham yonida turishi kerak.
  assert.ok(existsSync("public/assets/reports/fonts/LICENSE.txt"));
});

test("shrift SUBSETSIZ joylanadi", () => {
  /*
   * `subset: true` bilan harflar JIMGINA yo'qoladi —
   * "O'ZBEKISTON" o'rniga "O BE STON" chiqqan edi. Repodagi
   * sertifikat kodida ham aynan shu yozilgan.
   */
  const pdf = src("src/lib/applications/promo-report-pdf.ts");
  assert.match(pdf, /subset: false/);
  assert.ok(!/subset: true/.test(pdf), "subsetting qayta yoqilgan");
});

test("hisobotda VAQT va «holatiga ko‘ra» bor", () => {
  const pdf = src("src/lib/applications/promo-report-pdf.ts");
  assert.match(pdf, /holatiga ko‘ra/);
  assert.match(pdf, /formatTashkent\(input\.generatedAt\)/);
});

test("PDF yo‘li ruxsat so‘raydi va keshlanmaydi", () => {
  /*
   * Ariza ma'lumoti shaxsiy: telefon va Telegram bor.
   */
  const route = src("src/app/api/export/promo-report/route.ts");
  assert.match(route, /checkPermission\("applications\.view"\)/);
  assert.match(route, /no-store/);
  assert.match(route, /applications\.promo_report_exported/);
});

test("audit jurnaliga nomzod ma’lumoti yozilmaydi", () => {
  const route = src("src/app/api/export/promo-report/route.ts");
  const audit = route.match(/logAudit\(\{[\s\S]*?\}\);/);
  assert.ok(audit, "audit chaqiruvi topilmadi");
  for (const field of ["full_name", "phone", "telegram", "fullName"]) {
    assert.ok(!audit[0].includes(field), `auditga ${field} tushyapti`);
  }
});
