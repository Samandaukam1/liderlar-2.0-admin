import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination } from "@/components/admin/pagination";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { Card } from "@/components/ui/primitives";
import {
  loadArticleCounts,
  loadArticleQueue,
} from "@/lib/articles/editorial-service";
import { ARTICLE_PAGE_SIZE, ARTICLE_SEARCH_MAX_LENGTH, getArticlePageRange } from "@/lib/articles/list-search";
import { parseListParams } from "@/lib/list";
import { ArticleSectionNav } from "./article-section-nav";
import { QueueList } from "./queue-list";

export const metadata = { title: "Liderlar Online maqolalari" };
export const dynamic = "force-dynamic";

/** A‘zolar yozgan maqolalarning tahririyat navbatini filtrlab, 10 tadan ko‘rsatadi. */
export default async function OnlineArticlesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("articles.view");
  const canReview = hasPermission(ctx.roles, "articles.edit");
  const params = parseListParams(await searchParams);
  const q = params.q.slice(0, ARTICLE_SEARCH_MAX_LENGTH);
  const { page } = getArticlePageRange(params.page);
  const [queue, counts] = await Promise.all([loadArticleQueue({ page, search: q }), loadArticleCounts()]);
  if (page > 1 && (queue.error ? queue.outOfRange : queue.rows.length === 0)) {
    redirect(q ? `/online-maqolalar?${new URLSearchParams({ q })}` : "/online-maqolalar");
  }

  return (
    <div>
      <PageHeader
        title="Liderlar Online maqolalari"
        description="A‘zolar yuborgan va tahririyat navbatidagi maqolalar."
        breadcrumbs={[{ label: "Liderlar Online maqolalari" }]}
      />

      <ArticleSectionNav active="submitted" counts={counts} />
      <DataTableToolbar searchPlaceholder="Sarlavha yoki muallif nomi" searchMaxLength={ARTICLE_SEARCH_MAX_LENGTH} />
      {!canReview && <p className="mb-4 text-xs text-ink-soft">Amal bajarish uchun maqolalarni tahrirlash ruxsati kerak.</p>}
      {queue.error ? (
        <Card><p role="alert" className="text-sm text-coral">Maqolalarni yuklab bo‘lmadi. Sahifani yangilang.</p></Card>
      ) : (
        <>
          <QueueList rows={queue.rows} canReview={canReview} searching={queue.searching} />
          <Pagination page={page} pageSize={ARTICLE_PAGE_SIZE} total={queue.total} prefetch={false} />
        </>
      )}
    </div>
  );
}
