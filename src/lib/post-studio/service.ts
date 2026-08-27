import "server-only";
import { logAudit } from "@/lib/audit";
import { buildPostLayout } from "./compose.ts";
import { renderPostImage, toDataUri } from "./render.ts";
import {
  fetchPortraitSource,
  PortraitProcessingError,
  removePortraitBackground,
} from "./portrait.ts";
import { downloadPostAsset, uploadPostAsset } from "./storage.ts";
import { getPost, loadCandidateSourceData, updatePost, type PostRecord } from "./repository.ts";
import { buildTelegramCaption, getTelegramSettings } from "./telegram.ts";
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
}

/**
 * Produces the transparent cut-out and stores it beside the candidate. The
 * source photo is only read, never replaced.
 */
export async function preparePortrait(post: PostRecord): Promise<PreparePortraitResult> {
  if (!post.portraitSourceUrl) {
    return {
      processedUrl: null,
      warning: { code: "portrait_missing", message: "Nomzod uchun manba rasm topilmadi." },
    };
  }

  try {
    const source = await fetchPortraitSource(post.portraitSourceUrl);
    const cutout = await removePortraitBackground(source);
    const processedUrl = await uploadPostAsset(
      post.candidateId,
      "portrait-transparent",
      cutout.buffer,
    );

    await updatePost(post.id, {
      portrait_processed_url: processedUrl,
      metadata: {
        ...post.metadata,
        portrait: {
          provider: cutout.provider,
          coverage: Number(cutout.coverage.toFixed(4)),
          width: cutout.width,
          height: cutout.height,
          processedAt: new Date().toISOString(),
        },
      },
    });

    return { processedUrl, warning: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof PortraitProcessingError && err.code === "low_quality"
        ? ("portrait_low_quality" as const)
        : ("portrait_removal_failed" as const);

    await updatePost(post.id, {
      metadata: {
        ...post.metadata,
        portrait: { error: message, failedAt: new Date().toISOString() },
      },
    });

    return { processedUrl: null, warning: { code, message } };
  }
}

/** Loads the cut-out as a data URI; resvg cannot fetch remote images. */
async function portraitHrefFor(post: PostRecord): Promise<string | null> {
  if (!post.portraitProcessedUrl) return null;
  const stored = await downloadPostAsset(post.candidateId, "portrait-transparent");
  return stored ? toDataUri(stored, "image/png") : null;
}

export async function buildLayoutForPost(post: PostRecord): Promise<PostLayout> {
  return buildPostLayout({
    templateId: post.templateId,
    quote: post.quote,
    nameLines: post.nameLines,
    shortBioItems: post.shortBioItems,
    portraitHref: await portraitHrefFor(post),
    portraitTransform: post.portraitTransform,
    fontSizeOverrides: post.fontSizeOverrides,
  });
}

/**
 * Layout for the browser preview: identical geometry to the render path (same
 * engine, same metrics) but with the portrait referenced by its public URL
 * instead of an inlined data URI, which would add megabytes to the page
 * payload for no benefit — the browser can fetch the image itself.
 */
export async function buildLayoutForPreview(post: PostRecord): Promise<PostLayout> {
  return buildPostLayout({
    templateId: post.templateId,
    quote: post.quote,
    nameLines: post.nameLines,
    shortBioItems: post.shortBioItems,
    portraitHref: post.portraitProcessedUrl,
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

    const updated = await updatePost(post.id, {
      status: needsReview ? "needs_review" : keepStatus ? post.status : "ready",
      rendered_image_url: imageUrl,
      rendered_thumbnail_url: thumbnailUrl,
      rendered_at: new Date().toISOString(),
      error: null,
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
  if (!settings.siteUrl || !settings.applicationUrl) {
    return {
      caption: null,
      warning: {
        code: "article_url_unconfigured",
        message:
          "Caption'dagi sayt va ariza havolalari uchun public_web.base_url sozlanmagan.",
      },
    };
  }

  return {
    caption: buildTelegramCaption({
      quote: post.quote,
      fullName: source.fullName,
      articleUrl,
      applicationUrl: settings.applicationUrl,
      siteUrl: settings.siteUrl,
      instagramUrl: settings.instagramUrl,
      telegramUsername: settings.username,
    }),
    warning: null,
  };
}

/** Refreshes and persists the caption, so the admin can edit it afterwards. */
export async function refreshPostCaption(post: PostRecord): Promise<PostRecord> {
  const { caption, warning } = await buildCaptionForPost(post);
  if (!caption) {
    return updatePost(post.id, {
      status: "needs_review",
      error: warning?.message ?? "Caption yaratilmadi.",
    });
  }
  return updatePost(post.id, { telegram_caption: caption });
}
