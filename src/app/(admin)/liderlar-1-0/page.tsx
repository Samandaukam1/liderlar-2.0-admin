import Link from "next/link";
import { History, ExternalLink, Pencil } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { Badge, CandidateMiniCard, StatusBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/utils";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Liderlar 1.0 arxivi.
 *
 * 1991 ta yozuv bor, shuning uchun sahifa TO'LIQ server tomonda ishlaydi:
 * qidiruv, filtr va sahifalash URL searchParam'lari orqali SQL'ga tushadi va
 * brauzerga bir vaqtning o'zida faqat bitta sahifa (PAGE_SIZE ta qator)
 * keladi. Butun ro'yxatni yuklab, keyin front-endda filtrlash bu yerda
 * qasddan qilinmagan.
 */

export const metadata = { title: "Liderlar 1.0 postlari" };
export const dynamic = "force-dynamic";

interface LegacyRow {
  id: string;
  legacy_source_id: string;
  legacy_slug: string;
  legacy_path: string;
  title: string;
  summary: string | null;
  cover_image_url: string | null;
  legacy_created_at: string | null;
  legacy_status: string;
  legacy_categories: string[];
  candidate_id: string | null;
}

export default async function LegacyPostsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("candidates.view");
  const canEdit = hasPermission(ctx.roles, "candidates.edit");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["status", "category", "image", "date"]);
  const admin = createSupabaseAdminClient();
  const siteUrl = getSiteUrl();

  let query = admin
    .from("legacy_posts")
    .select(
      "id, legacy_source_id, legacy_slug, legacy_path, title, summary, cover_image_url, " +
        "legacy_created_at, legacy_status, legacy_categories, candidate_id",
      { count: "exact" },
    )
    .is("deleted_at", null)
    // Manbadagi sanasi bo'lmagan yozuv oxirida turadi — u ro'yxat boshini
    // egallab, haqiqiy eng yangi maqolalarni pastga surib yubormaydi.
    .order("legacy_created_at", { ascending: false, nullsFirst: false });

  if (filters.status) query = query.eq("legacy_status", filters.status);
  // Kategoriya massiv ustunda saqlanadi (CSV'da ";" bilan ajratilgan).
  if (filters.category) query = query.contains("legacy_categories", [filters.category]);
  if (filters.image === "missing") query = query.is("cover_image_url", null);
  if (filters.date === "missing") query = query.is("legacy_created_at", null);
  if (q) {
    query = query.or(
      `title.ilike.%${q}%,legacy_slug.ilike.%${q}%,legacy_source_id.ilike.%${q}%`,
    );
  }

  const [from, to] = listRange(page);
  const { data, count, error } = await query.range(from, to);
  const rows = (data ?? []) as unknown as LegacyRow[];

  // Filtr ro'yxati mavjud kategoriyalardan yig'iladi — qo'lda yozilgan ro'yxat
  // manbadagi qiymatlardan chetga chiqib ketardi.
  const { data: categoryRows } = await admin
    .from("legacy_posts")
    .select("legacy_categories")
    .is("deleted_at", null)
    .not("legacy_categories", "eq", "{}")
    .limit(500);
  const categories = [
    ...new Set(
      (categoryRows ?? []).flatMap((r) => (r.legacy_categories as string[] | null) ?? []),
    ),
  ].sort((a, b) => a.localeCompare(b, "uz"));

  const columns: Column<LegacyRow>[] = [
    {
      key: "name",
      header: "F.I.Sh.",
      render: (row) => (
        <CandidateMiniCard
          name={row.title}
          avatarUrl={row.cover_image_url}
          meta={row.legacy_source_id}
        />
      ),
    },
    {
      key: "slug",
      header: "Legacy slug",
      desktopOnly: true,
      render: (row) => (
        <span className="font-mono text-xs text-ink-soft">{row.legacy_slug}</span>
      ),
    },
    {
      key: "url",
      header: "Eski URL",
      desktopOnly: true,
      render: (row) => (
        <span className="font-mono text-xs text-ink-soft">{row.legacy_path}</span>
      ),
    },
    {
      key: "date",
      header: "Qo‘shilgan sana",
      render: (row) =>
        row.legacy_created_at ? (
          <span className="text-xs text-ink-soft">{formatDate(row.legacy_created_at)}</span>
        ) : (
          // Manbada sana yo'q — import sanasi bu yerga hech qachon qo'yilmaydi.
          <span className="text-xs text-ink-soft/60">noma’lum</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.legacy_status} />,
    },
    {
      key: "category",
      header: "Yo‘nalish",
      desktopOnly: true,
      render: (row) =>
        row.legacy_categories.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {row.legacy_categories.map((category) => (
              <Badge key={category} accent="sky">
                {category}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-ink-soft">—</span>
        ),
    },
    {
      key: "actions",
      header: "Amallar",
      render: (row) => (
        <span className="flex items-center gap-2">
          <a
            href={`${siteUrl}${row.legacy_path}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink-soft transition hover:border-brand hover:text-brand"
          >
            Ko‘rish <ExternalLink className="h-3 w-3" />
          </a>
          {canEdit && (
            <Link
              href={`/liderlar-1-0/${row.id}`}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink-soft transition hover:border-brand hover:text-brand"
            >
              Tahrirlash <Pencil className="h-3 w-3" />
            </Link>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Liderlar 1.0 postlari"
        description="Eski saytdan import qilingan arxiv. Eski havolalar /nomzodlar/… manzilida ishlashda davom etadi."
        breadcrumbs={[{ label: "Nomzodlar" }, { label: "Liderlar 1.0 postlari" }]}
      />

      <DataTableToolbar
        searchPlaceholder="F.I.Sh., slug yoki Post ID bo‘yicha qidirish…"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "published", label: "Chop etilgan" },
              { value: "draft", label: "Qoralama" },
            ],
          },
          {
            key: "category",
            label: "Yo‘nalish",
            options: categories.map((name) => ({ value: name, label: name })),
          },
          {
            key: "image",
            label: "Rasm",
            options: [{ value: "missing", label: "Rasmsiz" }],
          },
          {
            key: "date",
            label: "Sana",
            options: [{ value: "missing", label: "Sanasi noma’lum" }],
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        empty={
          <EmptyState
            icon={<History className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Arxiv bo‘sh"}
            description={
              error
                ? "legacy_posts migrationini ishga tushiring (supabase/README.md)."
                : q || Object.keys(filters).length
                  ? "Qidiruv yoki filtrga mos yozuv yo‘q."
                  : "Import hali bajarilmagan: node scripts/import-legacy-feed.ts --apply --file <csv>"
            }
          />
        }
      />

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        basePath="/liderlar-1-0"
        params={{ q, ...filters }}
      />
    </>
  );
}
