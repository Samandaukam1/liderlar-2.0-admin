import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkFactPreservation,
  extractFacts,
  formatMissingFactsPrompt,
  stemWord,
  textContainsFact,
} from "../src/lib/intake/fact-preservation.ts";

const ORIGINAL_BUXGALTER =
  "2024-yilda 3 ta korxona bilan ish boshladim, hozir 23 ta xususiy korxonaning hisob-kitoblarini yuritaman.";

test("summarizing away the numbers is reported as fact loss", () => {
  const report = checkFactPreservation(ORIGINAL_BUXGALTER, "U buxgalteriya sohasida faoliyat yuritadi.");
  assert.equal(report.ok, false);
  const missing = report.missing.map((fact) => fact.key);
  assert.deepEqual(missing.sort(), ["2024", "23", "3"].sort());
});

test("the correct third-person rewrite preserves every number", () => {
  const report = checkFactPreservation(
    ORIGINAL_BUXGALTER,
    "U 2024-yilda faoliyatini 3 ta korxona bilan boshlagan. Bugungi kunda esa 23 ta xususiy korxonaning hisob-kitoblarini yuritib kelmoqda.",
  );
  assert.equal(report.ok, true);
  assert.deepEqual(report.missing, []);
});

test("dates keep both the year and the day", () => {
  const facts = extractFacts("Men 2005-yil 18-oktyabrda tug'ilganman.");
  const keys = facts.filter((fact) => fact.kind === "number").map((fact) => fact.key);
  assert.ok(keys.includes("2005"));
  assert.ok(keys.includes("18"));
});

test("a changed case ending does not count as a lost university", () => {
  const report = checkFactPreservation(
    "Men Edinburg universitetida o'qiganman.",
    "U Edinburg universiteti bitiruvchisi.",
  );
  assert.equal(report.ok, true);
});

test("dropping the university entirely is reported", () => {
  const report = checkFactPreservation(
    "Men Farg'ona davlat universitetida tahsil olaman.",
    "U oliy ta'lim muassasasida tahsil oladi.",
  );
  assert.equal(report.ok, false);
  assert.ok(report.missing.some((fact) => fact.kind === "proper_noun"));
});

test("apostrophe glyph variants are not treated as different words", () => {
  const report = checkFactPreservation("Men Farg‘ona viloyatida yashayman.", "U Farg'ona viloyatida yashaydi.");
  assert.equal(report.ok, true);
});

test("quoted award names are preserved verbatim", () => {
  const facts = extractFacts('U "Do\'stlik elchisi" ko\'krak nishoni bilan taqdirlangan.');
  const quotes = facts.filter((fact) => fact.kind === "quote");
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].value, "Do'stlik elchisi");
  assert.equal(textContainsFact('“Do‘stlik elchisi” sohibasi', quotes[0]), true);
  assert.equal(textContainsFact("U turli mukofotlarga sazovor bo'lgan", quotes[0]), false);
});

test("sentence-initial pronouns are not mistaken for proper nouns", () => {
  const facts = extractFacts("Men kitob o'qishni yaxshi ko'raman. U menga ilhom beradi.");
  assert.deepEqual(facts.filter((fact) => fact.kind === "proper_noun"), []);
});

test("stemming strips Uzbek case endings but keeps short stems intact", () => {
  assert.equal(stemWord("Farg'onada"), stemWord("Farg'ona"));
  assert.equal(stemWord("universitetida"), stemWord("universiteti"));
  assert.equal(stemWord("kitob"), "kitob");
});

test("percentages survive as numeric facts", () => {
  const report = checkFactPreservation("Rejani 95% bajardim.", "U rejani to'liq bajargan.");
  assert.equal(report.ok, false);
  assert.ok(report.missing.some((fact) => fact.key === "95"));
});

test("the retry prompt lists every missing fact", () => {
  const report = checkFactPreservation(ORIGINAL_BUXGALTER, "U buxgalter.");
  const prompt = formatMissingFactsPrompt(report.missing);
  assert.match(prompt, /2024/);
  assert.match(prompt, /23/);
  assert.equal(formatMissingFactsPrompt([]), "");
});

test("an empty original detects nothing and always passes", () => {
  const report = checkFactPreservation("", "");
  assert.equal(report.ok, true);
  assert.equal(report.detected.length, 0);
});
