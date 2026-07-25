import { BookOpen, Download, Star } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge, Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate, formatNumber } from "@/lib/utils";
import type { Journal } from "@/lib/types";
import {
  ResourceDeleteButton,
  ResourceFormModal,
  type FieldSpec,
} from "@/components/admin/resource-form";

export const metadata = { title: "Liderlar Online" };
export const dynamic = "force-dynamic";

const JOURNAL_FIELDS: FieldSpec[] = [
  { name: "issue_number", label: "Son raqami", type: "number", required: true },
  { name: "title", label: "Sarlavha", type: "text", required: true },
  { name: "description", label: "Tavsif", type: "textarea" },
  { name: "published_at", label: "Nashr sanasi", type: "date" },
  {
    name: "status",
    label: "Status",
    type: "select",
    required: true,
    options: [
      { value: "draft", label: "Qoralama" },
      { value: "published", label: "Nashr etilgan" },
    ],
  },
  { name: "is_featured", label: "Featured (bosh sahifada)", type: "checkbox" },
  { name: "cover_url", label: "Muqova", type: "upload", bucket: "journal-covers" },
  { name: "pdf_url", label: "PDF fayl", type: "upload", bucket: "journal-pdfs" },
];

export default async function JournalsPage() {
  const ctx = await requirePermission("journals.view");
  const canManage = hasPermission(ctx.roles, "journals.manage");
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("journals")
    .select("*")
    .order("issue_number", { ascending: false });
  const journals = (data ?? []) as Journal[];

  const { data: articleCounts } = await admin
    .from("journal_articles")
    .select("journal_id");
  const countByJournal = new Map<string, number>();
  for (const row of (articleCounts ?? []) as Array<{ journal_id: string }>) {
    countByJournal.set(row.journal_id, (countByJournal.get(row.journal_id) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Liderlar Online"
        description="Onlayn jurnal sonlari — muqova, PDF va nashr holati"
        breadcrumbs={[{ label: "Liderlar Online" }]}
        actions={
          canManage ? (
            <ResourceFormModal kind="journals" title="Yangi jurnal soni" fields={JOURNAL_FIELDS} record={null} triggerLabel="Yangi son" />
          ) : undefined
        }
      />

      {journals.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-7 w-7" />}
          title={error ? "Jadval topilmadi" : "Jurnal sonlari yo‘q"}
          description={error ? "Supabase migrationlarni ishga tushiring." : "Birinchi jurnal sonini yarating."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {journals.map((j) => (
            <article key={j.id} className="overflow-hidden rounded-card border border-line bg-card shadow-card transition hover:shadow-card-hover">
              <div className="relative aspect-[4/3] bg-gradient-to-br from-navy-deep to-brand">
                {j.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={j.cover_url} alt={j.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center">
                    <span className="font-display text-xl font-semibold uppercase tracking-wide text-white">
                      Liderlar Online №{j.issue_number}
                    </span>
                  </div>
                )}
                {j.is_featured && (
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-badge bg-amber/90 px-2 py-0.5 text-[11px] font-bold text-white">
                    <Star className="h-3 w-3" /> Featured
                  </span>
                )}
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold uppercase tracking-wide text-ink">
                      №{j.issue_number} · {j.title}
                    </p>
                    <p className="text-xs text-ink-soft">{formatDate(j.published_at)}</p>
                  </div>
                  <StatusBadge status={j.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge accent="sky">{countByJournal.get(j.id) ?? 0} ta maqola</Badge>
                  <Badge accent="mint">
                    <Download className="h-3 w-3" /> {formatNumber(j.downloads_count)} yuklab olish
                  </Badge>
                </div>
                {canManage && (
                  <div className="mt-4 flex items-center justify-end gap-1 border-t border-line/60 pt-3">
                    <ResourceFormModal
                      kind="journals"
                      title={`№${j.issue_number} sonni tahrirlash`}
                      fields={JOURNAL_FIELDS}
                      record={j as unknown as Record<string, unknown> & { id: string }}
                      trigger="icon"
                    />
                    <ResourceDeleteButton kind="journals" id={j.id} label="Jurnal soni" />
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
