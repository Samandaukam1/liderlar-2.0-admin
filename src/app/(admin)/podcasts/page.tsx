import Link from "next/link";
import { Mic, CalendarDays } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import type { Podcast } from "@/lib/types";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { StatusBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate, truncate } from "@/lib/utils";
import { ResourceFormModal, ResourceDeleteButton } from "@/components/admin/resource-form";
import { PODCAST_FIELDS } from "./fields";

export const metadata = { title: "Podcastlar" };
export const dynamic = "force-dynamic";

export default async function PodcastsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("podcasts.view");
  const canManage = hasPermission(ctx.roles, "podcasts.manage");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["status"]);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("podcasts")
    .select("*", { count: "exact" })
    .order("starts_at", { ascending: false, nullsFirst: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (q) query = query.ilike("title", `%${q}%`);
  const [from, to] = listRange(page);
  const { data, count, error } = await query.range(from, to);
  const rows = (data ?? []) as Podcast[];

  const columns: Column<Podcast>[] = [
    {
      key: "title",
      header: "Podcast",
      render: (p) => (
        <span className="block min-w-0">
          <span className="block truncate text-sm font-bold text-ink">{truncate(p.title, 60)}</span>
          <span className="block truncate text-xs text-ink-soft">
            {p.host_name ? `Boshlovchi: ${p.host_name}` : truncate(p.description, 60)}
          </span>
        </span>
      ),
    },
    {
      key: "starts",
      header: "Vaqti",
      render: (p) => <span className="text-xs font-semibold text-ink">{formatDate(p.starts_at, true)}</span>,
    },
    {
      key: "place",
      header: "Joy / havola",
      desktopOnly: true,
      render: (p) => (
        <span className="text-xs text-ink-soft">
          {p.location ?? (p.online_url ? "Onlayn" : "—")}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
    {
      key: "actions",
      header: "",
      className: "w-24 text-right",
      render: (p) =>
        canManage ? (
          <span className="flex items-center justify-end gap-1">
            <ResourceFormModal
              kind="podcasts"
              title="Podcastni tahrirlash"
              fields={PODCAST_FIELDS}
              record={p as unknown as Record<string, unknown> & { id: string }}
              trigger="icon"
            />
            <ResourceDeleteButton kind="podcasts" id={p.id} label="Podcast" />
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Podcastlar"
        description="Liderlar bilan suhbatlar — rejalashtirish va nashr"
        breadcrumbs={[{ label: "Podcastlar" }]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/podcast-calendar"
              className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-line bg-card px-4 text-sm font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand"
            >
              <CalendarDays className="h-4 w-4" /> Taqvim
            </Link>
            {canManage && (
              <ResourceFormModal kind="podcasts" title="Yangi podcast" fields={PODCAST_FIELDS} record={null} triggerLabel="Yangi podcast" />
            )}
          </div>
        }
      />
      <DataTableToolbar
        searchPlaceholder="Mavzu bo‘yicha…"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "planned", label: "Rejada" },
              { value: "announced", label: "E’lon qilingan" },
              { value: "recorded", label: "Yozib olingan" },
              { value: "published", label: "Nashr etilgan" },
              { value: "cancelled", label: "Bekor qilingan" },
            ],
          },
        ]}
      />
      <DataTable
        columns={columns}
        rows={rows}
        empty={
          <EmptyState
            icon={<Mic className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Podcastlar yo‘q"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "Birinchi podcastni rejalashtiring."}
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/podcasts" params={{ q, ...filters }} />
    </>
  );
}
