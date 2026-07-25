import { Inbox } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import type { MonthlyUpdate } from "@/lib/types";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { CandidateMiniCard, StatusBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate, truncate } from "@/lib/utils";

export const metadata = { title: "Yuborilgan yangilanishlar" };
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  { value: "submitted", label: "Yuborilgan" },
  { value: "under_review", label: "Tekshirilmoqda" },
  { value: "needs_changes", label: "Tuzatish kerak" },
  { value: "approved", label: "Tasdiqlangan" },
  { value: "merged", label: "Birlashtirilgan" },
  { value: "rejected", label: "Rad etilgan" },
];

export default async function MonthlyUpdatesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("updates.view");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["status"]);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("monthly_updates")
    .select(
      "id, status, free_text, submitted_at, reviewed_at, created_at, candidate_id, candidates!inner(full_name, avatar_url, slug)",
      { count: "exact" },
    )
    .neq("status", "draft")
    .order("submitted_at", { ascending: false, nullsFirst: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (q) query = query.ilike("candidates.full_name", `%${q}%`);

  const [from, to] = listRange(page);
  const { data, count, error } = await query.range(from, to);
  const rows = (data ?? []) as unknown as MonthlyUpdate[];

  const columns: Column<MonthlyUpdate>[] = [
    {
      key: "candidate",
      header: "Nomzod",
      render: (u) => (
        <CandidateMiniCard
          name={u.candidates?.full_name ?? "—"}
          avatarUrl={u.candidates?.avatar_url}
          meta={truncate(u.free_text, 60) || undefined}
        />
      ),
    },
    { key: "status", header: "Status", render: (u) => <StatusBadge status={u.status} /> },
    {
      key: "submitted",
      header: "Yuborilgan",
      render: (u) => <span className="text-xs text-ink-soft">{formatDate(u.submitted_at, true)}</span>,
    },
    {
      key: "reviewed",
      header: "Tekshirilgan",
      desktopOnly: true,
      render: (u) => <span className="text-xs text-ink-soft">{formatDate(u.reviewed_at, true)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Yuborilgan yangilanishlar"
        description="Nomzodlar oylik havola orqali yuborgan materiallar — tekshirish va biografiyaga birlashtirish"
        breadcrumbs={[{ label: "Yuborilgan yangilanishlar" }]}
      />
      <DataTableToolbar
        searchPlaceholder="Nomzod ismi bo‘yicha…"
        filters={[{ key: "status", label: "Status", options: STATUS_OPTIONS }]}
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowHref={(u) => `/monthly-updates/${u.id}`}
        empty={
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Yangilanishlar yo‘q"}
            description={
              error
                ? "Supabase migrationlarni ishga tushiring."
                : "Nomzodlar havola orqali material yuborganda shu yerda ko‘rinadi."
            }
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/monthly-updates" params={{ q, ...filters }} />
    </>
  );
}
