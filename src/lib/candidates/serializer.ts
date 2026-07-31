import { CANDIDATE_MARKERS } from "./markers.ts";
import type { CandidateStructuredData } from "./schema.ts";
import { splitPipeValues } from "./parser.ts";

function scalar(marker: string, value: string): string | null {
  const clean = value.trim();
  return clean ? `${marker}${clean}` : null;
}

export function serializeCandidateData(data: CandidateStructuredData): string {
  const blocks: Array<string | null> = [
    scalar(CANDIDATE_MARKERS.fullName, data.fullName),
    scalar(CANDIDATE_MARKERS.descriptionItems, splitPipeValues(data.descriptionItems).join(" | ")),
    scalar(CANDIDATE_MARKERS.birthYear, data.birthYear),
    scalar(CANDIDATE_MARKERS.birthPlace, data.birthPlace),
    scalar(CANDIDATE_MARKERS.currentLocation, data.currentLocation),
    scalar(CANDIDATE_MARKERS.education, data.education),
    scalar(CANDIDATE_MARKERS.activityField, data.activityField),
    scalar(CANDIDATE_MARKERS.languages, splitPipeValues(data.languages).join(" | ")),
    ...[...data.sections]
      .sort((a, b) => a.order - b.order)
      .map((section) => {
        const title = section.title.trim();
        const content = section.content.trim();
        if (!title && !content) return null;
        return `${CANDIDATE_MARKERS.section}${title}${content ? `\n\n${content}` : ""}`;
      }),
  ];
  return blocks.filter((block): block is string => Boolean(block)).join("\n\n").trim();
}
