import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import type { Article } from "@/lib/types";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { StatusBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate, truncate } from "@/lib/utils";

export const metadata = { title: "Biografik maqolalar" };
export const dynamic = "force-dynamic";

export default async function ArticlesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("articles.view");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["status"]);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("articles")
    .select("id, title, subtitle, status, updated_at, published_at, candidate_id, candidates(full_name, slug)", { count: "exact" })
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (q) query = query.ilike("title", `%${q}%`);

  const [from, to] = listRange(page);
  const { data, count, error } = await query.range(from, to);
  const rows = (data ?? []) as unknown as Article[];

  const columns: Column<Article>[] = [
    {
      key: "title",
      header: "Maqola",
      render: (a) => (
        <span className="block min-w-0">
          <span className="block truncate text-sm font-bold text-ink">{truncate(a.title, 70)}</span>
          {a.subtitle && <span className="block truncate text-xs text-ink-soft">{truncate(a.subtitle, 80)}</span>}
        </span>
      ),
    },
    {
      key: "candidate",
      header: "Nomzod",
      desktopOnly: true,
      render: (a) => <span className="text-sm text-ink-soft">{a.candidates?.full_name ?? "—"}</span>,
    },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    {
      key: "updated",
      header: "Yangilangan",
      render: (a) => <span className="text-xs text-ink-soft">{formatDate(a.updated_at, true)}</span>,
    },
    {
      key: "published",
      header: "Nashr sanasi",
      desktopOnly: true,
      render: (a) => <span className="text-xs text-ink-soft">{formatDate(a.published_at)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Biografik maqolalar"
        description="Muharrirlik, versiyalar tarixi va Jaxongir AI bilan yaxshilash"
        breadcrumbs={[{ label: "Maqolalar" }]}
        actions={
          <Link
            href="/articles/new"
            className="inline-flex h-10 items-center gap-2 rounded-[14px] bg-gradient-to-r from-brand to-electric px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(22,119,255,0.28)] transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Yangi maqola
          </Link>
        }
      />
      <DataTableToolbar
        searchPlaceholder="Sarlavha bo‘yicha…"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "draft", label: "Qoralama" },
              { value: "review", label: "Ko‘rib chiqilmoqda" },
              { value: "scheduled", label: "Rejalashtirilgan" },
              { value: "published", label: "Nashr etilgan" },
              { value: "archived", label: "Arxivlangan" },
            ],
          },
        ]}
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowHref={(a) => `/articles/${a.id}`}
        empty={
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Maqolalar yo‘q"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "Birinchi biografik maqolani yozing."}
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/articles" params={{ q, ...filters }} />
    </>
  );
}
