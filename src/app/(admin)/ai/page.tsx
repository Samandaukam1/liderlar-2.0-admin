import { Sparkles } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/admin/data-table";
import { StatusBadge, Avatar } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate, formatNumber, isoDaysAgo } from "@/lib/utils";
import type { AiJob } from "@/lib/types";
import { AIPlayground } from "./ai-playground";

export const metadata = { title: "Jaxongir AI" };
export const dynamic = "force-dynamic";

interface AiJobRow extends AiJob {
  profiles?: { full_name: string; avatar_url: string | null } | null;
}

export default async function AIPage() {
  await requirePermission("ai.use");
  const admin = createSupabaseAdminClient();

  const monthAgo = isoDaysAgo(30);
  const [{ data: jobs, error }, succeeded, failed] = await Promise.all([
    admin
      .from("ai_jobs")
      .select("*, profiles(full_name, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(30),
    admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("status", "succeeded").gte("created_at", monthAgo),
    admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", monthAgo),
  ]);
  const rows = (jobs ?? []) as unknown as AiJobRow[];

  const columns: Column<AiJobRow>[] = [
    {
      key: "actor",
      header: "Admin",
      render: (j) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={j.profiles?.full_name ?? "—"} src={j.profiles?.avatar_url} size={30} />
          <span className="truncate text-sm font-semibold text-ink">{j.profiles?.full_name ?? "—"}</span>
        </span>
      ),
    },
    {
      key: "kind",
      header: "Vazifa",
      render: (j) => (
        <span className="text-xs text-ink-soft">
          {j.kind} · {j.entity_type ?? "—"}
        </span>
      ),
    },
    { key: "status", header: "Holat", render: (j) => <StatusBadge status={j.status} /> },
    {
      key: "size",
      header: "Hajm",
      desktopOnly: true,
      render: (j) => (
        <span className="text-xs text-ink-soft">
          {formatNumber(j.input_chars)} → {formatNumber(j.output_chars)} belgi
        </span>
      ),
    },
    {
      key: "time",
      header: "Vaqt",
      render: (j) => <span className="whitespace-nowrap text-xs text-ink-soft">{formatDate(j.created_at, true)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Jaxongir AI"
        description="Tahririy AI yordamchi — sinov maydoni va operatsiyalar jurnali"
        breadcrumbs={[{ label: "Jaxongir AI" }]}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="rounded-card border border-mint/40 bg-mint/8 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Muvaffaqiyatli (30 kun)</p>
          <p className="mt-1 font-display text-3xl font-semibold text-[#1d8a6b]">{succeeded.count ?? 0}</p>
        </div>
        <div className="rounded-card border border-coral/40 bg-coral/8 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Xatolik (30 kun)</p>
          <p className="mt-1 font-display text-3xl font-semibold text-[#c43d3d]">{failed.count ?? 0}</p>
        </div>
      </div>

      <Card className="mb-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink">
          <span className="ai-gradient flex h-7 w-7 items-center justify-center rounded-lg text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          Sinov maydoni
        </h2>
        <AIPlayground />
      </Card>

      <h2 className="mb-3 text-sm font-bold text-ink">So‘nggi AI operatsiyalari</h2>
      <DataTable
        columns={columns}
        rows={rows}
        empty={
          <EmptyState
            icon={<Sparkles className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "AI operatsiyalari yo‘q"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "Har bir AI chaqiruvi shu yerda qayd etiladi."}
          />
        }
      />
    </>
  );
}
