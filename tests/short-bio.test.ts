import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHORT_BIO_MAX_ITEMS,
  joinShortBioItems,
  normalizeShortBioItems,
} from "../src/lib/candidates/short-bio.ts";

test("a well-formed badge row passes through unchanged", () => {
  const result = normalizeShortBioItems("Filolog | Kitobxon | Yosh volontyor | Maqsadli talaba");
  assert.deepEqual(result.items, ["Filolog", "Kitobxon", "Yosh volontyor", "Maqsadli talaba"]);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.ok, true);
});

test("the paragraph the model used to emit is rejected outright", () => {
  const result = normalizeShortBioItems(
    "U kelajak sari intilayotgan, hayotda katta maqsadlarni ko'zlagan, jamiyatga foyda keltirishni xohlaydigan yosh qiz.",
  );
  assert.deepEqual(result.items, []);
  assert.equal(result.ok, false);
  assert.equal(result.rejected[0].reason, "too_long");
});

test("no more than five items survive", () => {
  const result = normalizeShortBioItems([
    "Filolog", "Kitobxon", "Volontyor", "Talaba", "Ijodkor", "Sportchi", "Tarjimon",
  ]);
  assert.equal(result.items.length, SHORT_BIO_MAX_ITEMS);
  assert.equal(result.rejected.filter((entry) => entry.reason === "over_limit").length, 2);
});

test("items longer than 40 characters are dropped", () => {
  const long = "Xalqaro tanlovlar sovrindori va yosh tadbirkorlar rahnamosi";
  assert.ok(long.length > 40);
  const result = normalizeShortBioItems(["Buxgalter", long]);
  assert.deepEqual(result.items, ["Buxgalter"]);
  assert.equal(result.rejected[0].reason, "too_long");
});

test("a six-word phrase inside the length limit is still too wordy", () => {
  const phrase = "Yosh va faol jamoat ish yurituvchi";
  assert.ok(phrase.length <= 40, "the phrase must not trip the length rule instead");
  const result = normalizeShortBioItems([phrase]);
  assert.deepEqual(result.items, []);
  assert.equal(result.rejected[0].reason, "too_many_words");
});

test("verb-ended clauses are rejected as sentences", () => {
  const result = normalizeShortBioItems(["Kitob o'qishni yaxshi ko'radi"]);
  assert.deepEqual(result.items, []);
  assert.equal(result.rejected[0].reason, "sentence_like");
});

test("trailing periods are stripped rather than rejected", () => {
  const result = normalizeShortBioItems(["Filolog.", "Kitobxon,"]);
  assert.deepEqual(result.items, ["Filolog", "Kitobxon"]);
});

test("duplicates are removed case- and apostrophe-insensitively", () => {
  const result = normalizeShortBioItems(["Bo'lajak yurist", "bo‘lajak yurist", "Kitobxon"]);
  assert.deepEqual(result.items, ["Bo'lajak yurist", "Kitobxon"]);
  assert.equal(result.rejected[0].reason, "duplicate");
});

test("empty input produces no items and is not ok", () => {
  const result = normalizeShortBioItems("   |   |  ");
  assert.deepEqual(result.items, []);
  assert.equal(result.ok, false);
});

test("items round-trip through the pipe separator", () => {
  const items = ["Buxgalter", "Yosh tadbirkor", "AI izdoshi"];
  assert.equal(joinShortBioItems(items), "Buxgalter | Yosh tadbirkor | AI izdoshi");
  assert.deepEqual(normalizeShortBioItems(joinShortBioItems(items)).items, items);
});
