import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { foldCode } from "../src/lib/referral/code.ts";

const MIGRATION = "supabase/migrations/20261001160000_referral_personal_codes.sql";

/**
 * SQL VA TYPESCRIPT FOLD'I BIR XIL BO'LISHI SHART.
 *
 * Fold bo'yicha unikal indeks SQL funksiyasiga tayanadi; ilovadagi
 * to'qnashuv tekshiruvi esa TS funksiyasiga. Ikkovi ajralib ketsa,
 * ilova "bo'sh" degan kodni baza rad etardi — yoki, battari,
 * ilova o'tkazgan kodni indeks ham o'tkazib, ikki kod bitta shaklga
 * tushib qolardi va tavsiya boshqa odamga yozilardi.
 */
test("SQL translate xaritasi TS fold sinflari bilan mos", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  const match = sql.match(/'([A-Z]{3,})',\s*'([0-9]{3,})'\s*\)/s);
  assert.ok(match, "SQL dagi translate() topilmadi");

  const [, from, to] = match;
  assert.equal(from!.length, to!.length, "translate argumentlari uzunligi teng emas");

  // SQL xaritasidagi har bir almashtirish TS da ham shunday bo'lishi kerak.
  for (let i = 0; i < from!.length; i += 1) {
    const letter = from![i]!;
    const digit = to![i]!;
    assert.equal(
      foldCode(letter),
      digit,
      `SQL ${letter} -> ${digit}, TS esa ${foldCode(letter)}`,
    );
  }
});

test("TS fold sinflarining hammasi SQL xaritasida bor", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = sql.match(/'([A-Z]{3,})',\s*'([0-9]{3,})'\s*\)/s);
  assert.ok(match);
  const from = new Set([...match![1]!]);

  // TS da raqamga aylanadigan har bir HARF SQL xaritasida bo'lishi shart.
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const folded = foldCode(letter);
    if (/^[0-9]$/.test(folded)) {
      assert.ok(from.has(letter), `SQL xaritasida yo'q: ${letter} -> ${folded}`);
    }
  }
});

test("fold bo'yicha unikal indeks mavjud", () => {
  /*
   * Indeks bo'lmasa, qolgan himoya ilova darajasida qoladi va
   * bir vaqtda kelgan ikki so'rov ikkisi ham o'tib ketardi.
   */
  const sql = readFileSync(MIGRATION, "utf8");
  assert.match(sql, /create unique index[^;]*referral_codes[^;]*referral_fold_code/s);
});
