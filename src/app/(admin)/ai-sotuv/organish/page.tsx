import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { DataTable, type Column } from "@/components/admin/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { GraduationCap } from "lucide-react";
import {
  countOutcomes,
  findResumableDeepJob,
  getDeepLearningCoverage,
  getLatestDeepJob,
  getSalesDashboardStats,
  listIntents,
  listLearningJobs,
  listResponsePatterns,
  type LearningJobRow,
} from "@/lib/sales/repository";
import { SALES_OUTCOME_LABELS, type SalesOutcome } from "@/lib/sales/outcome";
import { formatCostUsd } from "@/lib/sales/cost";
import { getSalesSettings } from "@/lib/sales/settings";
import { LEARNING_JOB_KIND_LABELS, LEARNING_JOB_STATUS_LABELS } from "@/lib/sales/types";
import type { LearningJobKind, LearningJobStatus } from "@/lib/sales/types";
import { formatDate } from "@/lib/utils";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { RunLearningForm } from "./run-learning-form";
import { DeepLearningRunner } from "./deep-learning-runner";

export const metadata = { title: "AI Sotuv — O‘rganish" };
export const dynamic = "force-dynamic";
/**
 * Chuqur o'rganish server action'i shu route ostida ishlaydi va bitta
 * chaqiruvda bir necha batch'ni ishlaydi. Standart limit unga yetmaydi.
 * (Klient baribir tugagunicha qayta chaqiradi, ya'ni bu chegara —
 * "bitta bosqich uchun tom", butun yugurish uchun emas.)
 */
export const maxDuration = 300;

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

  const [stats, jobs, settings, coverage, deepJob, resumable, intents, objections, patterns, outcomes] =
    await Promise.all([
      getSalesDashboardStats(),
      listLearningJobs(20),
      getSalesSettings(),
      getDeepLearningCoverage(),
      getLatestDeepJob(),
      findResumableDeepJob(),
      listIntents({ kind: "question", limit: 20 }),
      listIntents({ kind: "objection", limit: 10 }),
      listResponsePatterns({ limit: 5 }),
      countOutcomes(),
    ]);

  const deepPercent =
    coverage.totalConversations > 0
      ? Math.round((coverage.deepLearned / coverage.totalConversations) * 1000) / 10
      : 0;

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

      {/* ---------------- CHUQUR O'RGANISH ---------------- */}
      <section className="mb-6 rounded-card border border-line bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
              Chuqur o‘rganilgan suhbatlar
            </p>
            <p className="mt-1 font-display text-[34px] font-semibold leading-none text-ink">
              {coverage.deepLearned} / {coverage.totalConversations}
            </p>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-semibold text-brand">
              {deepPercent.toFixed(1)}%
            </p>
            <p className="text-xs text-ink-soft">
              {coverage.deepLearnedMessages.toLocaleString("uz-UZ")} ta xabar o‘rganilgan
            </p>
          </div>
        </div>
        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-electric"
            style={{ width: `${Math.min(100, deepPercent)}%` }}
          />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">{stats.progress.scopeNote}</p>

        {deepJob ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                Oxirgi yugurish
              </dt>
              <dd className="font-semibold text-ink">
                {formatDate(deepJob.finishedAt ?? deepJob.startedAt, true)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                Ishlangan
              </dt>
              <dd className="font-semibold text-ink">
                {deepJob.processedConversations} / {deepJob.targetConversations} suhbat ·{" "}
                {deepJob.processedMessages.toLocaleString("uz-UZ")} xabar
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                Token
              </dt>
              <dd className="font-semibold text-ink">
                {deepJob.totalTokens.toLocaleString("uz-UZ")}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                Taxminiy narx
              </dt>
              <dd className="font-semibold text-ink">{formatCostUsd(deepJob.estimatedCostUsd)}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      {canLearn ? (
        <div className="mb-6">
          <DeepLearningRunner
            defaultTarget={settings.deepLearning.targetConversations}
            defaultBatchSize={settings.deepLearning.batchSize}
            resumableJobId={resumable?.id ?? null}
          />
        </div>
      ) : null}

      {/* ---------------- TAKRORLANISH STATISTIKASI ---------------- */}
      {intents.length > 0 || objections.length > 0 ? (
        <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-card border border-line bg-card p-5 lg:col-span-2">
            <h2 className="mb-3 font-display text-base font-semibold text-ink">
              Eng takroriy savollar
            </h2>
            {intents.length === 0 ? (
              <p className="text-sm text-ink-soft">Hali niyat aniqlanmadi.</p>
            ) : (
              <ol className="space-y-2">
                {intents.map((intent, i) => (
                  <li key={intent.id} className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-xs font-bold text-ink-soft">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                      {intent.label}
                      {!intent.isKnown ? (
                        <Badge accent="peach" className="ml-2">
                          yangi
                        </Badge>
                      ) : null}
                    </span>
                    <span className="w-40 shrink-0">
                      <span className="block h-1.5 overflow-hidden rounded-full bg-surface">
                        <span
                          className="block h-full rounded-full bg-brand"
                          style={{ width: `${Math.min(100, intent.share)}%` }}
                        />
                      </span>
                    </span>
                    <span className="w-20 shrink-0 text-right text-sm font-bold text-ink">
                      {intent.share.toFixed(1)}%
                    </span>
                    <span className="w-16 shrink-0 text-right text-xs text-ink-soft">
                      {intent.occurrences} ta
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-card border border-line bg-card p-5">
              <h2 className="mb-3 font-display text-base font-semibold text-ink">
                Eng ko‘p e’tirozlar
              </h2>
              {objections.length === 0 ? (
                <p className="text-sm text-ink-soft">E’tiroz aniqlanmadi.</p>
              ) : (
                <ul className="space-y-1.5">
                  {objections.map((objection) => (
                    <li key={objection.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-ink">{objection.label}</span>
                      <span className="shrink-0 text-xs font-bold text-ink-soft">
                        {objection.share.toFixed(1)}% · {objection.occurrences}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-card border border-line bg-card p-5">
              <h2 className="mb-3 font-display text-base font-semibold text-ink">
                Suhbat natijalari
              </h2>
              <ul className="space-y-1.5">
                {(Object.keys(SALES_OUTCOME_LABELS) as SalesOutcome[])
                  .filter((key) => outcomes[key] > 0)
                  .map((key) => (
                    <li key={key} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-ink">{SALES_OUTCOME_LABELS[key]}</span>
                      <span className="text-xs font-bold text-ink-soft">{outcomes[key]}</span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {patterns.length > 0 ? (
        <section className="mb-6 rounded-card border border-line bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold text-ink">
              Eng ko‘p ishlatilgan javoblar
            </h2>
            <Link href="/ai-sotuv/javoblar" className="text-xs font-semibold text-brand hover:underline">
              Barchasi →
            </Link>
          </div>
          <ul className="space-y-2">
            {patterns.map((pattern) => (
              <li key={pattern.id} className="rounded-[10px] bg-surface px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                  {pattern.intentLabel} · {pattern.frequency} marta ·{" "}
                  {pattern.successRate == null
                    ? "natija noma’lum"
                    : `${pattern.successRate.toFixed(1)}% muvaffaqiyat`}
                </p>
                <p className="mt-0.5 line-clamp-2 text-sm text-ink">{pattern.responseExample}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------------- 0.1 OQIMI (o'z holicha qoladi) ---------------- */}
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
