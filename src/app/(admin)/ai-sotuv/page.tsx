import Link from "next/link";
import {
  MessagesSquare,
  MessageSquare,
  UserPlus,
  GraduationCap,
  BookMarked,
  Clock,
  Radio,
} from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/cards";
import { getSalesDashboardStats } from "@/lib/sales/repository";
import { formatDate } from "@/lib/utils";
import { LEARNING_JOB_STATUS_LABELS, type LearningJobStatus } from "@/lib/sales/types";
import { LEARNING_SCOPE_TITLE } from "@/lib/sales/progress";
import { SalesTabs, NoAutoReplyNotice } from "./sales-tabs";

export const metadata = { title: "AI Sotuv" };
export const dynamic = "force-dynamic";

export default async function SalesDashboardPage() {
  await requirePermission("sales.view");
  const stats = await getSalesDashboardStats();

  return (
    <div>
      <PageHeader
        title="AI Sotuv"
        description="Telegram Business chatlarini yig‘ish, tahlil qilish va o‘rganish."
        breadcrumbs={[{ label: "AI Sotuv" }]}
      />
      <SalesTabs active="dashboard" />
      <NoAutoReplyNotice />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Jami suhbatlar"
          value={stats.conversations}
          icon={MessagesSquare}
          accent="cyan"
          href="/ai-sotuv/suhbatlar"
        />
        <StatCard
          label="Yangi chatlar (7 kun)"
          value={stats.newConversations7d}
          icon={UserPlus}
          accent="mint"
        />
        <StatCard
          label="Jami xabarlar"
          value={stats.messages}
          icon={MessageSquare}
          accent="sky"
        />
        <StatCard
          label="O‘rganilgan suhbatlar"
          value={stats.progress.learned}
          icon={GraduationCap}
          accent="lavender"
          href="/ai-sotuv/organish"
        />
      </section>

      {/* O'rganish progressi — maxraj DOIM ko'rinib turadi. */}
      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-card border border-line bg-card p-5 shadow-card lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
                {LEARNING_SCOPE_TITLE}
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
              className="h-full rounded-full bg-gradient-to-r from-brand to-electric transition-all"
              style={{ width: `${Math.min(100, stats.progress.percent)}%` }}
            />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ["O‘rganilgan", stats.progress.learned],
              ["Navbatda", stats.progress.pending],
              ["O‘tkazilgan", stats.progress.skipped],
              ["Xatolik", stats.progress.failed],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                  {label}
                </dt>
                <dd className="mt-0.5 font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          {/* Talab 4: yolg'on "hammasi o'rganildi" degan xabar bermaslik. */}
          <p className="mt-4 text-xs leading-relaxed text-ink-soft">{stats.progress.scopeNote}</p>
        </div>

        <div className="flex flex-col gap-4">
          <StatCard
            label="Bilim bazasi"
            value={stats.knowledgeTotal}
            icon={BookMarked}
            accent="peach"
            href="/ai-sotuv/knowledge"
          />
          <div className="rounded-card border border-line bg-card p-5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
              <Clock className="h-3.5 w-3.5" />
              Oxirgi o‘rganish
            </div>
            <p className="mt-1 text-lg font-bold text-ink">
              {stats.lastLearningRunAt ? formatDate(stats.lastLearningRunAt, true) : "Hali yo‘q"}
            </p>
            {stats.lastLearningStatus ? (
              <p className="mt-1 text-xs text-ink-soft">
                Holat:{" "}
                {LEARNING_JOB_STATUS_LABELS[stats.lastLearningStatus as LearningJobStatus] ??
                  stats.lastLearningStatus}
              </p>
            ) : null}
            <Link
              href="/ai-sotuv/organish"
              className="mt-3 inline-block text-xs font-semibold text-brand hover:underline"
            >
              O‘rganish tarixi →
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Mijozlar" value={stats.contacts} icon={UserPlus} accent="rose" />
        <StatCard
          label="Kiruvchi xabarlar"
          value={stats.incomingMessages}
          icon={MessageSquare}
          accent="sky"
        />
        <StatCard
          label="Chiquvchi xabarlar"
          value={stats.outgoingMessages}
          icon={MessageSquare}
          accent="lime"
        />
        <StatCard
          label="Aktiv ulanishlar"
          value={stats.activeConnections}
          icon={Radio}
          accent="green"
          href="/ai-sotuv/sozlamalar"
        />
      </section>
    </div>
  );
}
