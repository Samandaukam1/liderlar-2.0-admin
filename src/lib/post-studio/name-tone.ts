import { NAME_DARK_LINE_INDEX, type LaidOutBlock } from "./types.ts";

/**
 * Two-tone name colouring.
 *
 * The reference posters set the surname and given name in white and drop the
 * trailing patronymic line ("... QIZI" / "... O‘G‘LI") to ink black against the
 * cyan band. `splitNameIntoLines` always emits the patronymic last, so the rule
 * is positional: everything from `NAME_DARK_LINE_INDEX` down takes the dark
 * tone, and a two-line name never reaches it and stays entirely white.
 *
 * Tones rather than colours, like the quote's accent split — the concrete hex
 * is resolved from the current template when the run is painted.
 */
export function applyNameDarkTail(
  block: LaidOutBlock,
  fromIndex: number = NAME_DARK_LINE_INDEX,
): LaidOutBlock {
  if (block.lines.length <= fromIndex) return block;

  return {
    ...block,
    lines: block.lines.map((line, index) =>
      index < fromIndex
        ? line
        : { ...line, runs: line.runs.map((run) => ({ ...run, tone: "dark" as const })) },
    ),
  };
}
