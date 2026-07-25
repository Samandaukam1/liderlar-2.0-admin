import { ClipboardList } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import type { Application } from "@/lib/types";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { StatusBadge, Avatar } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Arizalar" };
export const dynamic = "force-dynamic";

export default async function ApplicationsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("applications.view");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["status"]);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("applications")
    .select("*, regions(name), categories(name)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
  const [from, to] = listRange(page);
  const { data, count, error } = await query.range(from, to);
  const rows = (data ?? []) as unknown as Application[];

  const columns: Column<Application>[] = [
    {
      key: "name",
      header: "Arizachi",
      render: (a) => (
        <span className="flex items-center gap-3">
          <Avatar name={a.full_name} size={34} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">{a.full_name}</span>
            <span className="block truncate text-xs text-ink-soft">{a.email ?? a.phone ?? "—"}</span>
          </span>
        </span>
      ),
    },
    {
      key: "direction",
      header: "Yo‘nalish / hudud",
      desktopOnly: true,
      render: (a) => (
        <span className="text-xs text-ink-soft">
          {[a.categories?.name, a.regions?.name].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    {
      key: "duplicate",
      header: "Dublikat",
      desktopOnly: true,
      render: (a) =>
        a.duplicate_of ? (
          <span className="text-xs font-bold text-coral">Ehtimol dublikat</span>
        ) : (
          <span className="text-xs text-ink-soft">—</span>
        ),
    },
    {
      key: "created",
      header: "Kelgan sana",
      render: (a) => <span className="text-xs text-ink-soft">{formatDate(a.created_at, true)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Arizalar"
        description="Platformaga qo‘shilish arizalari — ko‘rib chiqish va nomzodga aylantirish"
        breadcrumbs={[{ label: "Arizalar" }]}
      />
      <DataTableToolbar
        searchPlaceholder="Ism yoki email bo‘yicha…"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "new", label: "Yangi" },
              { value: "in_review", label: "Ko‘rilmoqda" },
              { value: "needs_info", label: "Ma’lumot kerak" },
              { value: "accepted", label: "Qabul qilingan" },
              { value: "rejected", label: "Rad etilgan" },
              { value: "converted", label: "Nomzodga aylantirilgan" },
            ],
          },
        ]}
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowHref={(a) => `/applications/${a.id}`}
        empty={
          <EmptyState
            icon={<ClipboardList className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Arizalar yo‘q"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "Saytdan kelgan arizalar shu yerda ko‘rinadi."}
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/applications" params={{ q, ...filters }} />
    </>
  );
}
