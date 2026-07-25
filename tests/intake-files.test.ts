import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sniffMime,
  isExecutable,
  isActiveMarkup,
  sanitizeFileName,
  validateIntakeUpload,
} from "../src/lib/intake/files.ts";

const bytes = (...b: number[]) => new Uint8Array(b);
const withTail = (head: number[], len = 64) => {
  const arr = new Uint8Array(len);
  arr.set(head);
  return arr;
};

test("magic bytes: JPEG / PNG / PDF", () => {
  assert.equal(sniffMime(withTail([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffMime(withTail([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffMime(withTail([0x25, 0x50, 0x44, 0x46, 0x2d])), "application/pdf");
});

test("magic bytes: WEBP (RIFF) va HEIC (ftyp)", () => {
  const webp = new Uint8Array(16);
  webp.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  assert.equal(sniffMime(webp), "image/webp");

  const heic = new Uint8Array(16);
  heic.set([0x00, 0x00, 0x00, 0x18], 0);
  heic.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
  heic.set([0x68, 0x65, 0x69, 0x63], 8); // heic
  assert.equal(sniffMime(heic), "image/heic");
});

test("bajariladigan fayllar aniqlanadi", () => {
  assert.equal(isExecutable(bytes(0x4d, 0x5a, 0x90)), true); // MZ
  assert.equal(isExecutable(bytes(0x7f, 0x45, 0x4c, 0x46)), true); // ELF
  assert.equal(isExecutable(bytes(0x23, 0x21, 0x2f)), true); // #!
  assert.equal(isExecutable(withTail([0xff, 0xd8, 0xff])), false);
});

test("faol markup (HTML/SVG) aniqlanadi", () => {
  assert.equal(isActiveMarkup(new TextEncoder().encode("<svg xmlns=...")), true);
  assert.equal(isActiveMarkup(new TextEncoder().encode("<!DOCTYPE html>")), true);
  assert.equal(isActiveMarkup(new TextEncoder().encode("<html>")), true);
  assert.equal(isActiveMarkup(new TextEncoder().encode("salom dunyo")), false);
});

test("validateIntakeUpload: JPEG qabul qilinadi", () => {
  const r = validateIntakeUpload({ bytes: withTail([0xff, 0xd8, 0xff, 0xe0]), declaredMime: "image/jpeg", size: 1000, maxBytes: 10_000 });
  assert.equal(r.ok, true);
  assert.equal(r.mime, "image/jpeg");
  assert.equal(r.kind, "image");
  assert.equal(r.ext, "jpg");
});

test("validateIntakeUpload: bajariladigan fayl rad etiladi", () => {
  const r = validateIntakeUpload({ bytes: withTail([0x4d, 0x5a, 0x90]), declaredMime: "application/octet-stream", size: 1000, maxBytes: 10_000 });
  assert.equal(r.ok, false);
});

test("validateIntakeUpload: haddan katta fayl rad etiladi", () => {
  const r = validateIntakeUpload({ bytes: withTail([0xff, 0xd8, 0xff]), declaredMime: "image/jpeg", size: 99_999, maxBytes: 10_000 });
  assert.equal(r.ok, false);
});

test("validateIntakeUpload: toza matn/CSV qabul qilinadi, JS emas", () => {
  const ok = validateIntakeUpload({ bytes: new TextEncoder().encode("ism,familiya\nA,B"), declaredMime: "text/csv", size: 20, maxBytes: 10_000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.kind, "file");

  // Deklaratsiya text bo'lsa ham, HTML markup rad etiladi
  const bad = validateIntakeUpload({ bytes: new TextEncoder().encode("<script>alert(1)</script>"), declaredMime: "text/plain", size: 25, maxBytes: 10_000 });
  assert.equal(bad.ok, false);
});

test("validateIntakeUpload: docx (zip) faqat to'g'ri deklaratsiya bilan", () => {
  const zip = withTail([0x50, 0x4b, 0x03, 0x04]);
  const docx = validateIntakeUpload({ bytes: zip, declaredMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 500, maxBytes: 10_000 });
  assert.equal(docx.ok, true);
  assert.equal(docx.kind, "document");

  const bogus = validateIntakeUpload({ bytes: zip, declaredMime: "application/x-zip", size: 500, maxBytes: 10_000 });
  assert.equal(bogus.ok, false);
});

test("fayl nomi sanitizatsiyasi (path va taqiqlangan belgilar olib tashlanadi)", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
  // nuqta va probel saqlanadi, taqiqlangan `*` olib tashlanadi
  assert.equal(sanitizeFileName("my photo*.png"), "my photo.png");
  // path ajratgichlar (/ va \) olib tashlanadi
  const cleaned = sanitizeFileName("a/b/c\\d.txt");
  assert.equal(cleaned, "d.txt");
  assert.ok(!cleaned.includes("/") && !cleaned.includes("\\"));
});
