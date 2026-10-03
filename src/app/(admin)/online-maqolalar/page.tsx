import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import {
  loadArticleCounts,
  loadArticleQueue,
} from "@/lib/articles/editorial-service";
import { QueueList } from "./queue-list";

export const metadata = { title: "Liderlar Online maqolalari" };
export const dynamic = "force-dynamic";

/**
 * A'ZO MAQOLALARI — TAHRIRIYAT NAVBATI.
 *
 * BU BO'LIM "Biografik maqolalar" DAN BOSHQA. U yerda nomzod HAQIDA
 * yozilgan biografiya turadi va uni tahririyat yozadi; bu yerda esa
 * a'zoning O'ZI yozgan maqolasi va u "Liderlar Online" nashrida
 * chiqadi.
 *
 * Ikkisini bir bo'limga qo'shish ularni bir xil narsa qilib
 * ko'rsatardi — holbuki muallifi, oqimi va ommaviy joyi boshqa.
 */
export default async function OnlineArticlesPage() {
  const ctx = await requirePermission("articles.view");
  const canReview = hasPermission(ctx.roles, "articles.edit");

  const [rows, counts] = await Promise.all([loadArticleQueue(), loadArticleCounts()]);

  return (
    <div>
      <PageHeader
        title="Liderlar Online maqolalari"
        description="A‘zolar yozgan va tekshiruv kutayotgan maqolalar"
        breadcrumbs={[{ label: "Liderlar Online maqolalari" }]}
      />

      <p className="mb-4 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
        Bu bo‘lim <b>a‘zolar o‘zi yozgan</b> maqolalar uchun. Nomzod haqida
        yozilgan biografiyalar «Biografik maqolalar» bo‘limida turadi.
        {!canReview && " Amal bajarish uchun maqolalarni tahrirlash ruxsati kerak."}
      </p>

      <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span className="rounded-full bg-surface px-2.5 py-1 font-bold text-ink">
          Yuborilgan: {counts.submitted}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          Ko‘rilmoqda: {counts.inReview}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          Tasdiqlangan: {counts.approved}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          Nashrda: {counts.published}
        </span>
      </p>

      <QueueList rows={rows} canReview={canReview} />
    </div>
  );
}
