/**
 * Post Studio typography engine — pure, dependency-free, unit-testable.
 *
 * It never touches the filesystem or a browser: callers hand it a FontMetrics
 * implementation (fonts.ts builds one from real TTF tables via fontkit), so the
 * exact same wrapping and auto-fit maths runs in tests, in the preview payload
 * and in the final raster. That single code path is what keeps the browser
 * preview and the server render from drifting apart.
 *
 * Line heights are CSS-accurate: a line box is `fontSize * lineHeight` tall and
 * the baseline sits inside it via the half-leading model, so `NAME_LINE_HEIGHT
 * = 1.09` really does mean "100px text -> 109px baseline-to-baseline".
 */

import type { Box, LaidOutBlock, LaidOutLine, PostFontRole, TextAlign } from "./types.ts";

export interface FontMetrics {
  /** Advance width of `text` at font-size 1 (i.e. in em units). */
  advance(text: string): number;
  /** Ascender as a fraction of the em square (positive). */
  ascender: number;
  /** Descender as a fraction of the em square (negative). */
  descender: number;
}

export interface MeasureOptions {
  fontSize: number;
  /** Extra letter spacing as a fraction of font size. */
  tracking?: number;
}

/** Width of a single rendered line, tracking included. */
export function measureText(
  text: string,
  metrics: FontMetrics,
  { fontSize, tracking = 0 }: MeasureOptions,
): number {
  if (!text) return 0;
  const base = metrics.advance(text) * fontSize;
  // Tracking is applied between glyphs, so a run of n characters gains n-1 gaps.
  const gaps = Math.max(0, [...text].length - 1);
  return base + gaps * tracking * fontSize;
}

/**
 * Greedy word wrap. A single word wider than `maxWidth` is kept on its own line
 * rather than being hyphenated or truncated — the resulting overflow is what
 * tells the auto-fit loop to try a smaller size, and if even the minimum size
 * cannot hold it the post is flagged for review instead of being silently cut.
 */
export function wrapText(
  text: string,
  metrics: FontMetrics,
  maxWidth: number,
  options: MeasureOptions,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measureText(candidate, metrics, options) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** CSS half-leading: where the first baseline sits below the box's top edge. */
export function firstBaselineOffset(
  fontSize: number,
  lineHeight: number,
  metrics: FontMetrics,
): number {
  const contentHeight = (metrics.ascender - metrics.descender) * fontSize;
  const halfLeading = (fontSize * lineHeight - contentHeight) / 2;
  return halfLeading + metrics.ascender * fontSize;
}

export interface FitOptions {
  metrics: FontMetrics;
  box: Box;
  maxFontSize: number;
  minFontSize: number;
  lineHeight: number;
  tracking?: number;
  align?: TextAlign;
  /** Step used when shrinking; 1 unit at 810-space is ~1.33px at 1080. */
  step?: number;
  /** Hard cap on line count (name splitting already pre-decides its lines). */
  maxLines?: number;
}

export interface FitResult {
  fontSize: number;
  lines: string[];
  /** True when even `minFontSize` could not contain the text. */
  overflow: boolean;
  /** Total laid-out height, i.e. lines * fontSize * lineHeight. */
  height: number;
  widest: number;
}

function evaluate(
  lines: string[],
  metrics: FontMetrics,
  fontSize: number,
  lineHeight: number,
  tracking: number,
): { height: number; widest: number } {
  const widest = lines.reduce(
    (max, line) => Math.max(max, measureText(line, metrics, { fontSize, tracking })),
    0,
  );
  return { height: lines.length * fontSize * lineHeight, widest };
}

/**
 * Shrink-to-fit for free-flowing text (the quote): re-wraps at every candidate
 * size, because a smaller font changes the line breaks, which changes the
 * height — a clamp() on font-size cannot express this.
 */
export function fitWrappedText(text: string, options: FitOptions): FitResult {
  const { metrics, box, maxFontSize, minFontSize, lineHeight, tracking = 0, step = 1, maxLines } =
    options;

  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) {
    return { fontSize: maxFontSize, lines: [], overflow: false, height: 0, widest: 0 };
  }

  let last: FitResult | null = null;

  for (let size = maxFontSize; size >= minFontSize; size -= step) {
    const lines = wrapText(clean, metrics, box.width, { fontSize: size, tracking });
    const { height, widest } = evaluate(lines, metrics, size, lineHeight, tracking);
    const fits =
      height <= box.height + 1e-6 &&
      widest <= box.width + 1e-6 &&
      (maxLines === undefined || lines.length <= maxLines);

    last = { fontSize: size, lines, overflow: !fits, height, widest };
    if (fits) return last;
  }

  return last ?? { fontSize: minFontSize, lines: [clean], overflow: true, height: 0, widest: 0 };
}

/**
 * Shrink-to-fit for text whose line breaks are already decided (the candidate
 * name, and the short-bio badge list where each item owns a line).
 */
export function fitFixedLines(lines: string[], options: FitOptions): FitResult {
  const { metrics, box, maxFontSize, minFontSize, lineHeight, tracking = 0, step = 1 } = options;
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  if (clean.length === 0) {
    return { fontSize: maxFontSize, lines: [], overflow: false, height: 0, widest: 0 };
  }

  let last: FitResult | null = null;

  for (let size = maxFontSize; size >= minFontSize; size -= step) {
    const { height, widest } = evaluate(clean, metrics, size, lineHeight, tracking);
    const fits = height <= box.height + 1e-6 && widest <= box.width + 1e-6;
    last = { fontSize: size, lines: clean, overflow: !fits, height, widest };
    if (fits) return last;
  }

  return last ?? { fontSize: minFontSize, lines: clean, overflow: true, height: 0, widest: 0 };
}

/** Turns a fit result into absolutely positioned baselines in 810-space. */
export function positionLines(
  fit: FitResult,
  options: {
    metrics: FontMetrics;
    box: Box;
    lineHeight: number;
    align: TextAlign;
    tracking?: number;
    fontRole: PostFontRole;
  },
): LaidOutBlock {
  const { metrics, box, lineHeight, align, tracking = 0, fontRole } = options;
  const first = firstBaselineOffset(fit.fontSize, lineHeight, metrics);

  const lines: LaidOutLine[] = fit.lines.map((text, index) => {
    const width = measureText(text, metrics, { fontSize: fit.fontSize, tracking });
    const x =
      align === "left"
        ? box.x
        : align === "center"
          ? box.x + (box.width - width) / 2
          : box.x + box.width - width;

    return {
      text,
      baseline: box.y + first + index * fit.fontSize * lineHeight,
      x,
      width,
      // Every line starts as one base-toned run; quote-split.ts is what carves
      // an accent run out of the leading half.
      runs: [{ text, x, tone: "base" as const }],
    };
  });

  return {
    lines,
    fontSize: fit.fontSize,
    lineHeight,
    fontRole,
    tracking,
    overflow: fit.overflow,
    box,
  };
}
