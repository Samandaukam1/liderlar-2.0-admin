import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { cn } from "@/lib/utils";
import { INTAKE_TABS } from "@/lib/intake/constants";
import {
  getBatchProgress,
  getLatestBatchId,
  loadTodayPublishQueue,
} from "@/lib/intake/publish-batch";
import { PublishQueueClient } from "./queue-client";

export const metadata = { title: "Chop etishga tayyorlar" };
// Every render recomputes "today" in Asia/Tashkent, so a panel left open past
// midnight rolls over to the new day instead of serving a cached yesterday.
export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "ready", label: "Chop etishga tayyorlar" },
  { key: "unpaid", label: "To‘lov qilmaganlar" },
] as const;

export default async function PublishQueuePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("intakes.view");
  const sp = await props.searchParams;
  const view = sp.view === "unpaid" ? "unpaid" : "ready";

  const queue = await loadTodayPublishQueue();

  // The panel opens already watching the most recent batch, so a reload during
  // a long run does not lose the progress view.
  const latestBatchId = await getLatestBatchId();
  const initialProgress = latestBatchId ? await getBatchProgress(latestBatchId) : null;

  const canPublish = ctx.permissions.has("intakes.publish");
  const canAskPayment = ctx.permissions.has("intakes.review");

  return (
    <>
      <PageHeader
        title="Chop etishga tayyorlar"
        description={`Bugun (${queue.summary.date}, Toshkent) yuborilgan anketalar — to‘lov, nashr va Telegram oqimi`}
        breadcrumbs={[
          { label: "Nomzod anketalari", href: "/nomzodlar/anketalar" },
          { label: "Chop etishga tayyorlar" },
        ]}
        actions={
          <Link
            href="/nomzodlar/yangi"
            className="inline-flex h-10 items-center gap-2 rounded-[14px] bg-gradient-to-r from-brand to-electric px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(22,119,255,0.28)] transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Yangi nomzod
          </Link>
        }
      />

      {/* Tabs — the pipeline tabs plus this board's two views. */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        <Link
          href="/nomzodlar/anketalar"
          className="shrink-0 rounded-full border border-line bg-card px-3.5 py-1.5 text-sm font-semibold text-ink-soft transition hover:border-brand/40 hover:text-ink"
        >
          {INTAKE_TABS[0].label}
        </Link>
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/nomzodlar/anketalar/chop-etishga-tayyorlar?view=${v.key}`}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition",
              v.key === view
                ? "border-brand bg-brand text-white"
                : "border-line bg-card text-ink-soft hover:border-brand/40 hover:text-ink",
            )}
          >
            {v.label}
            {v.key === "unpaid" && queue.summary.unpaid + queue.summary.unknown > 0 ? (
              <span className="ml-1.5 opacity-70">
                {queue.summary.unpaid + queue.summary.unknown}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      <PublishQueueClient
        rows={queue.rows}
        summary={queue.summary}
        view={view}
        initialProgress={initialProgress}
        canPublish={canPublish}
        canAskPayment={canAskPayment}
      />
    </>
  );
}
