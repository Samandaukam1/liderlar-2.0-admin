import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/site-url";
import { normalizeShortBioItems, splitShortBioItems } from "@/lib/candidates/short-bio";
import { signIntakeFileUrl } from "@/lib/intake/data";
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
  /** Candidate's canonical published article URL, or null when unpublished. */
  articleUrl: string | null;
  portraitSourceUrl: string | null;
}

/**
 * Portrait source priority, per the brief:
 *   final candidate photo -> selected AI photo -> selected original intake photo.
 * The original is never overwritten; this only decides what to feed the
 * background remover.
 */
async function resolvePortraitSource(
  candidateId: string,
  avatarUrl: string | null,
): Promise<string | null> {
  if (avatarUrl?.trim()) return avatarUrl.trim();

  const db = createSupabaseAdminClient();
  const { data: intake } = await db
    .from("candidate_intakes")
    .select("id, selected_photo_source, selected_photo_edit_id, selected_original_attachment_id")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!intake) return null;

  if (intake.selected_photo_edit_id) {
    const { data: edit } = await db
      .from("candidate_intake_photo_edits")
      .select("result_path")
      .eq("id", intake.selected_photo_edit_id)
      .maybeSingle();
    if (edit?.result_path) return signIntakeFileUrl(edit.result_path as string);
  }

  if (intake.selected_original_attachment_id) {
    const { data: attachment } = await db
      .from("candidate_intake_attachments")
      .select("storage_path")
      .eq("id", intake.selected_original_attachment_id)
      .maybeSingle();
    if (attachment?.storage_path) return signIntakeFileUrl(attachment.storage_path as string);
  }

  return null;
}

export async function loadCandidateSourceData(
  candidateId: string,
): Promise<CandidateSourceData | null> {
  const db = createSupabaseAdminClient();

  // Candidate, quotes and article are independent reads — run them together.
  const [{ data: candidate }, { data: quoteRows }, { data: articleRows }] = await Promise.all([
    db
      .from("candidates")
      .select("id, full_name, slug, avatar_url, description_items, short_bio, deleted_at")
      .eq("id", candidateId)
      .maybeSingle(),
    db
      .from("quotes")
      .select("id, text, is_featured, status")
      .eq("candidate_id", candidateId)
      .order("is_featured", { ascending: false })
      .limit(20),
    db
      .from("articles")
      .select("id, slug, status, published_at, excerpt")
      .eq("candidate_id", candidateId)
      .is("deleted_at", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1),
  ]);

  if (!candidate || candidate.deleted_at) return null;

  const article = articleRows?.[0] ?? null;
  const siteUrl = getSiteUrl();

  const quotes: QuoteCandidate[] = (quoteRows ?? []).map((row) => ({
    id: row.id as string,
    text: (row.text as string) ?? "",
    source: (row.is_featured ? "featured_quote" : "life_motto") as PostQuoteSource,
  }));

  // An excerpt approved on the published article is the second-priority quote.
  if (article?.excerpt) {
    quotes.push({ id: null, text: article.excerpt as string, source: "article_quote" });
  }

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
    articleUrl:
      article?.status === "published"
        ? `${siteUrl}/liderlar/${candidate.slug as string}`
        : null,
    portraitSourceUrl: await resolvePortraitSource(
      candidate.id as string,
      (candidate.avatar_url as string | null) ?? null,
    ),
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
  "rendered_image_url, telegram_caption, error, metadata";

export interface PostRecord {
  id: string;
  candidateId: string;
  articleId: string | null;
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
 * Creates the draft for a candidate, seeding it from approved content only —
 * quote by priority, name split into design lines, short bio as already
 * normalized. Returns the existing post if one is already there.
 */
export async function createPostDraft(input: CreatePostInput): Promise<PostRecord> {
  const existing = await getPostByCandidate(input.candidateId);
  if (existing) return existing;

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
      status: "draft",
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
