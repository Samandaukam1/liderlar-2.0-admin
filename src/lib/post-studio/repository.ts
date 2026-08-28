import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeShortBioItems, splitShortBioItems } from "@/lib/candidates/short-bio";
import { INTAKE_BUCKET } from "@/lib/intake/constants";
import {
  CANONICAL_POST_QUOTE_KEY,
  isCanonicalPostQuoteQuestion,
  preserveCanonicalPostQuote,
} from "@/lib/intake/canonical-quote";
import { buildCandidateArticleUrl } from "./site-origin.ts";
import { pickQuote, rankQuoteCandidates, type QuoteCandidate } from "./quote-source.ts";
import { splitNameIntoLines } from "./name-lines.ts";
import { DEFAULT_POST_TEMPLATE_ID, pickTemplateForCandidate } from "./layout-config.ts";
import {
  DEFAULT_PORTRAIT_TRANSFORM,
  isPostTemplateId,
  type FontSizeOverrides,
  type PortraitTransform,
  type PostQuoteSource,
  type PostStatus,
  type PostTemplateId,
} from "./types.ts";

/**
 * Data access for Post Studio. Every select lists its columns explicitly — the
 * candidate and article tables carry large text bodies that a `select *` would
 * drag into a list page for no reason.
 */

/* ------------------------------------------------------------------ *
 * Candidate source material
 * ------------------------------------------------------------------ */

export interface CandidateSourceData {
  id: string;
  fullName: string;
  slug: string;
  avatarUrl: string | null;
  shortBioItems: string[];
  quotes: QuoteCandidate[];
  article: { id: string; slug: string; status: string; publishedAt: string | null } | null;
  /**
   * Canonical published article URL, or null when the article is unpublished
   * OR the public site's origin has not been configured yet.
   */
  /** Public profile URL, present only once the candidate itself is published. */
  articleUrl: string | null;
  /** candidates.status — what actually decides whether the profile is live. */
  candidateStatus: string | null;
  /** False when public_web.base_url is unset — the admin must confirm a URL. */
  publicWebConfigured: boolean;
  portraitSourceUrl: string | null;
  canonicalQuote: CanonicalIntakeQuote | null;
}

export interface CanonicalIntakeQuote {
  intakeId: string;
  questionId: string;
  answerId: string | null;
  originalText: string;
  text: string;
}

export type CandidatePortraitSource =
  | {
      kind: "storage";
      bucket: string;
      path: string;
      sourceId: string;
      selection: "confirmed_original" | "confirmed_ai" | "primary_photo";
    }
  | {
      kind: "remote";
      url: string;
      sourceId: string;
      selection: "candidate_avatar";
    };

interface CandidateIntakeRef {
  id: string;
  templateId: string;
  selectedPhotoSource: string | null;
  selectedOriginalAttachmentId: string | null;
  selectedPhotoEditId: string | null;
}

async function resolveCandidateIntake(
  candidateId: string,
  sourceIntakeId?: string | null,
): Promise<CandidateIntakeRef | null> {
  const db = createSupabaseAdminClient();
  let query = db
    .from("candidate_intakes")
    .select(
      "id, template_id, selected_photo_source, selected_original_attachment_id, selected_photo_edit_id",
    );

  query = sourceIntakeId
    ? query.eq("id", sourceIntakeId)
    : query.eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(1);

  const { data } = await query.maybeSingle();
  if (!data?.id || !data.template_id) return null;
  return {
    id: data.id as string,
    templateId: data.template_id as string,
    selectedPhotoSource: (data.selected_photo_source as string | null) ?? null,
    selectedOriginalAttachmentId:
      (data.selected_original_attachment_id as string | null) ?? null,
    selectedPhotoEditId: (data.selected_photo_edit_id as string | null) ?? null,
  };
}

/** Resolves the answer by semantic key/id, never by array position. */
export async function loadCanonicalIntakeQuote(
  candidateId: string,
  sourceIntakeId?: string | null,
): Promise<CanonicalIntakeQuote | null> {
  const intake = await resolveCandidateIntake(candidateId, sourceIntakeId);
  if (!intake) return null;

  const db = createSupabaseAdminClient();
  let { data: question } = await db
    .from("candidate_intake_questions")
    .select("id, question_no, canonical_key, prompt")
    .eq("template_id", intake.templateId)
    .eq("canonical_key", CANONICAL_POST_QUOTE_KEY)
    .limit(1)
    .maybeSingle();

  // Compatibility for historical templates which have not yet been tagged.
  if (!question) {
    const { data: legacyQuestions } = await db
      .from("candidate_intake_questions")
      .select("id, question_no, canonical_key, prompt")
      .eq("template_id", intake.templateId)
      .order("question_no");
    question =
      legacyQuestions?.find((row) =>
        isCanonicalPostQuoteQuestion({
          canonical_key: row.canonical_key as string | null,
          prompt: row.prompt as string,
          question_no: row.question_no as number,
        }),
      ) ?? null;
  }
  if (!question) return null;

  const { data: answer } = await db
    .from("candidate_intake_answers")
    .select("id, answer_state, plain_text, final_text, editor_state")
    .eq("intake_id", intake.id)
    .eq("question_id", question.id)
    .maybeSingle();

  const originalText = preserveCanonicalPostQuote(answer?.plain_text as string | null);
  // Only an explicitly manual editor value may replace the raw wording. Old
  // generative ai_improved/final values are intentionally not trusted here.
  const manuallyEdited =
    answer?.editor_state === "manual"
      ? preserveCanonicalPostQuote(answer.final_text as string | null)
      : "";
  const text = answer?.answer_state === "answered" ? manuallyEdited || originalText : "";

  return {
    intakeId: intake.id,
    questionId: question.id as string,
    answerId: (answer?.id as string | null) ?? null,
    originalText,
    text,
  };
}

function isUsablePhotoAttachment(
  row: Record<string, unknown> | null | undefined,
): row is Record<string, unknown> & { id: string; bucket: string; path: string } {
  return Boolean(
    row?.id &&
      row.path &&
      row.status === "active" &&
      (row.kind === "photo" || row.kind === "image"),
  );
}

async function loadAttachmentById(
  attachmentId: string,
): Promise<Record<string, unknown> | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("candidate_intake_attachments")
    .select("id, bucket, path, kind, is_primary_photo, status, mime_type, answer_id")
    .eq("id", attachmentId)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * Selects the confirmed/primary intake portrait by explicit metadata. A random
 * first attachment is never used; the copied candidate avatar is legacy-only
 * fallback for profiles that predate intake attachments.
 */
export async function resolveCandidatePortraitSource(
  candidateId: string,
  options: { sourceIntakeId?: string | null; avatarUrl?: string | null } = {},
): Promise<CandidatePortraitSource | null> {
  const db = createSupabaseAdminClient();
  let sourceIntakeId = options.sourceIntakeId;
  let avatarUrl = options.avatarUrl;
  if (sourceIntakeId === undefined || avatarUrl === undefined) {
    const { data: candidate } = await db
      .from("candidates")
      .select("source_intake_id, avatar_url")
      .eq("id", candidateId)
      .maybeSingle();
    if (sourceIntakeId === undefined) {
      sourceIntakeId = (candidate?.source_intake_id as string | null) ?? null;
    }
    if (avatarUrl === undefined) avatarUrl = (candidate?.avatar_url as string | null) ?? null;
  }
  const intake = await resolveCandidateIntake(candidateId, sourceIntakeId);

  if (intake?.selectedPhotoSource === "ai" && intake.selectedPhotoEditId) {
    const { data: edit } = await db
      .from("candidate_intake_photo_edits")
      .select("id, status, result_bucket, result_path, processed_attachment_id")
      .eq("id", intake.selectedPhotoEditId)
      .maybeSingle();
    if (edit?.status === "completed") {
      const processedAttachmentId = edit.processed_attachment_id as string | null;
      const attachment = processedAttachmentId
        ? await loadAttachmentById(processedAttachmentId)
        : null;
      if (isUsablePhotoAttachment(attachment)) {
        return {
          kind: "storage",
          bucket: (attachment.bucket as string) || INTAKE_BUCKET,
          path: attachment.path as string,
          sourceId: attachment.id as string,
          selection: "confirmed_ai",
        };
      }
      if (edit.result_path) {
        return {
          kind: "storage",
          bucket: (edit.result_bucket as string | null) || INTAKE_BUCKET,
          path: edit.result_path as string,
          sourceId: edit.id as string,
          selection: "confirmed_ai",
        };
      }
    }
  }

  if (intake?.selectedOriginalAttachmentId) {
    const attachment = await loadAttachmentById(intake.selectedOriginalAttachmentId);
    if (isUsablePhotoAttachment(attachment)) {
      return {
        kind: "storage",
        bucket: (attachment.bucket as string) || INTAKE_BUCKET,
        path: attachment.path as string,
        sourceId: attachment.id as string,
        selection: "confirmed_original",
      };
    }
  }

  if (intake) {
    const { data: primary } = await db
      .from("candidate_intake_attachments")
      .select("id, bucket, path, kind, is_primary_photo, status, mime_type, answer_id")
      .eq("intake_id", intake.id)
      .eq("is_primary_photo", true)
      .eq("status", "active")
      .in("kind", ["photo", "image"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (isUsablePhotoAttachment(primary as Record<string, unknown> | null)) {
      return {
        kind: "storage",
        bucket: (primary!.bucket as string) || INTAKE_BUCKET,
        path: primary!.path as string,
        sourceId: primary!.id as string,
        selection: "primary_photo",
      };
    }
  }

  if (avatarUrl?.trim()) {
    return {
      kind: "remote",
      url: avatarUrl.trim(),
      sourceId: candidateId,
      selection: "candidate_avatar",
    };
  }
  return null;
}

/** A token-free locator safe to persist/log; private files are still downloaded server-side. */
export function portraitSourceReference(source: CandidatePortraitSource | null): string | null {
  if (!source) return null;
  return source.kind === "remote"
    ? source.url
    : `supabase-storage://${encodeURIComponent(source.bucket)}/${encodeURIComponent(source.path)}`;
}

export async function downloadCandidatePortraitSource(
  source: CandidatePortraitSource,
): Promise<Buffer> {
  if (source.kind === "remote") {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`remote portrait download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db.storage.from(source.bucket).download(source.path);
  if (error || !data) throw new Error(`private portrait download failed: ${error?.message ?? "empty"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function loadCandidateSourceData(
  candidateId: string,
): Promise<CandidateSourceData | null> {
  const db = createSupabaseAdminClient();

  // Candidate and article are independent reads — run them together. Quote and
  // portrait need the candidate's source_intake_id, so they follow below.
  const [{ data: candidate }, { data: articleRows }] = await Promise.all([
    db
      .from("candidates")
      .select(
        "id, full_name, slug, status, avatar_url, description_items, short_bio, source_intake_id, deleted_at",
      )
      .eq("id", candidateId)
      .maybeSingle(),
    db
      .from("articles")
      .select("id, slug, status, published_at")
      .eq("candidate_id", candidateId)
      .is("deleted_at", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1),
  ]);

  if (!candidate || candidate.deleted_at) return null;

  const article = articleRows?.[0] ?? null;

  /**
   * The link the caption carries is `/liderlar/{slug}` — the candidate's own
   * profile page. On the public site that page is gated on
   * `candidates.status = 'published'`; the `articles` row is only one optional
   * section inside it. Gating this on the article's status instead was wrong in
   * both directions: a candidate whose profile was live on the site was
   * reported as "maqola hali nashr qilinmagan" and held out of Telegram,
   * because their article row happened to still be a draft.
   */
  const candidateStatus = (candidate.status as string | null) ?? null;
  const articleUrl =
    candidateStatus === "published"
      ? await buildCandidateArticleUrl(candidate.slug as string)
      : null;

  const sourceIntakeId = (candidate.source_intake_id as string | null) ?? null;
  const [canonicalQuote, portraitSource, publicWebConfigured] = await Promise.all([
    loadCanonicalIntakeQuote(candidate.id as string, sourceIntakeId),
    resolveCandidatePortraitSource(candidate.id as string, {
      sourceIntakeId,
      avatarUrl: (candidate.avatar_url as string | null) ?? null,
    }),
    buildCandidateArticleUrl("probe").then((url) => url !== null),
  ]);

  const quotes: QuoteCandidate[] = canonicalQuote?.text
    ? [
        {
          id: canonicalQuote.answerId,
          text: canonicalQuote.text,
          source: "intake_quote" as PostQuoteSource,
        },
      ]
    : [];

  const rawItems = Array.isArray(candidate.description_items)
    ? (candidate.description_items as string[])
    : splitShortBioItems(candidate.short_bio as string | null);

  return {
    id: candidate.id as string,
    fullName: (candidate.full_name as string) ?? "",
    slug: (candidate.slug as string) ?? "",
    avatarUrl: (candidate.avatar_url as string | null) ?? null,
    shortBioItems: normalizeShortBioItems(rawItems).items,
    quotes: rankQuoteCandidates(quotes),
    article: article
      ? {
          id: article.id as string,
          slug: article.slug as string,
          status: article.status as string,
          publishedAt: (article.published_at as string | null) ?? null,
        }
      : null,
    articleUrl,
    candidateStatus,
    publicWebConfigured,
    portraitSourceUrl: portraitSourceReference(portraitSource),
    canonicalQuote,
  };
}

/* ------------------------------------------------------------------ *
 * Posts
 * ------------------------------------------------------------------ */

/** Columns the list page needs — deliberately excludes nothing large. */
const LIST_COLUMNS =
  "id, candidate_id, article_id, template_id, status, rendered_thumbnail_url, " +
  "telegram_last_sent_at, telegram_sent_count, telegram_failed_count, " +
  "rendered_at, scheduled_at, published_at, created_at, updated_at";

const DETAIL_COLUMNS = `${LIST_COLUMNS}, quote, quote_source, name_lines, short_bio_items, ` +
  "portrait_source_url, portrait_processed_url, portrait_transform, font_size_overrides, " +
  "rendered_image_url, telegram_caption, article_url, error, metadata";

export interface PostRecord {
  id: string;
  candidateId: string;
  articleId: string | null;
  /** Admin-confirmed canonical article URL; overrides the derived one. */
  articleUrl: string | null;
  templateId: PostTemplateId;
  status: PostStatus;
  quote: string;
  quoteSource: PostQuoteSource | null;
  nameLines: string[];
  shortBioItems: string[];
  portraitSourceUrl: string | null;
  portraitProcessedUrl: string | null;
  portraitTransform: PortraitTransform;
  fontSizeOverrides: FontSizeOverrides;
  renderedImageUrl: string | null;
  renderedThumbnailUrl: string | null;
  renderedAt: string | null;
  telegramCaption: string | null;
  telegramLastSentAt: string | null;
  telegramSentCount: number;
  telegramFailedCount: number;
  scheduledAt: string | null;
  publishedAt: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

export function mapPostRow(row: Row): PostRecord {
  const transform = (row.portrait_transform ?? {}) as Partial<PortraitTransform>;
  return {
    id: row.id as string,
    candidateId: row.candidate_id as string,
    articleId: (row.article_id as string | null) ?? null,
    articleUrl: (row.article_url as string | null) ?? null,
    templateId: isPostTemplateId(row.template_id) ? row.template_id : DEFAULT_POST_TEMPLATE_ID,
    status: (row.status as PostStatus) ?? "draft",
    quote: (row.quote as string) ?? "",
    quoteSource: (row.quote_source as PostQuoteSource | null) ?? null,
    nameLines: asStringArray(row.name_lines),
    shortBioItems: asStringArray(row.short_bio_items),
    portraitSourceUrl: (row.portrait_source_url as string | null) ?? null,
    portraitProcessedUrl: (row.portrait_processed_url as string | null) ?? null,
    portraitTransform: { ...DEFAULT_PORTRAIT_TRANSFORM, ...transform },
    fontSizeOverrides: (row.font_size_overrides as FontSizeOverrides) ?? {},
    renderedImageUrl: (row.rendered_image_url as string | null) ?? null,
    renderedThumbnailUrl: (row.rendered_thumbnail_url as string | null) ?? null,
    renderedAt: (row.rendered_at as string | null) ?? null,
    telegramCaption: (row.telegram_caption as string | null) ?? null,
    telegramLastSentAt: (row.telegram_last_sent_at as string | null) ?? null,
    telegramSentCount: (row.telegram_sent_count as number) ?? 0,
    telegramFailedCount: (row.telegram_failed_count as number) ?? 0,
    scheduledAt: (row.scheduled_at as string | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getPost(postId: string): Promise<PostRecord | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("candidate_social_posts")
    .select(DETAIL_COLUMNS)
    .eq("id", postId)
    .maybeSingle();
  return data ? mapPostRow(data as unknown as Row) : null;
}

export async function getPostByCandidate(candidateId: string): Promise<PostRecord | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("candidate_social_posts")
    .select(DETAIL_COLUMNS)
    .eq("candidate_id", candidateId)
    .neq("status", "failed")
    .maybeSingle();
  return data ? mapPostRow(data as unknown as Row) : null;
}

export interface PostListItem extends Pick<
  PostRecord,
  | "id"
  | "candidateId"
  | "articleId"
  | "templateId"
  | "status"
  | "renderedThumbnailUrl"
  | "renderedAt"
  | "scheduledAt"
  | "publishedAt"
  | "createdAt"
  | "telegramLastSentAt"
  | "telegramSentCount"
  | "telegramFailedCount"
> {
  candidateName: string;
  candidateSlug: string;
  candidateAvatarUrl: string | null;
  articleTitle: string | null;
}

export interface PostListResult {
  items: PostListItem[];
  total: number;
}

/**
 * Paginated list. Only the 320px thumbnail is selected — pulling
 * `rendered_image_url` here would put 24 full 1080x1080 PNGs on one page.
 */
export async function listPosts(options: {
  page: number;
  pageSize: number;
  status?: PostStatus | null;
  search?: string | null;
}): Promise<PostListResult> {
  const db = createSupabaseAdminClient();
  const from = (options.page - 1) * options.pageSize;

  let query = db
    .from("candidate_social_posts")
    .select(
      `${LIST_COLUMNS}, candidates!inner(full_name, slug, avatar_url), articles(title)`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + options.pageSize - 1);

  if (options.status) query = query.eq("status", options.status);
  if (options.search?.trim()) {
    query = query.ilike("candidates.full_name", `%${options.search.trim()}%`);
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`Postlar ro‘yxatini olishda xatolik: ${error.message}`);

  const items = (data ?? []).map((row) => {
    const record = mapPostRow(row as Row);
    const candidate = (row as Row).candidates as Row | null;
    const article = (row as Row).articles as Row | null;
    return {
      ...record,
      candidateName: (candidate?.full_name as string) ?? "",
      candidateSlug: (candidate?.slug as string) ?? "",
      candidateAvatarUrl: (candidate?.avatar_url as string | null) ?? null,
      articleTitle: (article?.title as string | null) ?? null,
    } as PostListItem;
  });

  return { items, total: count ?? 0 };
}

export interface CreatePostInput {
  candidateId: string;
  createdBy?: string | null;
  templateId?: PostTemplateId;
}

/**
 * Refreshes automatic source fields before every render/caption generation.
 * Manual quote overrides are respected; every other legacy quote source is
 * replaced with the canonical intake answer (or cleared for human review).
 */
export async function synchronizePostSourceData(post: PostRecord): Promise<PostRecord> {
  const source = await loadCandidateSourceData(post.candidateId);
  if (!source) return post;

  const patch: Row = {};
  const sourceReference = source.portraitSourceUrl;
  if (sourceReference !== post.portraitSourceUrl) {
    patch.portrait_source_url = sourceReference;
  }

  if (post.quoteSource !== "manual") {
    const canonical = source.canonicalQuote;
    patch.quote = canonical?.text ?? "";
    patch.quote_source = canonical?.text ? "intake_quote" : "none";
    patch.metadata = {
      ...post.metadata,
      quote_provenance: canonical
        ? {
            canonical_key: CANONICAL_POST_QUOTE_KEY,
            intake_id: canonical.intakeId,
            question_id: canonical.questionId,
            answer_id: canonical.answerId,
            original_preserved: canonical.originalText === canonical.text,
          }
        : {
            canonical_key: CANONICAL_POST_QUOTE_KEY,
            missing: true,
          },
    };
    if (!canonical?.text) {
      patch.status = "needs_review";
      patch.error = "15-savol iqtibosi bo‘sh. Iqtibosni qo‘lda kiriting.";
    }
  }

  const changed =
    Object.keys(patch).length > 0 &&
    (patch.portrait_source_url !== post.portraitSourceUrl ||
      patch.quote !== post.quote ||
      patch.quote_source !== post.quoteSource ||
      patch.status !== undefined ||
      patch.metadata !== undefined);
  return changed ? updatePost(post.id, patch) : post;
}

/**
 * Creates the draft for a candidate, seeding it from approved content only —
 * quote by priority, name split into design lines, short bio as already
 * normalized. Returns the existing post if one is already there.
 */
export async function createPostDraft(input: CreatePostInput): Promise<PostRecord> {
  const existing = await getPostByCandidate(input.candidateId);
  if (existing) return synchronizePostSourceData(existing);

  const source = await loadCandidateSourceData(input.candidateId);
  if (!source) throw new Error("Nomzod topilmadi.");

  const quote = pickQuote(source.quotes);
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("candidate_social_posts")
    .insert({
      candidate_id: input.candidateId,
      article_id: source.article?.id ?? null,
      template_id: input.templateId ?? pickTemplateForCandidate(input.candidateId),
      quote: quote?.text ?? "",
      quote_source: quote?.source ?? "none",
      name_lines: splitNameIntoLines(source.fullName),
      short_bio_items: source.shortBioItems,
      portrait_source_url: source.portraitSourceUrl,
      status: quote ? "draft" : "needs_review",
      error: quote ? null : "15-savol iqtibosi bo‘sh. Iqtibosni qo‘lda kiriting.",
      metadata: {
        quote_provenance: source.canonicalQuote
          ? {
              canonical_key: CANONICAL_POST_QUOTE_KEY,
              intake_id: source.canonicalQuote.intakeId,
              question_id: source.canonicalQuote.questionId,
              answer_id: source.canonicalQuote.answerId,
              original_preserved:
                source.canonicalQuote.originalText === source.canonicalQuote.text,
            }
          : { canonical_key: CANONICAL_POST_QUOTE_KEY, missing: true },
      },
      created_by: input.createdBy ?? null,
    })
    .select(DETAIL_COLUMNS)
    .single();

  if (error) throw new Error(`Post yaratilmadi: ${error.message}`);
  return mapPostRow(data as unknown as Row);
}

export async function updatePost(postId: string, patch: Row): Promise<PostRecord> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("candidate_social_posts")
    .update(patch)
    .eq("id", postId)
    .select(DETAIL_COLUMNS)
    .single();

  if (error) throw new Error(`Postni saqlashda xatolik: ${error.message}`);
  return mapPostRow(data as unknown as Row);
}
