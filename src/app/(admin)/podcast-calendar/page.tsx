import Link from "next/link";
import { ChevronLeft, ChevronRight, Mic } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/badges";
import { cn, formatDate } from "@/lib/utils";
import type { Podcast } from "@/lib/types";

export const metadata = { title: "Podcast taqvimi" };
export const dynamic = "force-dynamic";

const STATUS_DOTS: Record<string, string> = {
  planned: "bg-lavender",
  announced: "bg-cyan",
  live: "bg-coral",
  recorded: "bg-sky",
  published: "bg-mint",
  cancelled: "bg-coral/60",
};

export default async function PodcastCalendarPage(props: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requirePermission("podcasts.view");
  const sp = await props.searchParams;

  const now = new Date();
  const [yearStr, monthStr] = (sp.month ?? "").split("-");
  const year = parseInt(yearStr, 10) || now.getFullYear();
  const month = (parseInt(monthStr, 10) || now.getMonth() + 1) - 1;

  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 1));
  const prev = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));
  const fmtMonth = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("podcasts")
    .select("id, title, starts_at, status, location, online_url")
    .gte("starts_at", monthStart.toISOString())
    .lt("starts_at", monthEnd.toISOString())
    .order("starts_at");
  const podcasts = (data ?? []) as Podcast[];

  const byDay = new Map<number, Podcast[]>();
  for (const p of podcasts) {
    if (!p.starts_at) continue;
    const day = new Date(p.starts_at).getDate();
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first offset
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const monthLabel = new Intl.DateTimeFormat("uz-UZ", { month: "long", year: "numeric" }).format(
    new Date(year, month, 1),
  );

  return (
    <>
      <PageHeader
        title="Podcast taqvimi"
        breadcrumbs={[{ label: "Podcastlar", href: "/podcasts" }, { label: "Taqvim" }]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/podcast-calendar?month=${fmtMonth(prev)}`}
              aria-label="Oldingi oy"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-card transition hover:border-brand/50"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="min-w-40 text-center font-display text-lg font-semibold uppercase tracking-wide text-ink">
              {monthLabel}
            </span>
            <Link
              href={`/podcast-calendar?month=${fmtMonth(next)}`}
              aria-label="Keyingi oy"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-card transition hover:border-brand/50"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      {/* Month grid (desktop) */}
      <div className="hidden overflow-hidden rounded-card border border-line bg-card shadow-card md:block">
        <div className="grid grid-cols-7 border-b border-line bg-surface/80">
          {["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"].map((d) => (
            <div key={d} className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-ink-soft">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: firstWeekday }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-24 border-b border-r border-line/50 bg-surface/30" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const items = byDay.get(day) ?? [];
            const isToday =
              day === now.getDate() && month === now.getMonth() && year === now.getFullYear();
            return (
              <div key={day} className="min-h-24 border-b border-r border-line/50 p-1.5">
                <span
                  className={cn(
                    "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                    isToday ? "bg-gradient-to-r from-brand to-electric text-white" : "text-ink-soft",
                  )}
                >
                  {day}
                </span>
                {items.map((p) => (
                  <div
                    key={p.id}
                    title={`${p.title} · ${formatDate(p.starts_at, true)}`}
                    className="mb-1 flex items-center gap-1.5 rounded-lg bg-surface px-1.5 py-1 text-[11px] font-semibold text-ink"
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOTS[p.status] ?? "bg-ink-soft/40")} />
                    <span className="truncate">{p.title}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Agenda view (mobile + summary) */}
      <div className="mt-5 space-y-2 md:mt-6">
        <h2 className="text-sm font-bold text-ink md:hidden">Oy tadbirlari</h2>
        {podcasts.length === 0 ? (
          <p className="rounded-card border border-line bg-card p-6 text-center text-sm text-ink-soft shadow-card">
            Bu oyda podcast rejalashtirilmagan
          </p>
        ) : (
          podcasts.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-card border border-line bg-card p-4 shadow-card">
              <span className="rounded-xl bg-lavender/15 p-2 text-[#6a52c7]">
                <Mic className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">{p.title}</span>
                <span className="block text-xs text-ink-soft">
                  {formatDate(p.starts_at, true)} · {p.location ?? (p.online_url ? "Onlayn" : "—")}
                </span>
              </span>
              <StatusBadge status={p.status} />
            </div>
          ))
        )}
      </div>
    </>
  );
}
