import "server-only";
import { logAudit } from "@/lib/audit";
import { buildPostLayout } from "./compose.ts";
import { renderPostImage, toDataUri } from "./render.ts";
import {
  enhancePortraitColor,
  portraitSourceFingerprint,
  PortraitProcessingError,
  removePortraitBackground,
} from "./portrait.ts";
import { SEGMENTATION_MODEL_LABEL } from "./segmentation.ts";
import type { PersonBounds } from "./portrait-fit.ts";
import { downloadPostAsset, postAssetExists, uploadPostAsset } from "./storage.ts";
import {
  downloadCandidatePortraitSource,
  getPost,
  loadCandidateSourceData,
  portraitSourceReference,
  resolveCandidatePortraitSource,
  synchronizePostSourceData,
  updatePost,
  type PostRecord,
} from "./repository.ts";
import { buildTelegramCaption, getTelegramSettings } from "./telegram.ts";
import { originOfConfirmedUrl } from "./public-web-url.ts";
import type { PostLayout, PostWarning } from "./types.ts";

/**
 * Orchestration for Post Studio: portrait preparation, render + store, caption
 * assembly and status transitions.
 *
 * The rule that governs every path here is that nothing auto-publishes when the
 * result would be wrong. A failed cut-out, an un-fittable quote or name, or an
 * unpublished article all land the post in `needs_review` with the reason
 * recorded, rather than being quietly shipped to every subscriber.
 */

export interface PreparePortraitResult {
  processedUrl: string | null;
  warning: PostWarning | null;
  /** True when the stored cut-out was still valid and nothing was re-segmented. */
  reused?: boolean;
}

export const PORTRAIT_REMOVAL_FAILED_MESSAGE =
  "Portret fonini olib tashlash amalga oshmadi";

function postStudioLog(message: string, details: Record<string, unknown>): void {
  // Details contain only internal ids, dimensions and model labels. Storage
  // paths, signed URLs, tokens and API keys are intentionally excluded.
  console.info(`[post-studio] ${message}`, details);
}

/** Whatever we recorded about the last successful cut-out for this post. */
function storedPortraitMetadata(post: PostRecord): Record<string, unknown> {
  const portrait = post.metadata?.portrait;
  return portrait && typeof portrait === "object" ? (portrait as Record<string, unknown>) : {};
}

/**
 * The person's box inside the stored cut-out, recorded when it was processed.
 * Null for assets made before bounds were kept; the layout then falls back to
 * the whole frame, which is exactly the old behaviour for those legacy posts.
 */
function storedPersonBounds(post: PostRecord): PersonBounds | null {
  const raw = storedPortraitMetadata(post).personBounds as Partial<PersonBounds> | undefined;
  if (!raw) return null;
  const numbers = [raw.left, raw.top, raw.width, raw.height, raw.imageWidth, raw.imageHeight];
  if (numbers.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  if (!raw.width || !raw.height) return null;
  return raw as PersonBounds;
}

/**
 * Produces the transparent cut-out and stores it beside the candidate. The
 * source photo is only read, never replaced.
 *
 * Segmentation is by far the most expensive step in the studio, so it is
 * content-addressed: the source photo is hashed, and a stored cut-out whose
 * recorded fingerprint still matches is reused as-is. Opening a preview
 * therefore never re-runs the model, while a candidate replacing their photo
 * changes the hash and forces a fresh matte. `force` is the admin's "Portretni
 * qayta ishlash" button, which bypasses the cache deliberately.
 */
export async function preparePortrait(
  post: PostRecord,
  options: { force?: boolean } = {},
): Promise<PreparePortraitResult> {
  const source = await resolveCandidatePortraitSource(post.candidateId);
  if (!source) {
    await updatePost(post.id, {
      status: "needs_review",
      error: "Nomzod uchun manba rasm topilmadi.",
    });
    return {
      processedUrl: null,
      warning: { code: "portrait_missing", message: "Nomzod uchun manba rasm topilmadi." },
    };
  }

  postStudioLog("source portrait found", {
    postId: post.id,
    candidateId: post.candidateId,
    selection: source.selection,
    sourceKind: source.kind,
  });

  try {
    const sourceBuffer = await downloadCandidatePortraitSource(source);
    const fingerprint = portraitSourceFingerprint(sourceBuffer);
    postStudioLog("portrait downloaded", {
      postId: post.id,
      candidateId: post.candidateId,
      sourceKind: source.kind,
      bytes: sourceBuffer.byteLength,
    });

    const previous = storedPortraitMetadata(post);
    if (
      !options.force &&
      post.portraitProcessedUrl &&
      previous.sourceFingerprint === fingerprint &&
      (await postAssetExists(post.candidateId, "portrait-transparent"))
    ) {
      postStudioLog("background removed", {
        postId: post.id,
        candidateId: post.candidateId,
        model: SEGMENTATION_MODEL_LABEL,
        cached: true,
      });
      return { processedUrl: post.portraitProcessedUrl, warning: null, reused: true };
    }

    const startedAt = Date.now();
    const cutout = await removePortraitBackground(sourceBuffer);
    const segmentationMs = Date.now() - startedAt;
    postStudioLog("background removed", {
      postId: post.id,
      candidateId: post.candidateId,
      model: SEGMENTATION_MODEL_LABEL,
      cached: false,
      coverage: Number(cutout.coverage.toFixed(4)),
      confidence: Number(cutout.confidence.toFixed(4)),
      ms: segmentationMs,
    });

    postStudioLog("segmentation complete", {
      postId: post.id,
      candidateId: post.candidateId,
      confidence: Number(cutout.confidence.toFixed(4)),
    });
    postStudioLog("matte refined", {
      postId: post.id,
      candidateId: post.candidateId,
      decisiveShare: Number(cutout.decisiveShare.toFixed(4)),
    });
    postStudioLog("detached artifacts removed", {
      postId: post.id,
      candidateId: post.candidateId,
      count: cutout.cleanup.removed.length,
      largestArea: cutout.cleanup.removed[0]?.area ?? 0,
      removedShare: Number(cutout.cleanup.removedShare.toFixed(4)),
    });
    postStudioLog("alpha validated", {
      postId: post.id,
      candidateId: post.candidateId,
      coverage: Number(cutout.coverage.toFixed(4)),
    });
    postStudioLog("alpha bounds calculated", {
      postId: post.id,
      candidateId: post.candidateId,
      person: cutout.personBounds,
    });

    const enhanced = await enhancePortraitColor(cutout.buffer);
    postStudioLog("saturation applied", {
      postId: post.id,
      candidateId: post.candidateId,
      saturation: enhanced.saturation,
      alphaPreserved: enhanced.alphaCoverageBefore === enhanced.alphaCoverageAfter,
    });

    const processedUrl = await uploadPostAsset(
      post.candidateId,
      "portrait-transparent",
      enhanced.buffer,
    );
    postStudioLog("portrait stored", {
      postId: post.id,
      candidateId: post.candidateId,
      width: enhanced.width,
      height: enhanced.height,
    });

    await updatePost(post.id, {
      portrait_source_url: portraitSourceReference(source),
      portrait_processed_url: processedUrl,
      error: null,
      metadata: {
        ...post.metadata,
        portrait: {
          model: SEGMENTATION_MODEL_LABEL,
          sourceFingerprint: fingerprint,
          coverage: Number(cutout.coverage.toFixed(4)),
          confidence: Number(cutout.confidence.toFixed(4)),
          decisiveShare: Number(cutout.decisiveShare.toFixed(4)),
          personBounds: cutout.personBounds,
          cleanup: {
            removed: cutout.cleanup.removed.length,
            removedShare: Number(cutout.cleanup.removedShare.toFixed(4)),
            largestRemovedArea: cutout.cleanup.removed[0]?.area ?? 0,
            bridgeRadius: cutout.cleanup.bridgeRadius,
          },
          width: enhanced.width,
          height: enhanced.height,
          saturation: enhanced.saturation,
          alphaPreserved: enhanced.alphaCoverageBefore === enhanced.alphaCoverageAfter,
          segmentationMs,
          processedAt: new Date().toISOString(),
        },
      },
    });

    return { processedUrl, warning: null, reused: false };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof PortraitProcessingError && err.code === "low_quality"
        ? ("portrait_low_quality" as const)
        : ("portrait_removal_failed" as const);

    // A deployment with no model on disk is an infrastructure fault, not a bad
    // photograph. Collapsing it into the generic message sent us hunting
    // through perfectly good portraits; its own text says "fix the build".
    const message =
      err instanceof PortraitProcessingError && err.code === "model_unavailable"
        ? `${detail} — bu deploymentda model yo‘q (next.config.ts / SEGMENTATION_ROUTES).`
        : PORTRAIT_REMOVAL_FAILED_MESSAGE;

    console.error("[post-studio] portrait failed", {
      postId: post.id,
      candidateId: post.candidateId,
      error: detail,
    });

    await updatePost(post.id, {
      status: "needs_review",
      error: message,
      metadata: {
        ...post.metadata,
        portrait: {
          ...storedPortraitMetadata(post),
          error: detail,
          failedAt: new Date().toISOString(),
        },
      },
    });

    return {
      processedUrl: post.portraitProcessedUrl,
      warning: { code, message },
    };
  }
}

/** Loads the cut-out as a data URI; resvg cannot fetch remote images. */
async function portraitHrefFor(post: PostRecord): Promise<string | null> {
  if (!post.portraitProcessedUrl) return null;
  const stored = await downloadPostAsset(post.candidateId, "portrait-transparent");
  if (!stored) return null;
  postStudioLog("portrait attached to layout", {
    postId: post.id,
    candidateId: post.candidateId,
    target: "final",
  });
  return toDataUri(stored, "image/png");
}

export async function buildLayoutForPost(post: PostRecord): Promise<PostLayout> {
  const layout = buildPostLayout({
    templateId: post.templateId,
    quote: post.quote,
    nameLines: post.nameLines,
    shortBioItems: post.shortBioItems,
    portraitHref: await portraitHrefFor(post),
    portraitPersonBounds: storedPersonBounds(post),
    portraitTransform: post.portraitTransform,
    fontSizeOverrides: post.fontSizeOverrides,
  });
  postStudioLog("quote derived from intake q15", {
    postId: post.id,
    sentences: layout.quoteSelection.sentenceCount,
    available: layout.quoteSelection.availableSentences,
    reason: layout.quoteSelection.reason,
  });
  postStudioLog("portrait auto-fit calculated", {
    postId: post.id,
    person: layout.portrait,
    fontSize: layout.quote.fontSize,
  });
  postStudioLog("layout built", { postId: post.id, templateId: layout.templateId });
  return layout;
}

/**
 * Layout for the browser preview: identical geometry to the render path (same
 * engine, same metrics) but with the portrait referenced by its public URL
 * instead of an inlined data URI, which would add megabytes to the page
 * payload for no benefit — the browser can fetch the image itself.
 */
export async function buildLayoutForPreview(post: PostRecord): Promise<PostLayout> {
  // Verify the same stable storage object the final renderer downloads. A
  // stale database URL must not make preview show an asset final cannot read.
  const stored = post.portraitProcessedUrl
    ? await postAssetExists(post.candidateId, "portrait-transparent")
    : false;
  const previewPortraitHref = stored ? post.portraitProcessedUrl : null;
  if (previewPortraitHref) {
    postStudioLog("portrait attached to layout", {
      postId: post.id,
      candidateId: post.candidateId,
      target: "preview",
    });
  }
  return buildPostLayout({
    templateId: post.templateId,
    quote: post.quote,
    nameLines: post.nameLines,
    shortBioItems: post.shortBioItems,
    portraitHref: previewPortraitHref,
    portraitPersonBounds: storedPersonBounds(post),
    portraitTransform: post.portraitTransform,
    fontSizeOverrides: post.fontSizeOverrides,
  });
}

export interface RenderResult {
  post: PostRecord;
  layout: PostLayout;
  warnings: PostWarning[];
}

/**
 * Renders the post, stores the PNG and thumbnail, and moves the post to `ready`
 * or `needs_review` depending on what the layout engine reported.
 *
 * `approved`, `scheduled` and `published` posts keep their status: a re-render
 * must not silently demote an already-approved post back to ready.
 */
export async function renderAndStorePost(
  postId: string,
  options: { actorId?: string | null; autoPreparePortrait?: boolean } = {},
): Promise<RenderResult> {
  let post = await getPost(postId);
  if (!post) throw new Error("Post topilmadi.");

  post = await synchronizePostSourceData(post);

  await updatePost(post.id, { status: "rendering", error: null });

  const warnings: PostWarning[] = [];

  if (options.autoPreparePortrait && !post.portraitProcessedUrl) {
    const prepared = await preparePortrait(post);
    if (prepared.warning) warnings.push(prepared.warning);
    post = (await getPost(postId))!;
  }

  try {
    const layout = await buildLayoutForPost(post);
    const rendered = await renderPostImage(layout);

    // Both uploads target stable per-candidate paths, so they can run together.
    const [imageUrl, thumbnailUrl] = await Promise.all([
      uploadPostAsset(post.candidateId, "render", rendered.png),
      uploadPostAsset(post.candidateId, "thumbnail", rendered.thumbnail),
    ]);

    const allWarnings = [...warnings, ...layout.warnings];
    const needsReview = layout.needsReview || warnings.length > 0;
    const keepStatus = ["approved", "scheduled", "published"].includes(post.status);
    const portraitWarning = allWarnings.find((warning) =>
      ["portrait_missing", "portrait_removal_failed", "portrait_low_quality"].includes(
        warning.code,
      ),
    );

    const updated = await updatePost(post.id, {
      status: needsReview ? "needs_review" : keepStatus ? post.status : "ready",
      rendered_image_url: imageUrl,
      rendered_thumbnail_url: thumbnailUrl,
      rendered_at: new Date().toISOString(),
      // Keep the actionable portrait failure visible after the renderer stores
      // a review-only proof. Clearing it here made the retry instruction vanish
      // even though no portrait had been attached to the post.
      error: portraitWarning?.message ?? null,
      metadata: {
        ...post.metadata,
        warnings: allWarnings,
        typography: {
          quoteFontSize: layout.quote.fontSize,
          quoteLines: layout.quote.lines.length,
          nameFontSize: layout.name.fontSize,
          nameLines: layout.name.lines.length,
          shortBioFontSize: layout.shortBio.fontSize,
        },
      },
    });

    await logAudit({
      actorId: options.actorId ?? null,
      action: "post.rendered",
      entityType: "candidate_social_posts",
      entityId: post.id,
      severity: needsReview ? "warning" : "info",
      metadata: { templateId: post.templateId, warnings: allWarnings.map((w) => w.code) },
    });

    postStudioLog("render complete", {
      postId: post.id,
      candidateId: post.candidateId,
      width: rendered.width,
      height: rendered.height,
      portraitAttached: Boolean(layout.portrait.href),
      templateId: post.templateId,
    });

    return { post: updated, layout, warnings: allWarnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updatePost(post.id, { status: "failed", error: message });
    await logAudit({
      actorId: options.actorId ?? null,
      action: "post.render_failed",
      entityType: "candidate_social_posts",
      entityId: post.id,
      severity: "critical",
      metadata: { error: message },
    });
    throw err;
  }
}

/**
 * Builds the caption from the candidate's canonical published article URL.
 * Returns null when the article is not published — a caption pointing at a
 * missing page is worse than no send at all.
 */
export async function buildCaptionForPost(
  post: PostRecord,
): Promise<{ caption: string | null; warning: PostWarning | null }> {
  const source = await loadCandidateSourceData(post.candidateId);
  if (!source) return { caption: null, warning: { code: "name_missing", message: "Nomzod topilmadi." } };

  // An admin-confirmed URL always wins: it is the escape hatch for the period
  // where the public site's own address is still moving.
  const articleUrl = post.articleUrl?.trim() || source.articleUrl;

  if (!articleUrl) {
    return {
      caption: null,
      warning: source.publicWebConfigured
        ? {
            code: "article_unpublished",
            message: "Nomzodning maqolasi hali nashr qilinmagan — caption havolasi yo‘q.",
          }
        : {
            code: "article_url_unconfigured",
            message:
              "Public sayt manzili sozlanmagan (site_settings → public_web.base_url). " +
              "Eski liderlar.uz havolasi yaratilmadi; maqola URL'ini qo‘lda tasdiqlang.",
          },
    };
  }

  const settings = await getTelegramSettings();
  // An admin-confirmed article URL also settles where the public site lives,
  // so the caption's own site and application links can be derived from it
  // when public_web.base_url has not been filled in yet.
  const confirmedOrigin = originOfConfirmedUrl(post.articleUrl);
  const siteUrl = settings.siteUrl ?? confirmedOrigin;
  const applicationUrl = settings.applicationUrl ?? (siteUrl ? `${siteUrl}/ariza` : null);

  if (!siteUrl || !applicationUrl) {
    return {
      caption: null,
      warning: {
        code: "article_url_unconfigured",
        message:
          "Caption'dagi sayt va ariza havolalari uchun public_web.base_url sozlanmagan. " +
          "Maqola havolasini qo'lda tasdiqlasangiz, sayt manzili o'sha havoladan olinadi.",
      },
    };
  }

  return {
    caption: buildTelegramCaption({
      quote: post.quote,
      fullName: source.fullName,
      articleUrl,
      applicationUrl,
      siteUrl,
      instagramUrl: settings.instagramUrl,
      telegramUsername: settings.username,
    }),
    warning: null,
  };
}

/** Refreshes and persists the caption, so the admin can edit it afterwards. */
/** Blocking layout problems recorded by the last render. */
function hasBlockingRenderWarning(post: PostRecord): boolean {
  const warnings = post.metadata?.warnings;
  if (!Array.isArray(warnings)) return false;
  const blocking = new Set([
    "quote_overflow",
    "name_overflow",
    "short_bio_overflow",
    "quote_missing",
    "name_missing",
    "portrait_missing",
    "portrait_low_quality",
    "portrait_removal_failed",
  ]);
  return warnings.some(
    (w) => typeof w === "object" && w !== null && blocking.has(String((w as { code?: unknown }).code)),
  );
}

/**
 * Refreshes and persists the caption, so the admin can edit it afterwards.
 *
 * A successful caption also *clears* the review flag it previously raised.
 * Without that, confirming the article URL saved a perfectly good caption but
 * left the post sitting at needs_review with the old "maqolasi hali nashr
 * qilinmagan" error still attached — and needs_review cannot be sent, so the
 * post was stuck with no way out but a full re-render.
 */
export async function refreshPostCaption(post: PostRecord): Promise<PostRecord> {
  const synchronized = await synchronizePostSourceData(post);
  const { caption, warning } = await buildCaptionForPost(synchronized);
  if (!caption) {
    return updatePost(synchronized.id, {
      status: "needs_review",
      error: warning?.message ?? "Caption yaratilmadi.",
    });
  }

  // Only the caption's own blocker is lifted here; a portrait or layout problem
  // recorded by the render keeps the post under review.
  const stillBlocked = hasBlockingRenderWarning(synchronized);
  const patch: Record<string, unknown> = { telegram_caption: caption };
  if (!stillBlocked) {
    patch.error = null;
    if (synchronized.status === "needs_review") patch.status = "ready";
  }
  return updatePost(synchronized.id, patch);
}
