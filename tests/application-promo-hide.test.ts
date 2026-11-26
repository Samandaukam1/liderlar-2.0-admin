import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenPromoCondition, parseHiddenPromoCodes, promoSearchPattern } from "../src/app/(admin)/applications/promo-hide-utils.ts";

test("hidden codes reject malformed URL values and deduplicate exact codes", () => {
  assert.deepEqual(parseHiddenPromoCodes("broken"), []);
  assert.deepEqual(parseHiddenPromoCodes('{"code":"SALOM"}'), []);
  assert.deepEqual(parseHiddenPromoCodes('["ILOVEUZ","SALOM","ILOVEUZ",null,5,""]'), ["ILOVEUZ", "SALOM"]);
  assert.equal(parseHiddenPromoCodes(JSON.stringify(Array.from({ length: 70 }, (_, i) => `CODE${i}`))).length, 50);
  assert.deepEqual(parseHiddenPromoCodes(JSON.stringify(["X".repeat(121)])), []);
});

test("exclusion preserves null promos and quotes filter punctuation as literal code values", () => {
  assert.equal(hiddenPromoCondition(["ILOVEUZ", "SALOM"]), 'promo_code.is.null,promo_code.not.in.("ILOVEUZ","SALOM")');
  const codes = ['A,B', 'A)B', 'A"B', 'A\\B'];
  const condition = hiddenPromoCondition(codes);
  assert.ok(condition.startsWith("promo_code.is.null,promo_code.not.in.("));
  assert.equal(condition, `promo_code.is.null,promo_code.not.in.(${codes.map((code) => JSON.stringify(code)).join(",")})`);
});

test("suggestions search a literal prefix instead of expanding SQL wildcard characters", () => {
  assert.equal(promoSearchPattern("ILOVE"), "ILOVE%");
  assert.equal(promoSearchPattern("A%_\\B"), "A\\%\\_\\\\B%");
});
