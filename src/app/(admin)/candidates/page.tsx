import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import type { Candidate, Category, Region } from "@/lib/types";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { CandidateMiniCard, StatusBadge, Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { daysUntil, formatDate } from "@/lib/utils";

export const metadata = { title: "Nomzodlar" };
export const dynamic = "force-dynamic";

export default async function CandidatesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("candidates.view");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["status", "region", "category"]);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("candidates")
    .select("id,integration_key,slug,full_name,short_bio,avatar_url,status,is_top100,top100_position,next_update_due_at,created_at,updated_at,deleted_at,regions(name),categories(name,color)", { count: "exact" })
    .order("created_at", { ascending: false });

  if (filters.status === "archived") {
    query = query.eq("status", "archived");
  } else {
    query = query.is("deleted_at", null);
    if (filters.status) query = query.eq("status", filters.status);
  }
  if (filters.region) query = query.eq("region_id", filters.region);
  if (filters.category) query = query.eq("category_id", filters.category);
  if (q) query = query.or(`full_name.ilike.%${q}%,slug.ilike.%${q}%`);

  const [from, to] = listRange(page);
  const [{ data, count, error }, { data: regions }, { data: categories }] = await Promise.all([
    query.range(from, to),
    admin.from("regions").select("id, name").order("sort_order"),
    admin.from("categories").select("id, name").order("sort_order"),
  ]);
  const rows = (data ?? []) as unknown as Candidate[];

  const columns: Column<Candidate>[] = [
    {
      key: "name",
      header: "Nomzod",
      render: (c) => (
        <CandidateMiniCard
          name={c.full_name}
          avatarUrl={c.avatar_url}
          meta={`/${c.slug}`}
        />
      ),
    },
    {
      key: "category",
      header: "Yo‘nalish",
      desktopOnly: true,
      render: (c) =>
        c.categories?.name ? <Badge accent="sky">{c.categories.name}</Badge> : <span className="text-ink-soft">—</span>,
    },
    {
      key: "region",
      header: "Hudud",
      desktopOnly: true,
      render: (c) => <span className="text-ink-soft">{c.regions?.name ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (c) => <StatusBadge status={c.status} />,
    },
    {
      key: "due",
      header: "30 kunlik yangilash",
      render: (c) => {
        if (c.status !== "published") return <span className="text-ink-soft">—</span>;
        const days = daysUntil(c.next_update_due_at);
        if (days == null) return <span className="text-ink-soft">—</span>;
        if (days < 0) return <Badge accent="coral">{Math.abs(days)} kun kechikkan</Badge>;
        if (days <= 5) return <Badge accent="lavender">{days} kun qoldi</Badge>;
        return <span className="text-xs text-ink-soft">{formatDate(c.next_update_due_at)}</span>;
      },
    },
    {
      key: "created",
      header: "Yaratilgan",
      desktopOnly: true,
      render: (c) => <span className="text-xs text-ink-soft">{formatDate(c.created_at)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Nomzodlar"
        description="Lider profillari — yaratish, tahrirlash va nashr boshqaruvi"
        breadcrumbs={[{ label: "Nomzodlar" }]}
        actions={
          <Link
            href="/candidates/new"
            className="inline-flex h-10 items-center gap-2 rounded-[14px] bg-gradient-to-r from-brand to-electric px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(22,119,255,0.28)] transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Yangi nomzod
          </Link>
        }
      />

      <DataTableToolbar
        searchPlaceholder="Ism yoki slug bo‘yicha qidirish…"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "draft", label: "Qoralama" },
              { value: "intake", label: "Anketa qabul qilindi" },
              { value: "ai_processing", label: "AI qayta ishlamoqda" },
              { value: "review", label: "Tekshiruvda" },
              { value: "published", label: "Nashr etilgan" },
              { value: "rejected", label: "Rad etilgan" },
              { value: "archived", label: "Arxivlangan" },
            ],
          },
          {
            key: "region",
            label: "Hudud",
            options: (regions ?? []).map((r: Pick<Region, "id" | "name">) => ({
              value: r.id,
              label: r.name,
            })),
          },
          {
            key: "category",
            label: "Yo‘nalish",
            options: (categories ?? []).map((c: Pick<Category, "id" | "name">) => ({
              value: c.id,
              label: c.name,
            })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowHref={(c) => `/candidates/${c.id}`}
        empty={
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Nomzodlar topilmadi"}
            description={
              error
                ? "Supabase migrationlarni ishga tushiring (supabase/README.md)."
                : q || Object.keys(filters).length
                  ? "Qidiruv yoki filtrga mos nomzod yo‘q."
                  : "Birinchi lider profilini yarating."
            }
          />
        }
      />

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        basePath="/candidates"
        params={{ q, ...filters }}
      />
    </>
  );
}
