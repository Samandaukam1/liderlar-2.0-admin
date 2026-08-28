/**
 * Two-tone quote colouring.
 *
 * The reference posts render the opening half of the quote in a bright tint of
 * the template's own accent and the remainder in white. The split lands on a
 * word boundary nearest the quote's mid-point by character count, so the colour
 * change reads as deliberate rather than mid-word.
 */

import { measureText, type FontMetrics } from "./text-engine.ts";
import type { LaidOutBlock, LaidOutLine, LaidOutRun, PaintTone } from "./types.ts";

/**
 * Index of the first word that should be white. Chosen so the accent run is as
 * close to half the quote's characters as possible without ever consuming the
 * whole quote (a fully-accent quote would lose the two-tone effect).
 */
export function findQuoteSplitWordIndex(words: string[]): number {
  if (words.length <= 1) return words.length;

  const total = words.join(" ").length;
  const half = total / 2;

  let consumed = 0;
  let bestIndex = 1;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let i = 0; i < words.length; i += 1) {
    consumed += words[i].length + (i > 0 ? 1 : 0);
    const delta = Math.abs(consumed - half);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i + 1;
    }
  }

  // Keep at least one word in each colour.
  return Math.min(Math.max(bestIndex, 1), words.length - 1);
}

/**
 * Rewrites a laid-out quote block's runs so the leading half is accent-toned.
 * Runs are positioned by measuring the prefix that precedes them on their own
 * line, which keeps every run's x exact under the same metrics the wrap used —
 * no re-measurement drift between preview and final render.
 *
 * Tones, not colours: the concrete hex is resolved from the current template at
 * paint time, so switching template recolours the split instead of leaving the
 * previous template's accent baked into the runs.
 */
export function applyQuoteColorSplit(
  block: LaidOutBlock,
  metrics: FontMetrics,
): LaidOutBlock {
  const words = block.lines.flatMap((line) => line.text.split(" ").filter(Boolean));
  if (words.length === 0) return block;

  const splitAt = findQuoteSplitWordIndex(words);
  const measureOptions = { fontSize: block.fontSize, tracking: block.tracking };

  let wordCursor = 0;

  const lines: LaidOutLine[] = block.lines.map((line) => {
    const lineWords = line.text.split(" ").filter(Boolean);
    const runs: LaidOutRun[] = [];

    let runStart = 0;
    let runTone: PaintTone = wordCursor < splitAt ? "accent" : "base";

    const flush = (endExclusive: number) => {
      if (endExclusive <= runStart) return;
      const text = lineWords.slice(runStart, endExclusive).join(" ");
      const prefix = lineWords.slice(0, runStart).join(" ");
      // A run that starts mid-line begins after its prefix plus the space.
      const offset = prefix ? measureText(`${prefix} `, metrics, measureOptions) : 0;
      runs.push({ text, x: line.x + offset, tone: runTone });
      runStart = endExclusive;
    };

    for (let i = 0; i < lineWords.length; i += 1) {
      const tone: PaintTone = wordCursor + i < splitAt ? "accent" : "base";
      if (tone !== runTone) {
        flush(i);
        runTone = tone;
      }
    }
    flush(lineWords.length);

    wordCursor += lineWords.length;
    return { ...line, runs };
  });

  return { ...block, lines };
}
