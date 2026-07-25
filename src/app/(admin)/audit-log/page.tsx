import { ScrollText, Download } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { Avatar, Badge, StatusBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/utils";
import type { AuditLog } from "@/lib/types";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

function DiffCell({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  if (oldValue == null && newValue == null) return <span className="text-xs text-ink-soft">—</span>;
  const fmt = (v: unknown) =>
    typeof v === "object" ? JSON.stringify(v, null, 0).slice(0, 120) : String(v);
  return (
    <div className="max-w-xs space-y-1 font-mono text-[11px]">
      {oldValue != null && (
        <p className="truncate rounded bg-coral/10 px-1.5 py-0.5 text-[#a33232]" title={fmt(oldValue)}>
          − {fmt(oldValue)}
        </p>
      )}
      {newValue != null && (
        <p className="truncate rounded bg-mint/15 px-1.5 py-0.5 text-[#14563f]" title={fmt(newValue)}>
          + {fmt(newValue)}
        </p>
      )}
    </div>
  );
}

export default async function AuditLogPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("audit.view");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["severity", "entity"]);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("audit_logs")
    .select("*, profiles(full_name, avatar_url)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (filters.severity) query = query.eq("severity", filters.severity);
  if (filters.entity) query = query.eq("entity_type", filters.entity);
  if (q) query = query.ilike("action", `%${q}%`);
  const [from, to] = listRange(page);
  const { data, count, error } = await query.range(from, to);
  const rows = (data ?? []) as unknown as AuditLog[];

  const columns: Column<AuditLog>[] = [
    {
      key: "actor",
      header: "Kim",
      render: (a) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={a.profiles?.full_name ?? "Tizim"} src={a.profiles?.avatar_url} size={30} />
          <span className="truncate text-sm font-semibold text-ink">
            {a.profiles?.full_name ?? "Tizim"}
          </span>
        </span>
      ),
    },
    {
      key: "action",
      header: "Amal",
      render: (a) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge accent="brand">{a.action}</Badge>
          <span className="text-xs text-ink-soft">{a.entity_type}</span>
        </span>
      ),
    },
    { key: "severity", header: "Daraja", render: (a) => <StatusBadge status={a.severity} /> },
    {
      key: "diff",
      header: "O‘zgarish",
      desktopOnly: true,
      render: (a) => <DiffCell oldValue={a.old_value} newValue={a.new_value} />,
    },
    {
      key: "reason",
      header: "Sabab",
      desktopOnly: true,
      render: (a) => <span className="text-xs text-ink-soft">{a.reason ?? "—"}</span>,
    },
    {
      key: "time",
      header: "Vaqt",
      render: (a) => <span className="whitespace-nowrap text-xs text-ink-soft">{formatDate(a.created_at, true)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Barcha muhim admin amallari — kim, nima, qachon"
        breadcrumbs={[{ label: "Audit log" }]}
        actions={
          hasPermission(ctx.roles, "export.run") ? (
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download from an API route, not a page navigation
            <a
              href="/api/export/audit"
              className="inline-flex h-9 items-center gap-1.5 rounded-[12px] border border-line bg-card px-3 text-xs font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand"
            >
              <Download className="h-3.5 w-3.5" /> CSV eksport
            </a>
          ) : undefined
        }
      />
      <DataTableToolbar
        searchPlaceholder="Amal nomi bo‘yicha (masalan: candidate.update)…"
        filters={[
          {
            key: "severity",
            label: "Daraja",
            options: [
              { value: "info", label: "Ma’lumot" },
              { value: "warning", label: "Ogohlantirish" },
              { value: "critical", label: "Muhim" },
            ],
          },
          {
            key: "entity",
            label: "Obyekt",
            options: [
              { value: "candidate", label: "Nomzod" },
              { value: "article", label: "Maqola" },
              { value: "monthly_update", label: "Oylik yangilanish" },
              { value: "monthly_update_token", label: "Token" },
              { value: "ranking_period", label: "Reyting" },
              { value: "application", label: "Ariza" },
              { value: "admin_user", label: "Admin" },
              { value: "auth", label: "Kirish/chiqish" },
              { value: "media", label: "Media" },
              { value: "site_settings", label: "Sozlamalar" },
            ],
          },
        ]}
      />
      <DataTable
        columns={columns}
        rows={rows}
        empty={
          <EmptyState
            icon={<ScrollText className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Audit yozuvlari yo‘q"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "Admin amallari avtomatik yoziladi."}
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/audit-log" params={{ q, ...filters }} />
    </>
  );
}
