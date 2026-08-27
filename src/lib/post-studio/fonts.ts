import "server-only";
import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { FontMetrics } from "./text-engine.ts";
import type { PostFontRole } from "./types.ts";
import { POST_FONT_STACKS } from "./font-stacks.ts";

export { POST_FONT_STACKS, fontFamilyAttr } from "./font-stacks.ts";

/**
 * Server-side font loading for Post Studio.
 *
 * Fonts are real TTF files on disk, never fetched at runtime: resvg rasterizes
 * from the same files that fontkit measures, so the widths the auto-fit engine
 * computes are the widths that actually get drawn.
 *
 * Anton is the mandated display face for candidate names but ships **no
 * Cyrillic at all** (verified against its cmap), and Oswald Bold — the natural
 * condensed stand-in — is missing Ҳ/ҳ. The chains below therefore end in
 * Montserrat, which covers every Uzbek Latin and Cyrillic letter, so a Cyrillic
 * name degrades to a similar condensed weight instead of rendering as tofu.
 */

export interface PostFontFile {
  /** Family name used in the generated SVG's font-family list. */
  family: string;
  /** Repo-relative path, resolved against process.cwd(). */
  file: string;
}

const FONT_DIR = "public/assets/post-studio/fonts";

/**
 * Resolved with a statically-written directory prefix and a dynamic file name
 * only. Turbopack's file tracer gives up and bundles the whole project when it
 * sees a fully computed path.join(process.cwd(), someVariable).
 */
function fontPath(fileName: string): string {
  return path.join(process.cwd(), "public/assets/post-studio/fonts", fileName);
}

export const POST_FONT_FILES: PostFontFile[] = [
  { family: "Anton", file: `${FONT_DIR}/anton-regular.ttf` },
  { family: "Oswald", file: `${FONT_DIR}/oswald-bold.ttf` },
  { family: "Montserrat SemiBold", file: `${FONT_DIR}/montserrat-semibold.ttf` },
  { family: "Montserrat", file: `${FONT_DIR}/montserrat-medium.ttf` },
];

/** File name portion of a registered font, e.g. "anton-regular.ttf". */
function fontFileName(entry: PostFontFile): string {
  return entry.file.slice(entry.file.lastIndexOf("/") + 1);
}

type LoadedFont = ReturnType<typeof fontkit.create>;

const fontCache = new Map<string, LoadedFont>();

function loadFont(family: string): LoadedFont {
  const cached = fontCache.get(family);
  if (cached) return cached;

  const entry = POST_FONT_FILES.find((f) => f.family === family);
  if (!entry) throw new Error(`Post Studio font family not registered: ${family}`);

  const font = fontkit.create(fs.readFileSync(fontPath(fontFileName(entry))));
  fontCache.set(family, font);
  return font;
}

let cachedFontBuffers: Buffer[] | null = null;

/** Raw TTF buffers handed to resvg so it rasterizes from the measured files. */
export function loadPostFontBuffers(): Buffer[] {
  if (cachedFontBuffers) return cachedFontBuffers;
  cachedFontBuffers = POST_FONT_FILES.map((f) => fs.readFileSync(fontPath(fontFileName(f))));
  return cachedFontBuffers;
}

/** Absolute paths, for resvg's `fontFiles` option. */
export function postFontFilePaths(): string[] {
  return POST_FONT_FILES.map((f) => fontPath(fontFileName(f)));
}

interface FontWithSize {
  font: LoadedFont;
  unitsPerEm: number;
}

function chainFor(role: PostFontRole): FontWithSize[] {
  return POST_FONT_STACKS[role].map((family) => {
    const font = loadFont(family);
    return { font, unitsPerEm: font.unitsPerEm };
  });
}

function canRender(font: LoadedFont, codePoint: number): boolean {
  // Whitespace never blocks a font choice; it would otherwise split every run.
  if (codePoint === 0x20) return true;
  return font.hasGlyphForCodePoint(codePoint);
}

/**
 * Builds the FontMetrics the pure text engine consumes. Measurement walks the
 * string once, grouping consecutive characters that resolve to the same font in
 * the fallback chain and shaping each group with fontkit — so a mixed
 * Latin/Cyrillic name is measured with the same fonts that will draw it.
 */
export function getFontMetrics(role: PostFontRole): FontMetrics {
  const chain = chainFor(role);
  if (chain.length === 0) {
    return { advance: () => 0, ascender: 1, descender: 0 };
  }
  const primary = chain[0];

  const pick = (codePoint: number): FontWithSize =>
    chain.find((c) => canRender(c.font, codePoint)) ?? primary;

  return {
    advance(text: string): number {
      if (!text) return 0;
      let total = 0;
      let run = "";
      let runFont: FontWithSize | null = null;

      const flush = () => {
        if (!run || !runFont) return;
        total += runFont.font.layout(run).advanceWidth / runFont.unitsPerEm;
        run = "";
      };

      for (const char of text) {
        const font = pick(char.codePointAt(0) ?? 0x20);
        if (runFont && font !== runFont) flush();
        runFont = font;
        run += char;
      }
      flush();
      return total;
    },
    ascender: primary.font.ascent / primary.unitsPerEm,
    descender: primary.font.descent / primary.unitsPerEm,
  };
}
