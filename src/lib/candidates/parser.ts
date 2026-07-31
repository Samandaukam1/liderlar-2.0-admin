import {
  ALL_CANDIDATE_MARKERS,
  CANDIDATE_FIELD_LABELS,
  CANDIDATE_MARKERS,
  MARKER_TO_FIELD,
  type CandidateMarker,
  type CandidateScalarField,
} from "./markers.ts";
import { emptyCandidateData, type CandidateStructuredData } from "./schema.ts";

export type ParserWarningCode =
  | "duplicate_marker"
  | "empty_value"
  | "missing_marker"
  | "marker_spacing"
  | "section_without_title"
  | "section_without_content"
  | "unparsed_text";

export interface ParserWarning {
  code: ParserWarningCode;
  message: string;
  line?: number;
  marker?: CandidateMarker;
}

export interface CandidateParseResult {
  data: CandidateStructuredData;
  warnings: ParserWarning[];
  duplicates: CandidateMarker[];
  unparsedText: string;
  rawText: string;
}

type Block = {
  marker: CandidateMarker;
  firstLine: string;
  lines: string[];
  line: number;
};

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function cleanBlock(lines: string[]): string {
  const joined = lines.join("\n").replace(/[ \t]+$/gm, "");
  return joined.trim().replace(/\n{3,}/g, "\n\n");
}

export function splitPipeValues(value: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split("|") : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of parts) {
    const item = String(raw).trim();
    const key = item.toLocaleLowerCase("uz");
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function markerAtLineStart(line: string): CandidateMarker | null {
  return ALL_CANDIDATE_MARKERS.find((marker) => line.startsWith(marker)) ?? null;
}

export function stripCandidateMarkers(value: string | null | undefined): string {
  if (!value) return "";
  return normalizeNewlines(value)
    .split("\n")
    .map((line) => {
      const marker = markerAtLineStart(line);
      return marker ? line.slice(marker.length).replace(/^\s+/, "") : line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseCandidateText(input: string): CandidateParseResult {
  const rawText = normalizeNewlines(input);
  const data = emptyCandidateData();
  const warnings: ParserWarning[] = [];
  const duplicates: CandidateMarker[] = [];
  const unparsedChunks: string[] = [];
  const seen = new Set<CandidateScalarField>();
  let block: Block | null = null;
  let preamble: string[] = [];

  const flushPreamble = () => {
    const text = cleanBlock(preamble);
    if (text) unparsedChunks.push(text);
    preamble = [];
  };

  const flushBlock = () => {
    if (!block) return;
    const current = block;
    block = null;
    const value = cleanBlock([current.firstLine, ...current.lines]);

    if (current.firstLine.startsWith(" ") || current.firstLine.startsWith("\t")) {
      warnings.push({
        code: "marker_spacing",
        marker: current.marker,
        line: current.line,
        message: `${current.marker} markeridan keyin bo‘sh joy olib tashlandi`,
      });
    }

    if (current.marker === CANDIDATE_MARKERS.section) {
      const title = current.firstLine.trim();
      const content = cleanBlock(current.lines);
      if (!title) {
        warnings.push({ code: "section_without_title", marker: current.marker, line: current.line, message: "Bo‘lim sarlavhasi bo‘sh" });
      }
      if (!content) {
        warnings.push({ code: "section_without_content", marker: current.marker, line: current.line, message: `“${title || "Sarlavhasiz bo‘lim"}” matni bo‘sh` });
      }
      if (title || content) {
        data.sections.push({ id: crypto.randomUUID(), title, content, order: data.sections.length });
      }
      return;
    }

    const field = MARKER_TO_FIELD[current.marker] as CandidateScalarField;
    if (seen.has(field)) {
      duplicates.push(current.marker);
      warnings.push({
        code: "duplicate_marker",
        marker: current.marker,
        line: current.line,
        message: `${CANDIDATE_FIELD_LABELS[field]} markeri takrorlangan; takroriy matn “Ajratilmagan matn”da saqlandi`,
      });
      unparsedChunks.push(`${current.marker}${current.firstLine}\n${current.lines.join("\n")}`.trim());
      return;
    }
    seen.add(field);

    if (!value) {
      warnings.push({ code: "empty_value", marker: current.marker, line: current.line, message: `${CANDIDATE_FIELD_LABELS[field]} qiymati bo‘sh` });
    }
    if (field === "descriptionItems" || field === "languages") {
      data[field] = splitPipeValues(value);
    } else {
      data[field] = value;
    }
  };

  rawText.split("\n").forEach((line, index) => {
    const marker = markerAtLineStart(line);
    if (marker) {
      flushPreamble();
      flushBlock();
      block = { marker, firstLine: line.slice(marker.length), lines: [], line: index + 1 };
      return;
    }
    if (block) block.lines.push(line);
    else preamble.push(line);
  });
  flushBlock();
  flushPreamble();

  for (const [field, marker] of Object.entries(CANDIDATE_MARKERS)) {
    if (field === "section") continue;
    if (!seen.has(field as CandidateScalarField)) {
      warnings.push({
        code: "missing_marker",
        marker,
        message: `${CANDIDATE_FIELD_LABELS[field as CandidateScalarField]} markeri topilmadi`,
      });
    }
  }

  const unparsedText = cleanBlock(unparsedChunks);
  if (unparsedText) {
    warnings.push({ code: "unparsed_text", message: "Markerga tegishli bo‘lmagan matn alohida saqlandi" });
  }
  data.rawContent = rawText;
  data.unparsedContent = unparsedText;

  return { data, warnings, duplicates, unparsedText, rawText };
}
