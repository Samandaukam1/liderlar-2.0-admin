import { z } from "zod";

export const CANDIDATE_STATUSES = [
  "intake",
  "ai_processing",
  "draft",
  "review",
  "published",
  "rejected",
  "archived",
] as const;

export const candidateStatusSchema = z.enum(CANDIDATE_STATUSES);

export const candidateSectionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(240),
  content: z.string().trim().max(50_000),
  order: z.number().int().min(0).max(1_000),
});

const cleanItems = z.array(z.string().trim().min(1).max(160)).max(30);

export const candidateStructuredSchema = z.object({
  fullName: z.string().trim().max(200),
  descriptionItems: cleanItems,
  birthYear: z.string().trim().max(120),
  birthPlace: z.string().trim().max(300),
  currentLocation: z.string().trim().max(300),
  education: z.string().trim().max(2_000),
  activityField: z.string().trim().max(1_000),
  languages: cleanItems,
  sections: z.array(candidateSectionSchema).max(80),
  profilePhoto: z.string().trim().max(2_000),
  slug: z.string().trim().max(160),
  rawContent: z.string().max(200_000),
  formattedContent: z.string().max(200_000),
  unparsedContent: z.string().max(100_000),
});

export type CandidateStructuredData = z.infer<typeof candidateStructuredSchema>;
export type CandidateSection = z.infer<typeof candidateSectionSchema>;
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;

export const candidateEditorPayloadSchema = candidateStructuredSchema.extend({
  candidateId: z.string().uuid().nullable(),
}).superRefine((value, ctx) => {
  if (value.fullName.length < 3) {
    ctx.addIssue({
      code: "custom",
      path: ["fullName"],
      message: "Ism-familiya kamida 3 ta belgidan iborat bo‘lishi kerak",
    });
  }
});

export type CandidateEditorPayload = z.infer<typeof candidateEditorPayloadSchema>;

export const candidateKeyFactSchema = z.object({
  label: z.string().trim().max(120),
  value: z.string().trim().max(600),
});

export const candidateAiOutputSchema = z.object({
  fullName: z.string().trim().max(200),
  /** Badge row behind "&&&" — bounded further by normalizeShortBioItems(). */
  shortBioItems: cleanItems,
  birthYear: z.string().trim().max(120),
  birthPlace: z.string().trim().max(300),
  currentLocation: z.string().trim().max(300),
  education: z.string().trim().max(2_000),
  activityField: z.string().trim().max(1_000),
  languages: cleanItems,
  /** Facts card printed above the article; empty values are dropped, never "noma'lum". */
  keyFacts: z.array(candidateKeyFactSchema).max(40),
  introduction: z.string().trim().max(20_000),
  sections: z.array(z.object({
    title: z.string().trim().max(240),
    content: z.string().trim().max(50_000),
    order: z.number().int().min(0).max(1_000),
  })).max(80),
  conclusion: z.string().trim().max(20_000),
  quotes: z.array(z.string().trim().max(1_000)).max(40),
  usedFacts: z.array(z.string().trim().max(600)).max(400),
  unresolvedIssues: z.array(z.string().trim().max(600)).max(100),
});

export type CandidateAiOutput = z.infer<typeof candidateAiOutputSchema>;
export type CandidateKeyFact = z.infer<typeof candidateKeyFactSchema>;

export function emptyCandidateData(): CandidateStructuredData {
  return {
    fullName: "",
    descriptionItems: [],
    birthYear: "",
    birthPlace: "",
    currentLocation: "",
    education: "",
    activityField: "",
    languages: [],
    sections: [],
    profilePhoto: "",
    slug: "",
    rawContent: "",
    formattedContent: "",
    unparsedContent: "",
  };
}

