import Link from "next/link";
import { Trophy, Download } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { RANKING_CATEGORY_META, type RankingCategorySlug } from "@/lib/ranking";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { CandidateMiniCard, RankingBadge, Badge, Avatar } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { RankingToolbarActions } from "./ranking-controls";

export const metadata = { title: "Reyting" };
export const dynamic = "force-dynamic";

interface ScoreRow {
  id: string;
  candidate_id: string;
  position: number;
  previous_position: number | null;
  total_score: number;
  breakdown: {
    achievements?: number;
    monthly_activity?: number;
    active_leadership?: number;
    manual_adjustment?: number;
  } | null;
  candidates: { full_name: string; avatar_url: string | null } | null;
}

const CATEGORY_DOTS: Record<RankingCategorySlug, string> = {
  overall: "bg-cyan",
  achievements: "bg-lavender",
  monthly_activity: "bg-mint",
  active_leadership: "bg-peach",
};

export default async function RankingsPage(props: {
  searchParams: Promise<{ category?: string }>;
}) {
  const ctx = await requirePermission("rankings.view");
  const sp = await props.searchParams;
  const category = (
    ["overall", "achievements", "monthly_activity", "active_leadership"].includes(sp.category ?? "")
      ? sp.category
      : "overall"
  ) as RankingCategorySlug;

  const admin = createSupabaseAdminClient();
  const { data: period } = await admin
    .from("ranking_periods")
    .select("id, name, starts_on, ends_on, status, published_at")
    .eq("is_current", true)
    .maybeSingle();

  const { data: scoreRows, error } = await admin
    .from("ranking_scores")
    .select("id, candidate_id, position, previous_position, total_score, breakdown, candidates(full_name, avatar_url)")
    .eq("category", category)
    .eq("is_current", true)
    .order("position", { ascending: true })
    .limit(200);
  const scores = (scoreRows ?? []) as unknown as ScoreRow[];

  const { data: adjustments } = await admin
    .from("ranking_adjustments")
    .select("candidate_id, delta, reason, category")
    .eq("period_id", period?.id ?? "00000000-0000-0000-0000-000000000000");
  const adjustedIds = new Map<string, { delta: number; reason: string }>();
  for (const a of (adjustments ?? []) as Array<{ candidate_id: string; delta: number; reason: string; category: string }>) {
    if (a.category === category || a.category === "overall") {
      adjustedIds.set(a.candidate_id, { delta: a.delta, reason: a.reason });
    }
  }

  const { data: candidatesForAdjust } = await admin
    .from("candidates")
    .select("id, full_name")
    .eq("status", "published")
    .is("deleted_at", null)
    .order("full_name")
    .limit(500);

  const canManage = hasPermission(ctx.roles, "rankings.manage");
  const canAdjust = hasPermission(ctx.roles, "rankings.adjust");
  const canExport = hasPermission(ctx.roles, "export.run");

  const top3 = scores.slice(0, 3);

  const columns: Column<ScoreRow>[] = [
    {
      key: "position",
      header: "O‘rin",
      className: "w-28",
      render: (r) => (
        <RankingBadge
          position={r.position}
          change={r.previous_position != null ? r.previous_position - r.position : null}
        />
      ),
    },
    {
      key: "candidate",
      header: "Nomzod",
      render: (r) => (
        <CandidateMiniCard
          name={r.candidates?.full_name ?? "—"}
          avatarUrl={r.candidates?.avatar_url}
          href={`/candidates/${r.candidate_id}`}
        />
      ),
    },
    {
      key: "score",
      header: "Ball",
      render: (r) => (
        <span className="font-display text-base font-semibold text-ink">
          {formatNumber(Math.round(r.total_score * 100) / 100)}
        </span>
      ),
    },
    {
      key: "breakdown",
      header: "Ball manbalari",
      desktopOnly: true,
      render: (r) => (
        <span className="flex flex-wrap gap-1.5">
          {r.breakdown?.achievements != null && (
            <Badge accent="lavender">Yutuqlar: {r.breakdown.achievements}</Badge>
          )}
          {r.breakdown?.monthly_activity != null && (
            <Badge accent="mint">Faollik: {r.breakdown.monthly_activity}</Badge>
          )}
          {r.breakdown?.active_leadership != null && (
            <Badge accent="peach">Liderlik: {r.breakdown.active_leadership}</Badge>
          )}
        </span>
      ),
    },
    {
      key: "adjustment",
      header: "Qo‘lda tuzatish",
      render: (r) => {
        const adj = adjustedIds.get(r.candidate_id);
        if (!adj) return <span className="text-xs text-ink-soft">—</span>;
        return (
          <span title={adj.reason}>
            <Badge accent="amber">
              {adj.delta > 0 ? "+" : ""}
              {adj.delta} ball · sabab bor
            </Badge>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Reyting"
        description={
          period
            ? `Joriy davr: ${period.name} (${formatDate(period.starts_on)} — ${formatDate(period.ends_on)})${period.published_at ? " · e’lon qilingan" : " · hali e’lon qilinmagan"}`
            : "Faol reyting davri yo‘q — Reyting sozlamalaridan yangi davr oching"
        }
        breadcrumbs={[{ label: "Reyting" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canExport && (
              <a
                href={`/api/export/rankings?category=${category}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-[12px] border border-line bg-card px-3 text-xs font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand"
              >
                <Download className="h-3.5 w-3.5" /> CSV eksport
              </a>
            )}
            {canManage && (
              <RankingToolbarActions
                periodId={period?.id ?? null}
                isPublished={Boolean(period?.published_at)}
                candidates={candidatesForAdjust ?? []}
                canAdjust={canAdjust}
              />
            )}
          </div>
        }
      />

      {/* Category tabs */}
      <nav className="mb-5 flex gap-1 overflow-x-auto rounded-[16px] border border-line bg-card p-1 shadow-card" aria-label="Reyting kategoriyalari">
        {(Object.keys(RANKING_CATEGORY_META) as RankingCategorySlug[]).map((slug) => (
          <Link
            key={slug}
            href={`/rankings?category=${slug}`}
            aria-current={category === slug ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-[12px] px-4 py-2 text-sm font-bold transition",
              category === slug
                ? "bg-gradient-to-r from-brand to-electric text-white shadow-[0_4px_14px_rgba(22,119,255,0.3)]"
                : "text-ink-soft hover:bg-surface hover:text-ink",
            )}
          >
            {RANKING_CATEGORY_META[slug].label}
          </Link>
        ))}
      </nav>

      {/* Top 3 portrait cards */}
      {top3.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {top3.map((r, i) => (
            <div
              key={r.id}
              className={cn(
                "rise-in relative overflow-hidden rounded-card border p-5 shadow-card",
                i === 0
                  ? "border-cyan/40 bg-gradient-to-br from-navy-deep to-navy-dark text-white"
                  : "border-line bg-card",
              )}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <span
                className={cn(
                  "font-display absolute right-4 top-2 text-5xl font-bold",
                  i === 0 ? "text-cyan/25" : "text-brand/10",
                )}
              >
                #{r.position}
              </span>
              <Avatar name={r.candidates?.full_name ?? "?"} src={r.candidates?.avatar_url} size={56} />
              <p className={cn("mt-3 truncate font-display text-lg font-semibold uppercase tracking-wide", i === 0 ? "text-white" : "text-ink")}>
                {r.candidates?.full_name}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <RankingBadge
                  position={r.position}
                  change={r.previous_position != null ? r.previous_position - r.position : null}
                />
                <span className={cn("text-sm font-bold", i === 0 ? "text-cyan-light" : "text-brand")}>
                  {formatNumber(Math.round(r.total_score * 100) / 100)} ball
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={scores}
        empty={
          <EmptyState
            icon={<Trophy className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Reyting hali hisoblanmagan"}
            description={
              error
                ? "Supabase migrationlarni ishga tushiring."
                : "Reyting davri oching va “Qayta hisoblash” tugmasini bosing."
            }
          />
        }
      />

      <p className="mt-4 flex items-center gap-2 rounded-card border border-line bg-card p-3.5 text-xs text-ink-soft">
        <span className={cn("h-2 w-2 rounded-full", CATEGORY_DOTS[category])} />
        Reyting shaffof: har bir ball ranking_events jadvalidagi tasdiqlangan manbalardan hisoblanadi.
        Ko‘rishlar asosidagi ballarda bot va takroriy trafik SQL darajasida filtrlangan
        (record_profile_view funksiyasi). Qo‘lda tuzatishlar sabab bilan alohida ko‘rsatiladi.
      </p>
    </>
  );
}
