import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { DataTable, type Column } from "@/components/admin/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { GraduationCap } from "lucide-react";
import { getSalesDashboardStats, listLearningJobs, type LearningJobRow } from "@/lib/sales/repository";
import { getSalesSettings } from "@/lib/sales/settings";
import { LEARNING_JOB_KIND_LABELS, LEARNING_JOB_STATUS_LABELS } from "@/lib/sales/types";
import type { LearningJobKind, LearningJobStatus } from "@/lib/sales/types";
import { formatDate } from "@/lib/utils";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { RunLearningForm } from "./run-learning-form";

export const metadata = { title: "AI Sotuv — O‘rganish" };
export const dynamic = "force-dynamic";

const JOB_ACCENT: Record<string, "mint" | "cyan" | "coral" | "peach" | "neutral"> = {
  succeeded: "mint",
  running: "cyan",
  queued: "neutral",
  failed: "coral",
  partial: "peach",
};

export default async function SalesLearningPage() {
  const ctx = await requirePermission("sales.view");
  const canLearn = hasPermission(ctx.roles, "sales.learn");

  const [stats, jobs, settings] = await Promise.all([
    getSalesDashboardStats(),
    listLearningJobs(20),
    getSalesSettings(),
  ]);

  const columns: Column<LearningJobRow>[] = [
    {
      key: "started",
      header: "Boshlangan",
      render: (row) => (
        <span className="text-sm text-ink">{formatDate(row.startedAt ?? row.createdAt, true)}</span>
      ),
    },
    {
      key: "kind",
      header: "Turi",
      render: (row) => (
        <Badge accent="lavender">
          {LEARNING_JOB_KIND_LABELS[row.kind as LearningJobKind] ?? row.kind}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Holat",
      render: (row) => (
        <Badge accent={JOB_ACCENT[row.status] ?? "neutral"}>
          {LEARNING_JOB_STATUS_LABELS[row.status as LearningJobStatus] ?? row.status}
        </Badge>
      ),
    },
    {
      key: "processed",
      header: "Suhbat",
      desktopOnly: true,
      render: (row) => (
        <span className="text-sm text-ink-soft">
          {/* Yugurish boshidagi maxraj bilan: "shu paytda nechtadan nechtasi". */}
          <b className="text-ink">{row.processedConversations}</b> / {row.selectedConversations}
          <span className="ml-1 text-xs">(bazada {row.totalConversations} ta)</span>
        </span>
      ),
    },
    {
      key: "knowledge",
      header: "Yangi bilim",
      desktopOnly: true,
      render: (row) => <span className="text-sm text-ink">{row.knowledgeCreated}</span>,
    },
    {
      key: "error",
      header: "Xato",
      desktopOnly: true,
      render: (row) =>
        row.error ? (
          <span className="line-clamp-2 text-xs text-coral">{row.error}</span>
        ) : (
          <span className="text-xs text-ink-soft">—</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="O‘rganish"
        description="Saqlangan suhbatlardan fakt va uslub o‘rganish."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "O‘rganish" }]}
      />
      <SalesTabs active="learning" />
      <NoAutoReplyNotice />

      <section className="mb-6 rounded-card border border-line bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
              O‘rganilgan suhbatlar
            </p>
            <p className="mt-1 font-display text-[34px] font-semibold leading-none text-ink">
              {stats.progress.label}
            </p>
          </div>
          <p className="font-display text-2xl font-semibold text-brand">
            {stats.progress.percentLabel}
          </p>
        </div>
        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-electric"
            style={{ width: `${Math.min(100, stats.progress.percent)}%` }}
          />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">{stats.progress.scopeNote}</p>
      </section>

      {canLearn ? (
        <div className="mb-6">
          <RunLearningForm batchSize={settings.learning.batchSize} />
        </div>
      ) : (
        <p className="mb-6 rounded-card border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
          O‘rganishni ishga tushirish uchun <b>sales.learn</b> ruxsati kerak.
        </p>
      )}

      <h2 className="mb-3 font-display text-lg font-semibold text-ink">Yugurishlar tarixi</h2>
      <DataTable
        columns={columns}
        rows={jobs}
        empty={
          <EmptyState
            icon={<GraduationCap className="h-7 w-7" />}
            title="Hali o‘rganish bo‘lmagan"
            description="Suhbatlar yig‘ilgach, “O‘rganishni boshlash” tugmasi orqali birinchi yugurishni ishga tushiring."
          />
        }
      />
    </div>
  );
}
