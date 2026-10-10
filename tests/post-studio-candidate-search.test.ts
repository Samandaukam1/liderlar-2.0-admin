import { test } from "node:test";
import assert from "node:assert/strict";

import { candidateSearchPatterns } from "../src/lib/post-studio/candidate-search.ts";

test("every typed word becomes its own pattern, so word order does not matter", () => {
  assert.deepEqual(candidateSearchPatterns("  Madina   Avaz "), ["%Madina%", "%Avaz%"]);
});

test("any apostrophe matches any other apostrophe", () => {
  assert.deepEqual(candidateSearchPatterns("G'ulom"), ["%G_ulom%"]);
  assert.deepEqual(candidateSearchPatterns("Gʻulom"), ["%G_ulom%"]);
  assert.deepEqual(candidateSearchPatterns("O‘g‘li"), ["%O_g_li%"]);
});

test("pattern wildcards in the input cannot widen the search", () => {
  assert.deepEqual(candidateSearchPatterns("%"), []);
  assert.deepEqual(candidateSearchPatterns("a%b_c*d\\e"), ["%a%", "%b%", "%c%", "%d%", "%e%"]);
  assert.deepEqual(candidateSearchPatterns("'"), []);
});

test("empty input yields no patterns", () => {
  assert.deepEqual(candidateSearchPatterns(""), []);
  assert.deepEqual(candidateSearchPatterns("   "), []);
});

test("at most five words are used", () => {
  assert.equal(candidateSearchPatterns("a b c d e f g").length, 5);
});
