import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { ArticleEditor } from "../article-editor";
import { resolvePublicWebUrl } from "@/lib/post-studio/site-origin";

export const metadata = { title: "Yangi maqola" };
export const dynamic = "force-dynamic";

export default async function NewArticlePage(props: {
  searchParams: Promise<{ candidate?: string }>;
}) {
  const ctx = await requirePermission("articles.create");
  const { candidate } = await props.searchParams;
  const admin = createSupabaseAdminClient();
  const [{ data: candidates }, publicSiteUrl] = await Promise.all([
    candidate
      ? admin.from("candidates").select("id, full_name").is("deleted_at", null).eq("id", candidate)
      : { data: [] },
    resolvePublicWebUrl(),
  ]);

  return (
    <>
      <PageHeader
        title="Yangi maqola"
        breadcrumbs={[{ label: "Maqolalar", href: "/articles" }, { label: "Yangi" }]}
      />
      <ArticleEditor
        article={null}
        publicSiteUrl={publicSiteUrl}
        initialCandidateId={candidate}
        candidates={candidates ?? []}
        revisions={[]}
        canEdit
        canSubmit={hasPermission(ctx.roles, "articles.submit")}
        canPublish={hasPermission(ctx.roles, "articles.publish")}
        canUseAI={hasPermission(ctx.roles, "ai.use")}
      />
    </>
  );
}
