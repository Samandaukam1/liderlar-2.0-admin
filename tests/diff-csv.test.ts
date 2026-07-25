import { test } from "node:test";
import assert from "node:assert/strict";
import { diffWords, diffStats } from "../src/lib/diff.ts";
import { parseCsv, toCsv } from "../src/lib/csv.ts";
import { slugify, truncate } from "../src/lib/utils.ts";

test("diff: bir xil matn", () => {
  const ops = diffWords("salom dunyo", "salom dunyo");
  assert.ok(ops.every((o) => o.type === "same"));
});

test("diff: qo'shilgan va olib tashlangan so'zlar", () => {
  const ops = diffWords("men tadbirda qatnashdim", "u tadbirda faol qatnashdi");
  const stats = diffStats(ops);
  assert.ok(stats.added >= 2);
  assert.ok(stats.removed >= 2);
  assert.ok(ops.some((o) => o.type === "same" && o.text.includes("tadbirda")));
});

test("diff: bo'sh matnlar", () => {
  assert.deepEqual(diffStats(diffWords("", "yangi matn")), { added: 2, removed: 0 });
  assert.deepEqual(diffStats(diffWords("eski matn", "")), { added: 0, removed: 2 });
});

test("csv: qo'shtirnoqli maydonlar va CRLF", () => {
  const rows = parseCsv('name,bio\r\n"Aziza, K","U ""lider"" deb ataladi"\r\nBobur,oddiy');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ["Aziza, K", 'U "lider" deb ataladi']);
  assert.deepEqual(rows[2], ["Bobur", "oddiy"]);
});

test("csv: toCsv escape va round-trip", () => {
  const data = [
    ["name", "note"],
    ["Aziza, K", 'multi\nline "quoted"'],
  ];
  const csv = toCsv(data);
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed[1], data[1]);
});

test("slugify: kirill va apostroflar", () => {
  assert.equal(slugify("Aziza Karimova"), "aziza-karimova");
  assert.equal(slugify("O‘tkir G‘aniyev"), "otkir-ganiyev");
  assert.equal(slugify("Азиза Каримова"), "aziza-karimova");
  assert.ok(slugify("A".repeat(200)).length <= 80);
});

test("truncate uzun sarlavhalarni qisqartiradi", () => {
  const long = "Juda uzun sarlavha ".repeat(20);
  assert.ok(truncate(long, 50).length <= 50);
  assert.ok(truncate(long, 50).endsWith("…"));
  assert.equal(truncate("qisqa", 50), "qisqa");
});
