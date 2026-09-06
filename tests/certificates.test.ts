import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const GENERATE = fs.readFileSync("src/lib/certificates/generate.ts", "utf8");
const FONTS = fs.readFileSync("src/lib/certificates/fonts.ts", "utf8");

const SCRIPT_FONT = "public/assets/certificates/fonts/great-vibes-regular.ttf";
const FALLBACK_FONT = "public/assets/certificates/fonts/noto-sans-regular.ttf";

test("the candidate name is drawn one character at a time", () => {
  // Handing pdf-lib a whole string, with the font embedded unsubsetted, lays
  // it out through fontkit's shaper and the advances that reach the PDF stop
  // matching the widths written for those glyphs: Great Vibes rendered
  // "Boboqulov" as "Bob oqu lov", gaps torn open mid-word. All four
  // combinations were rendered to confirm it needs BOTH the full embed and
  // the multi-character call.
  const loop = GENERATE.slice(GENERATE.indexOf("let cursorX ="), GENERATE.indexOf("// ---- QR code"));
  assert.match(loop, /for \(const ch of Array\.from\(run\.text\)\)/, "iterates characters");
  assert.match(loop, /pdfPage\.drawText\(ch,/, "draws one character per call");
  assert.match(loop, /cursorX \+= run\.font\.embedded\.widthOfTextAtSize\(ch, size\)/);
  assert.ok(
    !/drawText\(run\.text/.test(loop),
    "a whole run in one drawText is what caused the gaps",
  );
});

test("the name is measured the same way it is drawn", () => {
  // Centring uses the measured width. Measuring the whole string in one call
  // while painting glyph by glyph would leave the name off-centre by the
  // difference between the two.
  assert.match(FONTS, /export function measureRunWidth/);
  assert.match(FONTS, /for \(const ch of Array\.from\(run\.text\)\)/);
  assert.match(FONTS, /sum \+ measureRunWidth\(run, size\)/);
});

test("the fonts stay embedded whole, and the reason stays written down", () => {
  // The subsetter silently drops glyphs for these files, so the per-character
  // drawing above is the fix rather than flipping this flag.
  assert.match(FONTS, /subset: false/);
  assert.match(FONTS, /subsetter silently drops glyphs/);
});

test("Great Vibes covers a Latin Uzbek name, and Cyrillic falls back", async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const scriptRaw = fontkit.create(fs.readFileSync(SCRIPT_FONT));
  const fallbackRaw = fontkit.create(fs.readFileSync(FALLBACK_FONT));

  // Every character of a real name renders in the script face — nothing here
  // should be reaching the upright fallback.
  for (const ch of "Farrux Boboqulov Amirqul O’g’li") {
    assert.ok(
      scriptRaw.hasGlyphForCodePoint(ch.codePointAt(0)!),
      `Great Vibes has ${JSON.stringify(ch)}`,
    );
  }

  // The Uzbek Cyrillic extras are exactly what the fallback exists for.
  for (const ch of "ЎҚҒҲ") {
    assert.ok(
      fallbackRaw.hasGlyphForCodePoint(ch.codePointAt(0)!),
      `Noto Sans has ${JSON.stringify(ch)}`,
    );
  }
});

test("a long name shrinks to fit rather than running off the certificate", async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(SCRIPT_FONT), { subset: false });

  const layout = fs.readFileSync("src/lib/certificates/certificate-layout.ts", "utf8");
  const maxWidth = Number(layout.match(/maxWidth:\s*([\d.]+)/)![1]);
  const baseSize = Number(layout.match(/baseFontSize:\s*([\d.]+)/)![1]);
  const minSize = Number(layout.match(/minFontSize:\s*([\d.]+)/)![1]);

  const widthAt = (text: string, size: number) =>
    [...text].reduce((sum, ch) => sum + font.widthOfTextAtSize(ch, size), 0);

  // The longest name seen in production so far.
  const longest = "Xamidov Muhammadyusuf Abdusalomjon o’g’li";
  let size = baseSize;
  while (size > minSize && widthAt(longest, size) > maxWidth) size -= 1;
  assert.ok(widthAt(longest, size) <= maxWidth, `fits at ${size}pt`);
  assert.ok(size >= minSize, "and does so without going below the floor");
});
