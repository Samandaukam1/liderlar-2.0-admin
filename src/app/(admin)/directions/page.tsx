import { Compass } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { EmptyState } from "@/components/ui/feedback";
import type { Category } from "@/lib/types";
import {
  ResourceDeleteButton,
  ResourceFormModal,
  type FieldSpec,
} from "@/components/admin/resource-form";

export const metadata = { title: "Yo‘nalishlar" };
export const dynamic = "force-dynamic";

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Nomi", type: "text", required: true, placeholder: "Ta’lim, IT, Tadbirkorlik…" },
  { name: "slug", label: "Slug", type: "text", hint: "Bo‘sh qoldirsangiz avtomatik" },
  {
    name: "color",
    label: "Rang",
    type: "select",
    options: [
      { value: "cyan", label: "Cyan" },
      { value: "mint", label: "Mint" },
      { value: "lavender", label: "Lavender" },
      { value: "peach", label: "Shaftoli" },
      { value: "rose", label: "Pushti" },
      { value: "sky", label: "Osmonrang" },
      { value: "lime", label: "Lime" },
    ],
  },
  { name: "sort_order", label: "Tartib", type: "number" },
];

const COLOR_DOTS: Record<string, string> = {
  cyan: "bg-cyan",
  mint: "bg-mint",
  lavender: "bg-lavender",
  peach: "bg-peach",
  rose: "bg-rose",
  sky: "bg-sky",
  lime: "bg-lime",
};

export default async function DirectionsPage() {
  const ctx = await requirePermission("taxonomy.view");
  const canManage = hasPermission(ctx.roles, "taxonomy.manage");
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("categories")
    .select("*")
    .order("sort_order");
  const rows = (data ?? []) as Category[];

  const { data: counts } = await admin
    .from("candidates")
    .select("category_id")
    .is("deleted_at", null)
    .not("category_id", "is", null);
  const countMap = new Map<string, number>();
  for (const c of (counts ?? []) as Array<{ category_id: string }>) {
    countMap.set(c.category_id, (countMap.get(c.category_id) ?? 0) + 1);
  }

  const columns: Column<Category>[] = [
    {
      key: "name",
      header: "Yo‘nalish",
      render: (c) => (
        <span className="flex items-center gap-2.5 text-sm font-bold text-ink">
          <span className={`h-3 w-3 rounded-full ${COLOR_DOTS[c.color ?? ""] ?? "bg-ink-soft/30"}`} />
          {c.name}
        </span>
      ),
    },
    { key: "slug", header: "Slug", desktopOnly: true, render: (c) => <code className="text-xs text-ink-soft">{c.slug}</code> },
    {
      key: "count",
      header: "Nomzodlar",
      render: (c) => <span className="text-sm font-semibold text-ink">{countMap.get(c.id) ?? 0}</span>,
    },
    { key: "order", header: "Tartib", desktopOnly: true, render: (c) => <span className="text-xs text-ink-soft">{c.sort_order}</span> },
    {
      key: "actions",
      header: "",
      className: "w-24 text-right",
      render: (c) =>
        canManage ? (
          <span className="flex items-center justify-end gap-1">
            <ResourceFormModal kind="categories" title="Yo‘nalishni tahrirlash" fields={FIELDS} record={c as unknown as Record<string, unknown> & { id: string }} trigger="icon" />
            <ResourceDeleteButton kind="categories" id={c.id} label="Yo‘nalish" />
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Yo‘nalishlar"
        description="Liderlar faoliyat yo‘nalishlari (kategoriyalar)"
        breadcrumbs={[{ label: "Yo‘nalishlar" }]}
        actions={canManage ? <ResourceFormModal kind="categories" title="Yangi yo‘nalish" fields={FIELDS} record={null} triggerLabel="Yangi yo‘nalish" /> : undefined}
      />
      <DataTable
        columns={columns}
        rows={rows}
        empty={
          <EmptyState
            icon={<Compass className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Yo‘nalishlar yo‘q"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "seed.sql standart yo‘nalishlarni yaratadi."}
          />
        }
      />
    </>
  );
}
