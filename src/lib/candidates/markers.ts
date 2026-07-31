export const CANDIDATE_MARKERS = {
  fullName: "!!!",
  descriptionItems: "&&&",
  birthYear: "+++",
  birthPlace: "***",
  currentLocation: "$$$",
  education: "(((",
  activityField: ")))",
  languages: "%%%",
  section: "^^^",
} as const;

export type CandidateScalarField = Exclude<keyof typeof CANDIDATE_MARKERS, "section">;
export type CandidateMarker = (typeof CANDIDATE_MARKERS)[keyof typeof CANDIDATE_MARKERS];

export const MARKER_TO_FIELD = Object.fromEntries(
  Object.entries(CANDIDATE_MARKERS).map(([field, marker]) => [marker, field]),
) as Record<CandidateMarker, keyof typeof CANDIDATE_MARKERS>;

export const ALL_CANDIDATE_MARKERS = Object.values(CANDIDATE_MARKERS) as CandidateMarker[];

export const CANDIDATE_FIELD_LABELS: Record<CandidateScalarField, string> = {
  fullName: "Ism-familiya",
  descriptionItems: "Qisqa tavsif",
  birthYear: "Tug‘ilgan yili",
  birthPlace: "Tug‘ilgan joyi",
  currentLocation: "Hozirda yashash hududi",
  education: "Ta’limi",
  activityField: "Faoliyat sohasi",
  languages: "Tillar",
};

