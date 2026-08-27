/**
 * Splits a candidate's full name into the 2-3 stacked lines the poster design
 * expects (RASULJONOVA / GULNOZA / AVAZJON QIZI).
 *
 * Pure and unit-tested. It never rewrites the name's letters — Uzbek O‘/G‘,
 * apostrophe variants and Cyrillic all pass through untouched; the only
 * transform is deciding where the line breaks go.
 */

/**
 * Uzbek patronymic tails bind to the name before them ("Avazjon qizi" is one
 * unit, not two), otherwise the splitter happily orphans "qizi" onto its own
 * line. Cyrillic spellings are listed alongside the Latin ones.
 */
const PATRONYMIC_TAILS = new Set([
  "qizi",
  "kizi",
  "qizi.",
  "ogli",
  "og'li",
  "o'g'li",
  "oglu",
  "ugli",
  "qizi,",
  "кизи",
  "қизи",
  "угли",
  "ўғли",
  "оглы",
]);

function unifyApostrophes(value: string): string {
  return value.replace(/[ʻʼ‘’`´ʹ]/g, "'");
}

function isPatronymicTail(token: string): boolean {
  return PATRONYMIC_TAILS.has(unifyApostrophes(token).toLocaleLowerCase("uz"));
}

/** Splits on whitespace, then re-joins Uzbek patronymic tails to their stem. */
export function tokenizeFullName(fullName: string): string[] {
  const raw = fullName.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const units: string[] = [];

  for (const token of raw) {
    if (units.length > 0 && isPatronymicTail(token)) {
      units[units.length - 1] = `${units[units.length - 1]} ${token}`;
    } else {
      units.push(token);
    }
  }
  return units;
}

/**
 * Distributes units across `target` lines, balancing character count so a
 * four-word name does not come out as one very long line and two stubs.
 * Word order is never changed.
 */
function balance(units: string[], target: number): string[] {
  if (units.length <= target) return units;

  const lines: string[] = [];
  let remainingUnits = [...units];
  let remainingLines = target;

  while (remainingLines > 0) {
    if (remainingLines === 1) {
      lines.push(remainingUnits.join(" "));
      break;
    }
    const totalChars = remainingUnits.join(" ").length;
    const idealChars = totalChars / remainingLines;

    let take = 1;
    let bestDelta = Number.POSITIVE_INFINITY;
    // Leave at least one unit for each line still to be filled.
    const maxTake = remainingUnits.length - (remainingLines - 1);
    for (let n = 1; n <= maxTake; n += 1) {
      const delta = Math.abs(remainingUnits.slice(0, n).join(" ").length - idealChars);
      if (delta < bestDelta) {
        bestDelta = delta;
        take = n;
      }
    }
    lines.push(remainingUnits.slice(0, take).join(" "));
    remainingUnits = remainingUnits.slice(take);
    remainingLines -= 1;
  }

  return lines;
}

export interface NameLineOptions {
  /** Design allows 2 or 3 stacked lines; 1 is used only for one-word names. */
  maxLines?: number;
  uppercase?: boolean;
}

/**
 * `Rasuljonova Gulnoza Avazjon qizi` -> ["RASULJONOVA", "GULNOZA", "AVAZJON QIZI"].
 *
 * Uppercasing uses the Uzbek locale so `i` maps correctly and the ‘ in O‘ is
 * left alone.
 */
export function splitNameIntoLines(
  fullName: string,
  { maxLines = 3, uppercase = true }: NameLineOptions = {},
): string[] {
  const units = tokenizeFullName(fullName);
  if (units.length === 0) return [];

  const lines = balance(units, Math.min(maxLines, Math.max(1, units.length)));
  return uppercase ? lines.map((l) => l.toLocaleUpperCase("uz")) : lines;
}
