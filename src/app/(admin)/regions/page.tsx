import { MapPin } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { EmptyState } from "@/components/ui/feedback";
import type { Region } from "@/lib/types";
import {
  ResourceDeleteButton,
  ResourceFormModal,
  type FieldSpec,
} from "@/components/admin/resource-form";

export const metadata = { title: "Hududlar" };
export const dynamic = "force-dynamic";

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Nomi", type: "text", required: true },
  { name: "slug", label: "Slug", type: "text", hint: "Bo‘sh qoldirsangiz avtomatik" },
  { name: "sort_order", label: "Tartib", type: "number" },
];

export default async function RegionsPage() {
  const ctx = await requirePermission("taxonomy.view");
  const canManage = hasPermission(ctx.roles, "taxonomy.manage");
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.from("regions").select("*").order("sort_order");
  const rows = (data ?? []) as Region[];

  const { data: counts } = await admin
    .from("candidates")
    .select("region_id")
    .is("deleted_at", null)
    .not("region_id", "is", null);
  const countMap = new Map<string, number>();
  for (const c of (counts ?? []) as Array<{ region_id: string }>) {
    countMap.set(c.region_id, (countMap.get(c.region_id) ?? 0) + 1);
  }

  const columns: Column<Region>[] = [
    { key: "name", header: "Hudud", render: (r) => <span className="text-sm font-bold text-ink">{r.name}</span> },
    { key: "slug", header: "Slug", desktopOnly: true, render: (r) => <code className="text-xs text-ink-soft">{r.slug}</code> },
    { key: "count", header: "Nomzodlar", render: (r) => <span className="text-sm font-semibold text-ink">{countMap.get(r.id) ?? 0}</span> },
    {
      key: "actions",
      header: "",
      className: "w-24 text-right",
      render: (r) =>
        canManage ? (
          <span className="flex items-center justify-end gap-1">
            <ResourceFormModal kind="regions" title="Hududni tahrirlash" fields={FIELDS} record={r as unknown as Record<string, unknown> & { id: string }} trigger="icon" />
            <ResourceDeleteButton kind="regions" id={r.id} label="Hudud" />
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Hududlar"
        description="Viloyatlar va Toshkent shahri"
        breadcrumbs={[{ label: "Hududlar" }]}
        actions={canManage ? <ResourceFormModal kind="regions" title="Yangi hudud" fields={FIELDS} record={null} triggerLabel="Yangi hudud" /> : undefined}
      />
      <DataTable
        columns={columns}
        rows={rows}
        empty={
          <EmptyState
            icon={<MapPin className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Hududlar yo‘q"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "seed.sql barcha viloyatlarni yaratadi."}
          />
        }
      />
    </>
  );
}
