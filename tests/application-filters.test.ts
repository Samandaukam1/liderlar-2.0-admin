import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTashkentDateTime } from "../src/lib/tashkent-day.ts";

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/* ===================================================================== *
 * VAQT — TOSHKENT DEVOR SOATI
 * ===================================================================== */

test("kiritilgan vaqt TOSHKENT deb o‘qiladi", () => {
  /*
   * Admin "kecha 17:30 dan" deb belgilaydi va Toshkent vaqtini
   * nazarda tutadi; `created_at` esa UTC da yotadi. Ikkovini
   * to'g'ridan-to'g'ri solishtirish besh soatlik xato berardi va
   * kechqurungi arizalar jimgina tushib qolardi.
   */
  assert.equal(parseTashkentDateTime("2026-09-27T17:30"), "2026-09-27T12:30:00.000Z");
  assert.equal(parseTashkentDateTime("2026-09-28T00:00"), "2026-09-27T19:00:00.000Z");
});

test("bo‘sh va noto‘g‘ri vaqt CHEGARA QO‘YMAYDI", () => {
  /*
   * Butun ro'yxatni bo'sh ko'rsatishdan ko'ra filtrni e'tiborsiz
   * qoldirish yaxshiroq: admin "arizalar yo'q" deb o'ylab
   * qolmasin.
   */
  assert.equal(parseTashkentDateTime(""), null);
  assert.equal(parseTashkentDateTime(null), null);
  assert.equal(parseTashkentDateTime("salom"), null);
  // Mavjud bo'lmagan sana shakl tekshiruvidan o'tadi — u ham rad etiladi.
  assert.equal(parseTashkentDateTime("2026-02-31T10:00"), null);
  assert.equal(parseTashkentDateTime("2026-09-27T25:00"), null);
  assert.equal(parseTashkentDateTime("2026-09-27T10:75"), null);
});

test("sana bo‘sh joy bilan ham qabul qilinadi", () => {
  assert.equal(parseTashkentDateTime("2026-09-27 17:30"), "2026-09-27T12:30:00.000Z");
});

/* ===================================================================== *
 * TARTIB VA CHEGARA
 * ===================================================================== */

const PAGE = src("src/app/(admin)/applications/page.tsx");

test("promo kodsizlar TEPAGA chiqadi, yashirilmaydi", () => {
  /*
   * Talab: kodsizlar birinchi, keyin kodlilar. Ya'ni bu saralash,
   * filtr emas — kodlilar ham ko'rinishda qoladi.
   */
  assert.match(PAGE, /order\("has_promo", \{ ascending: true \}\)/);
  assert.match(PAGE, /order\("created_at", \{ ascending: false \}\)/);
  assert.ok(
    !/\.eq\("has_promo", false\)[\s\S]{0,60}range\(/.test(PAGE),
    "kodlilar ro‘yxatdan butunlay chiqarib tashlangan",
  );
});

test("tartib faqat tugma bosilganda o‘zgaradi", () => {
  assert.match(PAGE, /const noPromoFirst = one\(sp\.promo\) === "kodsiz"/);
  assert.match(PAGE, /noPromoFirst\s*\?/);
});

test("yuqori chegara EKSKLYUZIV", () => {
  // Aynan o'sha daqiqadagi ariza ikki oynaga tushib qolmasin.
  assert.match(PAGE, /\.lt\("created_at", toIso\)/);
  assert.match(PAGE, /\.gte\("created_at", fromIso\)/);
});

test("sanoqlar ro‘yxat bilan BIR XIL chegarada", () => {
  /*
   * Shartlar uch joyga ko'chirilsa, biri unutilib sanoq
   * ro'yxatga mos kelmay qolardi va raqamga ishonib bo'lmasdi.
   */
  const calls = PAGE.match(/applyScope\(/g) ?? [];
  assert.ok(calls.length >= 3, `applyScope uch marta ishlatilishi kerak: ${calls.length}`);
});

test("saralash uchun baza ustuni bor", () => {
  /*
   * `promo_code` bo'yicha `nulls first` yetarli emas edi: "kod
   * yo'q" ikki xil yozilgan — null va bo'sh satr.
   */
  const migration = src("supabase/migrations/20260928120000_applications_has_promo.sql");
  assert.match(migration, /generated always as \(promo_code is not null and btrim\(promo_code\) <> ''\) stored/);
  assert.match(migration, /idx_applications_has_promo_created/);
});

/* ===================================================================== *
 * PANEL
 * ===================================================================== */

const PANEL = src("src/app/(admin)/applications/application-filters.tsx");

test("tayyor oraliqlar TOSHKENT bo‘yicha hisoblanadi", () => {
  /*
   * Brauzer boshqa zonada bo'lsa, mahalliy formatlash oynani
   * siljitib yuborardi.
   */
  assert.match(PANEL, /timeZone: TZ/);
  assert.match(PANEL, /Asia\/Tashkent/);
});

test("filtr o‘zgarganda birinchi sahifaga qaytiladi", () => {
  // Aks holda admin bo'sh sahifani ko'rib "hech narsa yo'q" deb o'ylardi.
  assert.match(PANEL, /sp\.delete\("page"\)/);
});

test("tugma nomi xulqqa mos", () => {
  /*
   * "Promo kodsiz arizalar" degan yozuv ular YAGONA ko'rinadi
   * degan taassurot berardi.
   */
  assert.match(PANEL, /Promo kodsizlar tepada/);
});

/* ===================================================================== *
 * SAHIFALASH FILTRNI YO'QOTMAYDI
 * ===================================================================== */

const PAGINATION = src("src/components/admin/pagination.tsx");

test("sahifalash JORIY parametrlarni o‘zi ko‘chiradi", () => {
  /*
   * Jonli nosozlik: admin vaqt oralig'ini belgilaydi, "promo
   * kodsizlar tepada" ni bosadi, ikkinchi sahifaga o'tadi — va
   * hammasi o'chib, oddiy ro'yxat qaytadi. Hech qanday xato
   * chiqmaydi.
   *
   * Sabab: har sahifa saqlanadigan parametrlarni QO'LDA sanab
   * berardi va yangi filtr o'sha ro'yxatga qo'shilmagan edi.
   */
  assert.match(PAGINATION, /useSearchParams\(\)/);
  assert.match(PAGINATION, /new URLSearchParams\(params\.toString\(\)\)/);
  assert.match(PAGINATION, /usePathname\(\)/);
});

test("birinchi sahifada `page` manzildan chiqariladi", () => {
  // "?page=1" manzilni keraksiz uzaytiradi va ulashishni qiyinlashtiradi.
  assert.match(PAGINATION, /if \(target <= 1\) next\.delete\("page"\)/);
});

test("unutish mumkin bo‘lgan proplar OLIB TASHLANGAN", () => {
  /*
   * `basePath` va `params` bir xil bilimni takrorlardi. Ular
   * qolsa, keyingi filtr yana o'sha ro'yxatga qo'shilmasdan
   * qolishi mumkin edi.
   */
  assert.ok(!/basePath/.test(PAGINATION), "basePath propi qaytib kelgan");
  assert.ok(!/params\?:/.test(PAGINATION), "params propi qaytib kelgan");

  for (const page of [
    "src/app/(admin)/applications/page.tsx",
    "src/app/(admin)/candidates/page.tsx",
    "src/app/(admin)/audit-log/page.tsx",
  ]) {
    const body = src(page);
    const tag = body.match(/<Pagination[\s\S]*?\/>/);
    assert.ok(tag, `${page}: Pagination topilmadi`);
    assert.ok(!/basePath|params=/.test(tag[0]), `${page}: eski proplar qolgan`);
  }
});
