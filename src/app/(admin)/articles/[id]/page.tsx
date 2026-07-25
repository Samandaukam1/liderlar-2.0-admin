import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { ArticleEditor, type RevisionSummary } from "../article-editor";
import type { Article } from "@/lib/types";
import { truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ArticleDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("articles.view");
  const { id } = await props.params;
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("articles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const article = data as unknown as Article;

  const [{ data: candidates }, { data: revisionRows }] = await Promise.all([
    admin.from("candidates").select("id, full_name").is("deleted_at", null).order("full_name").limit(500),
    admin
      .from("article_revisions")
      .select("id, revision, created_at, is_autosave, profiles(full_name)")
      .eq("article_id", id)
      .order("revision", { ascending: false })
      .limit(30),
  ]);

  const revisions: RevisionSummary[] = (
    (revisionRows ?? []) as unknown as Array<{
      id: string;
      revision: number;
      created_at: string;
      is_autosave: boolean;
      profiles: { full_name: string } | null;
    }>
  ).map((r) => ({
    id: r.id,
    revision: r.revision,
    created_at: r.created_at,
    is_autosave: r.is_autosave,
    author: r.profiles?.full_name ?? null,
  }));

  return (
    <>
      <PageHeader
        title={truncate(article.title, 60)}
        breadcrumbs={[
          { label: "Maqolalar", href: "/articles" },
          { label: truncate(article.title, 40) },
        ]}
      />
      <ArticleEditor
        article={article}
        candidates={candidates ?? []}
        revisions={revisions}
        canEdit={hasPermission(ctx.roles, "articles.edit")}
        canSubmit={hasPermission(ctx.roles, "articles.submit")}
        canPublish={hasPermission(ctx.roles, "articles.publish")}
        canUseAI={hasPermission(ctx.roles, "ai.use")}
      />
    </>
  );
}
