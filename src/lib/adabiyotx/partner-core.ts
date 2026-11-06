import { z } from "zod";
import {
  normalizeAdabiyotXUrl,
  normalizeSafeCoverUrl,
} from "./core.ts";

/**
 * AdabiyotX ↔ Liderlar hisob bog'lash — SOF MODUL (I/O yo'q).
 *
 * Shartnoma ikki tomonlama:
 *   · AdabiyotX serveri → liderlar-admin: `/api/public/adabiyotx/*`
 *     (kalit `x-liderlar-api-key` = LIDERLAR_PUBLIC_CONTENT_API_KEY).
 *   · liderlar-admin → AdabiyotX serveri: `/api/partners/liderlar/*`
 *     (kalit `x-adabiyotx-api-key` = ADABIYOTX_INTEGRATION_API_KEY).
 *
 * Bu faylda faqat so'rov shakllari, tekshiruvlar va hisob-kitob turadi,
 * shuning uchun testlar uni to'g'ridan-to'g'ri import qiladi.
 */

export const ADABIYOTX_PUBLIC_ORIGIN = "https://adabiyotx.uz";

/** Testdagi savollar soni — har to'g'ri javob 1 ball. */
export const QUIZ_MAX_SCORE = 10;

/** Qo'lda kiritiladigan kod: 8 belgi, chalkash harflarsiz (0/O, 1/I yo'q). */
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;

export function normalizeLinkCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    // 0 va 1 alifboda yo'q — ular O/I o'rniga yozilgan bo'lsa qaytaramiz.
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .slice(0, LINK_CODE_LENGTH);
}

export function isValidLinkCode(value: string): boolean {
  const code = normalizeLinkCode(value);
  return code.length === LINK_CODE_LENGTH && [...code].every((ch) => LINK_CODE_ALPHABET.includes(ch));
}

const uuid = z.string().uuid();
const shortText = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const adabiyotXUserSchema = z
  .object({
    id: uuid,
    username: optionalText(60),
    full_name: optionalText(200),
    avatar_url: optionalText(2000),
  })
  .strict();

export type AdabiyotXUser = z.infer<typeof adabiyotXUserSchema>;

export const linkRequestSchema = z
  .object({
    token: z.string().trim().min(8).max(200).optional(),
    code: z.string().trim().min(4).max(20).optional(),
    adabiyotx_user: adabiyotXUserSchema,
  })
  .strict()
  .refine((value) => value.token || value.code, "token yoki code kerak");

export const unlinkRequestSchema = z
  .object({ adabiyotx_user_id: uuid })
  .strict();

export const unlinkByUserSchema = z
  .object({ liderlar_user_id: uuid })
  .strict();

export const bookSchema = z
  .object({
    id: uuid,
    title: shortText(500).min(1),
    author_name: optionalText(300),
    cover_url: optionalText(2000),
    published_at: optionalText(80),
  })
  .strict();

export type PartnerBook = z.infer<typeof bookSchema>;

export const bookReadSchema = z
  .object({
    adabiyotx_user_id: uuid,
    book: bookSchema,
    score: z.number().int().min(0).max(QUIZ_MAX_SCORE),
    max_score: z.number().int().min(1).max(QUIZ_MAX_SCORE).default(QUIZ_MAX_SCORE),
    completed_at: z.string().trim().max(80),
  })
  .strict();

export type BookReadRequest = z.infer<typeof bookReadSchema>;

export const worksSchema = z
  .object({
    adabiyotx_user_id: uuid,
    works: z.array(bookSchema).max(500),
  })
  .strict();

/** AdabiyotX kutubxonasi: `/api/partners/liderlar/users/{id}/library` javobi. */
export const librarySchema = z
  .object({
    works: z.array(bookSchema).max(500).default([]),
    reads: z
      .array(
        z
          .object({
            book: bookSchema,
            score: z.number().int().min(0).max(QUIZ_MAX_SCORE),
            max_score: z.number().int().min(1).max(QUIZ_MAX_SCORE).default(QUIZ_MAX_SCORE),
            completed_at: z.string().trim().max(80),
          })
          .strict(),
      )
      .max(2000)
      .default([]),
  })
  .passthrough();

/** AdabiyotX kitobining ommaviy sahifasi — ilova universal link orqali ochadi. */
export function adabiyotXBookUrl(bookId: string): string {
  return `${ADABIYOTX_PUBLIC_ORIGIN}/book/${bookId}`;
}

export function toIsoOrNow(value: string | null | undefined, now = new Date()): string {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? now.toISOString() : new Date(parsed).toISOString();
}

/** Reytingga qo'shiladigan ball: har to'g'ri javob = 1 (score o'zi). */
export function pointsForScore(score: number, maxScore = QUIZ_MAX_SCORE): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(maxScore, Math.round(score)));
}

export interface CandidateItemUpsert {
  candidate_id: string;
  external_id: string;
  relationship_type: "own_work" | "read_book";
  content_type: "book";
  title: string;
  author_name: string | null;
  description: string | null;
  cover_url: string | null;
  external_url: string;
  published_at: string | null;
  is_visible: boolean;
  metadata: Record<string, unknown>;
}

/** Testdan o'tgan kitob → biografiyadagi "O'qigan kitoblari" qatori. */
export function readBookItem(
  candidateId: string,
  read: { book: PartnerBook; score: number; max_score: number; completed_at: string },
): CandidateItemUpsert {
  return {
    candidate_id: candidateId,
    external_id: read.book.id,
    relationship_type: "read_book",
    content_type: "book",
    title: read.book.title.slice(0, 500),
    author_name: read.book.author_name?.slice(0, 300) ?? null,
    description: null,
    cover_url: normalizeSafeCoverUrl(read.book.cover_url),
    external_url: normalizeAdabiyotXUrl(adabiyotXBookUrl(read.book.id)) ?? adabiyotXBookUrl(read.book.id),
    published_at: read.book.published_at ? toIsoOrNow(read.book.published_at) : null,
    is_visible: true,
    metadata: {
      source: "adabiyotx_quiz",
      quizScore: pointsForScore(read.score, read.max_score),
      quizMax: read.max_score,
      completedAt: toIsoOrNow(read.completed_at),
    },
  };
}

/** AdabiyotX'da muallif sifatida biriktirilgan kitob → "Ijodiy ishlari". */
export function ownWorkItem(candidateId: string, book: PartnerBook): CandidateItemUpsert {
  return {
    candidate_id: candidateId,
    external_id: book.id,
    relationship_type: "own_work",
    content_type: "book",
    title: book.title.slice(0, 500),
    author_name: book.author_name?.slice(0, 300) ?? null,
    description: null,
    cover_url: normalizeSafeCoverUrl(book.cover_url),
    external_url: normalizeAdabiyotXUrl(adabiyotXBookUrl(book.id)) ?? adabiyotXBookUrl(book.id),
    published_at: book.published_at ? toIsoOrNow(book.published_at) : null,
    is_visible: true,
    metadata: { source: "adabiyotx_sync" },
  };
}

export interface PartnerConfig {
  baseUrl: string;
  apiKey: string;
}

/** AdabiyotX partner API manzili (adabiyotx-admin) va kalit. */
export function resolvePartnerConfig(env: Record<string, string | undefined>): PartnerConfig | null {
  const baseUrl = env.ADABIYOTX_PARTNER_API_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.ADABIYOTX_INTEGRATION_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { baseUrl: url.origin + url.pathname.replace(/\/+$/, ""), apiKey };
  } catch {
    return null;
  }
}
