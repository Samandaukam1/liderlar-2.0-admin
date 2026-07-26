import { z } from "zod";
import {
  ADABIYOTX_CONTENT_TYPES,
  CANDIDATE_ADABIYOTX_RELATIONSHIPS,
} from "./types";
import {
  hasUniqueAdabiyotXReorderIds,
  isAdabiyotXRelationshipContentValid,
  normalizeAdabiyotXUrl,
  normalizeSafeCoverUrl,
} from "./core";

const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const publishedAtSchema = z
  .string()
  .trim()
  .max(80)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Noto‘g‘ri sana")
  .nullable()
  .optional();

const itemFields = {
  relationshipType: z.enum(CANDIDATE_ADABIYOTX_RELATIONSHIPS),
  contentType: z.enum(ADABIYOTX_CONTENT_TYPES),
  title: z.string().trim().min(1, "Sarlavha majburiy").max(500),
  authorName: nullableText(300),
  description: nullableText(5000),
  coverUrl: nullableText(2000).refine(
    (value) => value == null || value === "" || normalizeSafeCoverUrl(value) != null,
    "Cover URL xavfsiz HTTPS manzil bo‘lishi kerak",
  ),
  externalUrl: z
    .string()
    .trim()
    .max(2000)
    .refine(
      (value) => normalizeAdabiyotXUrl(value) != null,
      "Faqat xavfsiz AdabiyotX HTTPS havolasi qabul qilinadi",
    ),
  publishedAt: publishedAtSchema,
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  isVisible: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

function enforceRelationship(
  value: { relationshipType?: string; contentType?: string },
  context: z.RefinementCtx,
) {
  if (
    value.relationshipType !== undefined &&
    value.contentType !== undefined &&
    !isAdabiyotXRelationshipContentValid(
      value.relationshipType,
      value.contentType,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["contentType"],
      message: "O‘qigan kitoblari uchun material turi faqat kitob bo‘lishi mumkin",
    });
  }
}

export const candidateAdabiyotXCreateSchema = z
  .object({
    externalId: z.string().trim().min(1).max(500).optional(),
    ...itemFields,
  })
  .strict()
  .superRefine(enforceRelationship);

export const candidateAdabiyotXPatchSchema = z
  .object({
    relationshipType: itemFields.relationshipType.optional(),
    contentType: itemFields.contentType.optional(),
    title: itemFields.title.optional(),
    authorName: itemFields.authorName,
    description: itemFields.description,
    coverUrl: itemFields.coverUrl,
    externalUrl: itemFields.externalUrl.optional(),
    publishedAt: itemFields.publishedAt,
    sortOrder: itemFields.sortOrder,
    isVisible: itemFields.isVisible,
    metadata: itemFields.metadata,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Kamida bitta maydon kerak")
  .superRefine(enforceRelationship);

export const candidateAdabiyotXReorderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            sortOrder: z.number().int().min(0).max(1_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasUniqueAdabiyotXReorderIds(value.items)) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Takrorlangan material ID",
      });
    }
  });

export const uuidSchema = z.string().uuid();

export function toDatabaseTimestamp(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}
