import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { ArticleEditor } from "../article-editor";

export const metadata = { title: "Yangi maqola" };
export const dynamic = "force-dynamic";

export default async function NewArticlePage(props: {
  searchParams: Promise<{ candidate?: string }>;
}) {
  const ctx = await requirePermission("articles.create");
  const { candidate } = await props.searchParams;
  const admin = createSupabaseAdminClient();
  const { data: candidates } = await admin
    .from("candidates")
    .select("id, full_name")
    .is("deleted_at", null)
    .order("full_name")
    .limit(500);

  return (
    <>
      <PageHeader
        title="Yangi maqola"
        breadcrumbs={[{ label: "Maqolalar", href: "/articles" }, { label: "Yangi" }]}
      />
      <ArticleEditor
        article={null}
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
