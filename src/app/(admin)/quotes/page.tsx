import { Quote as QuoteIcon } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge, Avatar, Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import type { Quote } from "@/lib/types";
import {
  ResourceDeleteButton,
  ResourceFormModal,
  type FieldSpec,
} from "@/components/admin/resource-form";

export const metadata = { title: "Iqtiboslar" };
export const dynamic = "force-dynamic";

const ACCENT_OPTIONS = [
  { value: "cyan", label: "Cyan" },
  { value: "rose", label: "Pushti" },
  { value: "mint", label: "Mint" },
  { value: "lavender", label: "Lavender" },
  { value: "peach", label: "Shaftoli" },
];

const QUOTE_CARD_BG: Record<string, string> = {
  cyan: "from-navy-deep to-brand",
  rose: "from-[#8a2c60] to-rose",
  mint: "from-[#0e5c46] to-mint",
  lavender: "from-[#3d2d80] to-lavender",
  peach: "from-[#8a4a1a] to-peach",
};

export default async function QuotesPage() {
  const ctx = await requirePermission("quotes.view");
  const canManage = hasPermission(ctx.roles, "quotes.manage");
  const admin = createSupabaseAdminClient();

  const [{ data, error }, { data: candidates }] = await Promise.all([
    admin
      .from("quotes")
      .select("*, candidates(full_name, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(100),
    admin.from("candidates").select("id, full_name").is("deleted_at", null).order("full_name").limit(500),
  ]);
  const quotes = (data ?? []) as unknown as Quote[];

  const quoteFields: FieldSpec[] = [
    { name: "text", label: "Iqtibos matni", type: "textarea", required: true },
    {
      name: "candidate_id",
      label: "Nomzod",
      type: "select",
      options: (candidates ?? []).map((c: { id: string; full_name: string }) => ({
        value: c.id,
        label: c.full_name,
      })),
    },
    { name: "author_name", label: "Muallif (nomzod bo‘lmasa)", type: "text" },
    { name: "accent", label: "Rang aksenti", type: "select", options: ACCENT_OPTIONS },
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
    { name: "is_featured", label: "Bosh sahifada ko‘rsatish", type: "checkbox" },
  ];

  return (
    <>
      <PageHeader
        title="Iqtiboslar"
        description="Liderlarning motivatsion iqtiboslari — sayt quote kartalari"
        breadcrumbs={[{ label: "Iqtiboslar" }]}
        actions={
          canManage ? (
            <ResourceFormModal kind="quotes" title="Yangi iqtibos" fields={quoteFields} record={null} triggerLabel="Yangi iqtibos" />
          ) : undefined
        }
      />

      {quotes.length === 0 ? (
        <EmptyState
          icon={<QuoteIcon className="h-7 w-7" />}
          title={error ? "Jadval topilmadi" : "Iqtiboslar yo‘q"}
          description={error ? "Supabase migrationlarni ishga tushiring." : "Birinchi iqtibosni qo‘shing."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {quotes.map((q) => {
            const author = q.candidates?.full_name ?? q.author_name ?? "Liderlar.uz";
            return (
              <article
                key={q.id}
                className={`flex flex-col overflow-hidden rounded-card bg-gradient-to-br p-6 text-white shadow-card ${QUOTE_CARD_BG[q.accent ?? "cyan"] ?? QUOTE_CARD_BG.cyan}`}
              >
                <p className="font-display text-5xl leading-none text-white/40">“</p>
                <p className="mt-1 flex-1 text-[15px] font-semibold leading-relaxed">{q.text}</p>
                <div className="mt-5 flex items-center gap-3 border-t border-white/20 pt-4">
                  <Avatar name={author} src={q.candidates?.avatar_url} size={36} />
                  <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold uppercase tracking-wider">
                    {author}
                  </span>
                  <StatusBadge status={q.status} />
                  {q.is_featured && <Badge accent="amber">Featured</Badge>}
                </div>
                {canManage && (
                  <div className="mt-3 flex items-center justify-end gap-1 rounded-xl bg-white/10 p-1">
                    <ResourceFormModal
                      kind="quotes"
                      title="Iqtibosni tahrirlash"
                      fields={quoteFields}
                      record={q as unknown as Record<string, unknown> & { id: string }}
                      trigger="icon"
                    />
                    <ResourceDeleteButton kind="quotes" id={q.id} label="Iqtibos" />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
