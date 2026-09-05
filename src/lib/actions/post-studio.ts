"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createPostDraft, getPost, updatePost } from "@/lib/post-studio/repository";
import {
  buildCaptionForPost,
  preparePortrait,
  refreshPostCaption,
  renderAndStorePost,
} from "@/lib/post-studio/service";
import {
  deliverPostToSubscribers,
  sendTelegramPhoto,
  isTelegramConfigured,
} from "@/lib/post-studio/telegram";
import { downloadPostAsset } from "@/lib/post-studio/storage";
import { requeueIntakePipeline } from "@/lib/post-studio/pipeline";
import { isPostTemplateId, type PortraitTransform } from "@/lib/post-studio/types";

/**
 * Server actions for Post Studio. Every one starts with an explicit permission
 * check; only after that does the service-role client come into play.
 */

export interface PostActionResult {
  ok: boolean;
  error?: string;
  postId?: string;
  message?: string;
  sent?: number;
  failed?: number;
  skipped?: number;
}

function revalidatePost(postId: string): void {
  revalidatePath("/postlar");
  revalidatePath(`/postlar/${postId}`);
}

function parseNumber(value: FormDataEntryValue | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Manual font sizes are optional; an empty field means "keep auto-fit". */
function parseOverride(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Step one of three: insert the row.
 *
 * Creation is staged rather than atomic so the button can report honest
 * progress — background removal alone is a second of work, and a spinner that
 * says nothing for two seconds reads as a hang. The client calls this, then
 * `preparePortraitAction`, then `rerenderPostAction`, and only navigates when
 * all three have returned. Nothing is shown as a finished post before the
 * portrait exists.
 */
export async function createPostForCandidateAction(candidateId: string): Promise<PostActionResult> {
  const ctx = await requirePermission("posts.manage");
  try {
    const post = await createPostDraft({ candidateId, createdBy: ctx.userId });
    await logAudit({
      actorId: ctx.userId,
      action: "post.created",
      entityType: "candidate_social_posts",
      entityId: post.id,
      metadata: { candidateId },
    });
    revalidatePost(post.id);
    return { ok: true, postId: post.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Post yaratilmadi" };
  }
}

/**
 * Saves the studio's right-hand panel. Manual font sizes and portrait
 * transforms are persisted as overrides so a later re-render reproduces exactly
 * what the admin approved instead of falling back to auto-fit.
 */
export async function savePostContentAction(formData: FormData): Promise<PostActionResult> {
  const ctx = await requirePermission("posts.manage");
  const postId = String(formData.get("post_id") ?? "");

  const post = await getPost(postId);
  if (!post) return { ok: false, error: "Post topilmadi" };

  const templateId = String(formData.get("template_id") ?? post.templateId);
  if (!isPostTemplateId(templateId)) return { ok: false, error: "Noma’lum shablon" };

  const nameLines = String(formData.get("name_lines") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);

  const shortBioItems = String(formData.get("short_bio_items") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);

  const quote = String(formData.get("quote") ?? "").trim();
  const quoteEdited = quote !== post.quote;

  const transform: PortraitTransform = {
    offsetX: parseNumber(formData.get("portrait_offset_x"), post.portraitTransform.offsetX),
    offsetY: parseNumber(formData.get("portrait_offset_y"), post.portraitTransform.offsetY),
    scale: parseNumber(formData.get("portrait_scale"), post.portraitTransform.scale),
    flip: formData.get("portrait_flip") === "on",
  };

  try {
    await updatePost(postId, {
      template_id: templateId,
      quote,
      // A hand-edited quote is no longer "the featured quote"; recording that
      // keeps the priority resolver from overwriting it on the next refresh.
      quote_source: quoteEdited ? "manual" : post.quoteSource,
      name_lines: nameLines,
      short_bio_items: shortBioItems,
      portrait_transform: transform,
      font_size_overrides: {
        quote: parseOverride(formData.get("quote_font_size")),
        name: parseOverride(formData.get("name_font_size")),
        shortBio: parseOverride(formData.get("short_bio_font_size")),
      },
      metadata: quoteEdited
        ? { ...post.metadata, manual_override: { quote: true, at: new Date().toISOString() } }
        : post.metadata,
    });

    const result = await renderAndStorePost(postId, { actorId: ctx.userId });
    await refreshPostCaption(result.post);
    revalidatePost(postId);
    return {
      ok: true,
      postId,
      message: result.warnings.length > 0 ? result.warnings.map((w) => w.message).join(" · ") : undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Saqlashda xatolik" };
  }
}

export async function rerenderPostAction(postId: string): Promise<PostActionResult> {
  const ctx = await requirePermission("posts.manage");
  try {
    const result = await renderAndStorePost(postId, {
      actorId: ctx.userId,
      autoPreparePortrait: true,
    });
    await refreshPostCaption(result.post);
    revalidatePost(postId);
    return {
      ok: true,
      postId,
      message: result.warnings.map((w) => w.message).join(" · ") || undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Render xatosi" };
  }
}

/**
 * Step two: the cut-out.
 *
 * `force` defaults to true because the studio button's whole purpose is redoing
 * a matte the admin was unhappy with. The create flow passes false so a
 * candidate who already has a current cut-out is not re-segmented.
 */
export async function preparePortraitAction(
  postId: string,
  options: { force?: boolean } = {},
): Promise<PostActionResult> {
  await requirePermission("posts.manage");
  const post = await getPost(postId);
  if (!post) return { ok: false, error: "Post topilmadi" };

  const result = await preparePortrait(post, { force: options.force ?? true });
  revalidatePost(postId);
  if (result.warning) return { ok: false, error: result.warning.message };
  return { ok: true, postId, message: "Portret foni olib tashlandi." };
}

export async function approvePostAction(postId: string): Promise<PostActionResult> {
  const ctx = await requirePermission("posts.publish");
  const post = await getPost(postId);
  if (!post) return { ok: false, error: "Post topilmadi" };
  if (post.status === "needs_review") {
    return { ok: false, error: "Post tekshirishni talab qiladi — avval ogohlantirishlarni bartaraf eting." };
  }
  if (!post.renderedImageUrl) return { ok: false, error: "Avval postni render qiling." };

  await updatePost(postId, { status: "approved" });
  await logAudit({
    actorId: ctx.userId,
    action: "post.approved",
    entityType: "candidate_social_posts",
    entityId: postId,
  });
  revalidatePost(postId);
  return { ok: true, postId };
}

export async function schedulePostAction(formData: FormData): Promise<PostActionResult> {
  const ctx = await requirePermission("posts.publish");
  const postId = String(formData.get("post_id") ?? "");
  const at = String(formData.get("scheduled_at") ?? "").trim();
  if (!at) return { ok: false, error: "Sana kiritilmagan" };

  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Sana noto‘g‘ri" };

  await updatePost(postId, { status: "scheduled", scheduled_at: when.toISOString() });
  await logAudit({
    actorId: ctx.userId,
    action: "post.scheduled",
    entityType: "candidate_social_posts",
    entityId: postId,
    metadata: { scheduledAt: when.toISOString() },
  });
  revalidatePost(postId);
  return { ok: true, postId };
}

export async function saveCaptionAction(formData: FormData): Promise<PostActionResult> {
  await requirePermission("posts.manage");
  const postId = String(formData.get("post_id") ?? "");
  const caption = String(formData.get("telegram_caption") ?? "").trim();

  await updatePost(postId, { telegram_caption: caption });
  revalidatePost(postId);
  return { ok: true, postId };
}

/**
 * Lets an admin confirm the canonical article URL by hand.
 *
 * Needed while the public site's own address is in flux: the resolver refuses
 * to guess a domain, so without this the post would sit at needs_review with no
 * way forward. Only http(s) origins are accepted — the value ends up as a link
 * in a message sent to every subscriber.
 */
export async function saveArticleUrlAction(formData: FormData): Promise<PostActionResult> {
  const ctx = await requirePermission("posts.manage");
  const postId = String(formData.get("post_id") ?? "");
  const raw = String(formData.get("article_url") ?? "").trim();

  if (raw) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, error: "URL formati noto‘g‘ri" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Faqat http(s) havola qabul qilinadi" };
    }
  }

  const post = await getPost(postId);
  if (!post) return { ok: false, error: "Post topilmadi" };

  await updatePost(postId, { article_url: raw || null });
  await logAudit({
    actorId: ctx.userId,
    action: "post.article_url_confirmed",
    entityType: "candidate_social_posts",
    entityId: postId,
    metadata: { articleUrl: raw || null },
  });

  // The caption embeds the URL, so it has to be rebuilt from the new value.
  const updated = await getPost(postId);
  if (updated) await refreshPostCaption(updated);

  revalidatePost(postId);
  return { ok: true, postId, message: "Maqola havolasi saqlandi." };
}

export async function regenerateCaptionAction(postId: string): Promise<PostActionResult> {
  await requirePermission("posts.manage");
  const post = await getPost(postId);
  if (!post) return { ok: false, error: "Post topilmadi" };

  const { caption, warning } = await buildCaptionForPost(post);
  if (!caption) return { ok: false, error: warning?.message ?? "Caption yaratilmadi" };

  await refreshPostCaption(post);
  revalidatePost(postId);
  return { ok: true, postId };
}

/** Sends the finished post to one chat only, so an admin can proof it first. */
export async function sendTelegramTestAction(formData: FormData): Promise<PostActionResult> {
  const ctx = await requirePermission("posts.publish");
  const postId = String(formData.get("post_id") ?? "");
  const chatId = Number(String(formData.get("chat_id") ?? "").trim());
  if (!Number.isFinite(chatId) || chatId === 0) {
    return { ok: false, error: "Telegram chat ID noto‘g‘ri" };
  }
  if (!isTelegramConfigured()) return { ok: false, error: "TELEGRAM_BOT_TOKEN sozlanmagan" };

  const post = await getPost(postId);
  if (!post?.telegramCaption) return { ok: false, error: "Avval captionni tayyorlang." };

  const photo = await downloadPostAsset(post.candidateId, "render");
  if (!photo) return { ok: false, error: "Render topilmadi — avval postni render qiling." };

  try {
    await sendTelegramPhoto(chatId, photo, post.telegramCaption);
    await logAudit({
      actorId: ctx.userId,
      action: "post.telegram_test_sent",
      entityType: "candidate_social_posts",
      entityId: postId,
      metadata: { chatId },
    });
    return { ok: true, postId, message: "Test post yuborildi." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Yuborilmadi" };
  }
}

/**
 * Fans the post out to every active subscriber. Subscribers who already have a
 * successful delivery for this post are skipped, so pressing the button twice
 * cannot double-post.
 */
export async function sendPostToSubscribersAction(
  formData: FormData,
): Promise<PostActionResult> {
  const ctx = await requirePermission("posts.publish");
  const postId = String(formData.get("post_id") ?? "");
  const onlyFailed = formData.get("only_failed") === "on";
  /**
   * The only way to send a post someone already has.
   *
   * Read from an explicit field rather than inferred from anything, so no
   * retry, cron tick or batch can ever reach it — this needs an admin who
   * confirmed the dialog.
   */
  const force = formData.get("force") === "on";

  if (!isTelegramConfigured()) return { ok: false, error: "TELEGRAM_BOT_TOKEN sozlanmagan" };

  const post = await getPost(postId);
  if (!post) return { ok: false, error: "Post topilmadi" };
  if (!["ready", "approved", "scheduled", "published"].includes(post.status)) {
    return { ok: false, error: "Faqat tayyor yoki tasdiqlangan postni yuborish mumkin." };
  }
  if (!post.telegramCaption) return { ok: false, error: "Caption tayyor emas." };

  const photo = await downloadPostAsset(post.candidateId, "render");
  if (!photo) return { ok: false, error: "Render topilmadi — avval postni render qiling." };

  try {
    const result = await deliverPostToSubscribers(postId, photo, post.telegramCaption, {
      onlyFailed,
      force,
      actorId: ctx.userId,
    });

    await updatePost(postId, {
      status: result.sent > 0 ? "published" : post.status,
      published_at: result.sent > 0 ? new Date().toISOString() : post.publishedAt,
      telegram_last_sent_at: new Date().toISOString(),
      telegram_sent_count: post.telegramSentCount + result.sent,
      telegram_failed_count: result.failed,
    });

    revalidatePost(postId);
    return {
      ok: true,
      postId,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
      message: force
        ? `Majburiy qayta yuborildi: ${result.sent} ta ketdi, ${result.failed} ta xato.`
        : `${result.sent} ta yuborildi, ${result.failed} ta xato, ${result.skipped} ta o‘tkazib yuborildi.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Yuborishda xatolik" };
  }
}

export async function requeuePipelineAction(intakeId: string): Promise<PostActionResult> {
  await requirePermission("posts.manage");
  await requeueIntakePipeline(intakeId);
  revalidatePath("/postlar");
  return { ok: true, message: "Pipeline qayta navbatga qo‘yildi." };
}
