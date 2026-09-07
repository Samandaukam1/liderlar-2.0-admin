import { BookMarked } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination } from "@/components/admin/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { countKnowledgeByStatus, listKnowledge } from "@/lib/sales/repository";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_STATUSES,
  type KnowledgeCategory,
  type KnowledgeStatus,
} from "@/lib/sales/types";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { KnowledgeFilters } from "./knowledge-filters";
import { KnowledgeItem } from "./knowledge-item";

export const metadata = { title: "AI Sotuv — Knowledge Base" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function SalesKnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; category?: string; q?: string }>;
}) {
  const ctx = await requirePermission("sales.view");
  const canManage = hasPermission(ctx.roles, "sales.manage");
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const status = (KNOWLEDGE_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as KnowledgeStatus)
    : null;
  const category = (KNOWLEDGE_CATEGORIES as readonly string[]).includes(params.category ?? "")
    ? (params.category as KnowledgeCategory)
    : null;

  const [{ items, total }, counts] = await Promise.all([
    listKnowledge({ page, pageSize: PAGE_SIZE, status, category, search: params.q ?? null }),
    countKnowledgeByStatus(),
  ]);

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        description="Suhbatlardan ajratilgan faktlar. Hammasi qoralama holida keladi va admin tasdiqlashini kutadi."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Knowledge Base" }]}
      />
      <SalesTabs active="knowledge" />
      <NoAutoReplyNotice />

      <section className="mb-5 grid grid-cols-3 gap-3">
        {[
          { label: "Qoralama", value: counts.draft },
          { label: "Tasdiqlangan", value: counts.approved },
          { label: "Rad etilgan", value: counts.rejected },
        ].map((card) => (
          <div key={card.label} className="rounded-card border border-line bg-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
              {card.label}
            </p>
            <p className="mt-1 text-xl font-bold text-ink">{card.value}</p>
          </div>
        ))}
      </section>

      <KnowledgeFilters
        status={params.status ?? ""}
        category={params.category ?? ""}
        query={params.q ?? ""}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<BookMarked className="h-7 w-7" />}
          title="Bilim topilmadi"
          description="Suhbatlar o‘rganilgach, ajratilgan savol-javob, narx va e’tirozlar shu yerda paydo bo‘ladi."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <KnowledgeItem
              key={item.id}
              id={item.id}
              category={item.category}
              question={item.question}
              answer={item.answer}
              status={item.status}
              confidence={item.confidence}
              tags={item.tags}
              sourceConversationId={item.sourceConversationId}
              createdAt={item.createdAt}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/ai-sotuv/knowledge"
        params={{ status: params.status, category: params.category, q: params.q }}
      />
    </div>
  );
}
