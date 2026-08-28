import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { getPost, loadCandidateSourceData } from "@/lib/post-studio/repository";
import { buildLayoutForPreview } from "@/lib/post-studio/service";
import { getPostDeliveryStats, getSubscriberStats } from "@/lib/post-studio/telegram";
import {
  paletteForTemplate,
  POST_TEMPLATE_LIST,
  templateAssetUrl,
} from "@/lib/post-studio/layout-config";
import { PostStudio } from "./studio-client";

export const metadata = { title: "Post Studio" };
export const dynamic = "force-dynamic";

export default async function PostStudioPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const ctx = await requirePermission("posts.view");
  const { postId } = await params;

  const post = await getPost(postId);
  if (!post) notFound();

  // Candidate data, layout, delivery and subscriber counts are independent.
  const [source, layout, delivery, subscribers] = await Promise.all([
    loadCandidateSourceData(post.candidateId),
    buildLayoutForPreview(post),
    getPostDeliveryStats(post.id),
    getSubscriberStats(),
  ]);

  return (
    <div>
      <PageHeader
        title={source?.fullName ?? "Post Studio"}
        description="Iqtibos, ism, tavsiflar va portretni sozlang — preview va yakuniy render bir xil layout dvigatelidan foydalanadi."
        breadcrumbs={[{ label: "Postlar", href: "/postlar" }, { label: "Post Studio" }]}
      />

      <PostStudio
        post={post}
        layout={layout}
        templates={POST_TEMPLATE_LIST.map((t) => ({
          id: t.id,
          label: t.label,
          accentColor: t.accentColor,
          thumbnailUrl: templateAssetUrl(t.thumbnailPath),
          backgroundUrl: templateAssetUrl(t.backgroundPath),
          foregroundUrl: templateAssetUrl(t.foregroundPath),
          // Shipped per template so switching one repaints the preview from the
          // new template's own colours instead of keeping the saved post's.
          palette: paletteForTemplate(t.id),
        }))}
        candidate={{
          fullName: source?.fullName ?? "",
          articleUrl: source?.articleUrl ?? null,
          quotes: source?.quotes ?? [],
          shortBioItems: source?.shortBioItems ?? [],
          portraitSourceUrl: source?.portraitSourceUrl ?? null,
          // Both halves of "why is there no link", so the studio can say which
          // one it is instead of always blaming the article.
          articleStatus: source?.article?.status ?? null,
          publicWebConfigured: source?.publicWebConfigured ?? false,
        }}
        delivery={delivery}
        subscribers={subscribers}
        canManage={hasPermission(ctx.roles, "posts.manage")}
        canPublish={hasPermission(ctx.roles, "posts.publish")}
      />
    </div>
  );
}
