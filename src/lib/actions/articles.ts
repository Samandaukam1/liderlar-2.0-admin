"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import type { ArticleStatus } from "@/lib/types";

const articleSchema = z.object({
  title: z.string().min(3, "Sarlavha juda qisqa").max(300),
  subtitle: z.string().max(300).optional().or(z.literal("")),
  slug: z.string().max(160).optional().or(z.literal("")),
  excerpt: z.string().max(600).optional().or(z.literal("")),
  content: z.string().max(120000).optional().or(z.literal("")),
  cover_url: z.string().optional().or(z.literal("")),
  candidate_id: z.string().uuid().optional().or(z.literal("")),
  seo_title: z.string().max(160).optional().or(z.literal("")),
  seo_description: z.string().max(300).optional().or(z.literal("")),
  scheduled_at: z.string().optional().or(z.literal("")),
});

export interface ArticleActionResult {
  ok: boolean;
  error?: string;
  id?: string;
  revision?: number;
}

function nullable(v: string | undefined | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

/** Saves an article and records an immutable revision snapshot. */
export async function saveArticleAction(
  articleId: string | null,
  values: z.input<typeof articleSchema>,
  options?: { autosave?: boolean },
): Promise<ArticleActionResult> {
  const ctx = await requirePermission(articleId ? "articles.edit" : "articles.create");
  const parsed = articleSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }
  const v = parsed.data;
  const admin = createSupabaseAdminClient();
  const slug = nullable(v.slug) ?? slugify(v.title);

  const payload = {
    title: v.title.trim(),
    subtitle: nullable(v.subtitle),
    slug,
    excerpt: nullable(v.excerpt),
    content: v.content ?? "",
    cover_url: nullable(v.cover_url),
    candidate_id: nullable(v.candidate_id),
    seo_title: nullable(v.seo_title),
    seo_description: nullable(v.seo_description),
    scheduled_at: nullable(v.scheduled_at),
  };

  let id = articleId;
  if (id) {
    const { error } = await admin.from("articles").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await admin
      .from("articles")
      .insert({ ...payload, status: "draft", created_by: ctx.userId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Yaratib bo‘lmadi" };
    id = data.id;
  }

  // Revision snapshot on every save
  const { data: lastRev } = await admin
    .from("article_revisions")
    .select("revision")
    .eq("article_id", id)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  const revision = (lastRev?.revision ?? 0) + 1;
  await admin.from("article_revisions").insert({
    article_id: id,
    revision,
    title: payload.title,
    subtitle: payload.subtitle,
    content: payload.content,
    excerpt: payload.excerpt,
    created_by: ctx.userId,
    is_autosave: Boolean(options?.autosave),
  });

  if (!options?.autosave) {
    await logAudit({
      actorId: ctx.userId,
      action: articleId ? "article.update" : "article.create",
      entityType: "article",
      entityId: id,
      newValue: { title: payload.title, revision },
    });
  }

  revalidatePath("/articles");
  if (articleId) revalidatePath(`/articles/${articleId}`);
  return { ok: true, id: id ?? undefined, revision };
}

const STATUS_PERMS: Record<ArticleStatus, "articles.edit" | "articles.submit" | "articles.publish"> = {
  draft: "articles.edit",
  review: "articles.submit",
  scheduled: "articles.publish",
  published: "articles.publish",
  archived: "articles.publish",
};

export async function setArticleStatusAction(
  articleId: string,
  status: ArticleStatus,
): Promise<ArticleActionResult> {
  const perm = STATUS_PERMS[status];
  if (!perm) return { ok: false, error: "Noto‘g‘ri status" };
  const ctx = await requirePermission(perm);
  const admin = createSupabaseAdminClient();
  const { data: before } = await admin
    .from("articles")
    .select("status")
    .eq("id", articleId)
    .maybeSingle();
  const patch: Record<string, unknown> = { status };
  if (status === "published") patch.published_at = new Date().toISOString();
  const { error } = await admin.from("articles").update(patch).eq("id", articleId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: `article.status.${status}`,
    entityType: "article",
    entityId: articleId,
    oldValue: { status: before?.status },
    newValue: { status },
    severity: status === "published" ? "info" : "info",
  });
  revalidatePath("/articles");
  revalidatePath(`/articles/${articleId}`);
  return { ok: true };
}

export async function restoreRevisionAction(
  articleId: string,
  revisionId: string,
): Promise<ArticleActionResult> {
  const ctx = await requirePermission("articles.edit");
  const admin = createSupabaseAdminClient();
  const { data: rev } = await admin
    .from("article_revisions")
    .select("title, subtitle, content, excerpt, revision")
    .eq("id", revisionId)
    .eq("article_id", articleId)
    .maybeSingle();
  if (!rev) return { ok: false, error: "Versiya topilmadi" };
  const { error } = await admin
    .from("articles")
    .update({
      title: rev.title,
      subtitle: rev.subtitle,
      content: rev.content,
      excerpt: rev.excerpt,
    })
    .eq("id", articleId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "article.restore_revision",
    entityType: "article",
    entityId: articleId,
    metadata: { revision: rev.revision },
  });
  revalidatePath(`/articles/${articleId}`);
  return { ok: true };
}
