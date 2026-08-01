import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";
import { CERTIFICATE_LAYOUT } from "@/lib/certificates/certificate-layout";

interface LoadedFont {
  /** Raw fontkit font, used only to check per-character glyph coverage. */
  raw: ReturnType<typeof fontkit.create>;
  /** pdf-lib embedded font, used for drawing/measuring. */
  embedded: PDFFont;
  /**
   * When true, this font is only trusted for Latin-script text even if its
   * cmap technically has other glyphs. Great Vibes *does* contain Cyrillic
   * glyphs, but they're not designed to connect with the font's cursive
   * flow the way its Latin glyphs are — mixing them in produces overlapping,
   * garbled output. Restricting it to Latin forces Cyrillic through the
   * (upright, but legible) fallback font instead.
   */
  latinOnly: boolean;
}

/** Basic Latin, Latin-1 Supplement, Latin Extended-A/B, plus the specific
 * apostrophe-like marks used for Uzbek's oʻ/gʻ digraphs. */
function isLatinScriptSafe(codePoint: number): boolean {
  if (codePoint <= 0x024f) return true;
  return codePoint === 0x2019 || codePoint === 0x02bb; // ’ and ʻ
}

export interface FontRun {
  font: LoadedFont;
  text: string;
}

const fontFileCache = new Map<string, Buffer>();

async function readFontFile(relativePath: string): Promise<Buffer> {
  const cached = fontFileCache.get(relativePath);
  if (cached) return cached;
  const bytes = await fs.readFile(path.join(process.cwd(), relativePath));
  fontFileCache.set(relativePath, bytes);
  return bytes;
}

async function loadFont(
  pdfDoc: PDFDocument,
  relativePath: string,
  latinOnly: boolean
): Promise<LoadedFont> {
  const bytes = await readFontFile(relativePath);
  const raw = fontkit.create(bytes);
  // Deliberately embedded WITHOUT subsetting (`subset: false`). Verified by
  // hand (draw + render with mutool/PyMuPDF, not just "did embedFont throw"):
  // @pdf-lib/fontkit's TTF subsetter silently drops glyphs for some fonts
  // (confirmed on Noto Sans — several Cyrillic letters vanished with no
  // error) and outright produces an invalid FontFile2 for WOFF2 sources
  // ("unknown file format" in real PDF readers). Both font files here are
  // plain TrueType and small enough that full embedding is cheap.
  const embedded = await pdfDoc.embedFont(bytes, { subset: false });
  return { raw, embedded, latinOnly };
}

/** Loads the Great Vibes script font plus its Cyrillic fallback, in priority order. */
export async function loadCandidateNameFonts(pdfDoc: PDFDocument): Promise<LoadedFont[]> {
  const { fontFile, fallbackFontFiles } = CERTIFICATE_LAYOUT.candidateName;
  return Promise.all([
    loadFont(pdfDoc, fontFile, true),
    ...fallbackFontFiles.map((f) => loadFont(pdfDoc, f, false)),
  ]);
}

function fontCoversCodePoint(font: LoadedFont, codePoint: number): boolean {
  if (font.latinOnly && !isLatinScriptSafe(codePoint)) return false;
  return font.raw.hasGlyphForCodePoint(codePoint);
}

/**
 * Splits `text` into runs of consecutive characters that share the same
 * font — the first font (in priority order) that has a glyph for each
 * character wins. This is what lets a name render in Great Vibes end to end
 * for the common (Latin) case, while still rendering correctly (via a
 * Cyrillic fallback) instead of showing tofu boxes for characters Great
 * Vibes' Latin subset doesn't cover (e.g. Ў/Қ/Ғ/Ҳ).
 */
export function splitIntoFontRuns(text: string, fonts: LoadedFont[]): FontRun[] {
  const runs: FontRun[] = [];
  for (const ch of Array.from(text)) {
    const codePoint = ch.codePointAt(0)!;
    const font = fonts.find((f) => fontCoversCodePoint(f, codePoint)) ?? fonts[0];
    const last = runs[runs.length - 1];
    if (last && last.font === font) {
      last.text += ch;
    } else {
      runs.push({ font, text: ch });
    }
  }
  return runs;
}

export function measureRunsWidth(runs: FontRun[], size: number): number {
  return runs.reduce((sum, run) => sum + run.font.embedded.widthOfTextAtSize(run.text, size), 0);
}

/**
 * Finds the largest font size (between `baseSize` and `minSize`) at which
 * `runs` fit within `maxWidth`, decrementing by whole points.
 */
export function fitFontSize(
  runs: FontRun[],
  baseSize: number,
  minSize: number,
  maxWidth: number
): number {
  for (let size = baseSize; size > minSize; size -= 1) {
    if (measureRunsWidth(runs, size) <= maxWidth) return size;
  }
  return minSize;
}
