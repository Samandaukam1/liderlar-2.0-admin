import Link from "next/link";
import {
  Users,
  BadgeCheck,
  FileEdit,
  ClipboardList,
  Inbox,
  CalendarClock,
  Eye,
  Sparkles,
  Mic,
  BookOpen,
  AlertTriangle,
} from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard, TrendCard, ChartCard } from "@/components/admin/cards";
import { ViewsAreaChart, CategoryBarChart } from "@/components/admin/charts";
import { Avatar, RankingBadge, StatusBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate, timeAgo, formatNumber } from "@/lib/utils";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

interface DashboardData {
  totalCandidates: number;
  publishedCandidates: number;
  draftCandidates: number;
  newApplications: number;
  updatesInReview: number;
  dueCandidates: number;
  monthlyViews: number;
  aiJobsMonth: number;
  viewsSeries: Array<{ label: string; value: number }>;
  byCategory: Array<{ label: string; value: number }>;
  topLeaders: Array<{
    id: string;
    full_name: string;
    avatar_url: string | null;
    position: number;
    change: number | null;
    score: number;
  }>;
  upcomingPodcasts: Array<{ id: string; title: string; starts_at: string | null; status: string }>;
  journal: { issue_number: number; title: string; status: string } | null;
  recentAudit: Array<{
    id: string;
    action: string;
    entity_type: string;
    created_at: string;
    actor: string;
  }>;
  warnings: string[];
}

async function getDashboardData(): Promise<DashboardData> {
  const admin = createSupabaseAdminClient();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const now = new Date().toISOString();

  const [
    total,
    published,
    drafts,
    newApps,
    inReview,
    due,
    views,
    aiJobs,
    viewRows,
    catRows,
    scoreRows,
    podcastRows,
    journalRow,
    auditRows,
  ] = await Promise.allSettled([
    admin.from("candidates").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("status", "published").is("deleted_at", null),
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("status", "draft").is("deleted_at", null),
    admin.from("applications").select("id", { count: "exact", head: true }).eq("status", "new"),
    admin.from("monthly_updates").select("id", { count: "exact", head: true }).in("status", ["submitted", "under_review"]),
    admin.from("candidates").select("id", { count: "exact", head: true }).lte("next_update_due_at", now).eq("status", "published").is("deleted_at", null),
    admin.from("profile_views").select("id", { count: "exact", head: true }).gte("created_at", monthAgo),
    admin.from("ai_jobs").select("id", { count: "exact", head: true }).gte("created_at", monthAgo),
    admin.from("profile_views").select("created_at").gte("created_at", monthAgo).limit(10000),
    admin.from("candidates").select("category_id, categories(name)").is("deleted_at", null).not("category_id", "is", null).limit(2000),
    admin
      .from("ranking_scores")
      .select("candidate_id, position, previous_position, total_score, candidates(full_name, avatar_url)")
      .eq("category", "overall")
      .eq("is_current", true)
      .order("position", { ascending: true })
      .limit(5),
    admin.from("podcasts").select("id, title, starts_at, status").gte("starts_at", now).order("starts_at", { ascending: true }).limit(4),
    admin.from("journals").select("issue_number, title, status").order("issue_number", { ascending: false }).limit(1).maybeSingle(),
    admin
      .from("audit_logs")
      .select("id, action, entity_type, created_at, profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const getCount = (r: PromiseSettledResult<{ count: number | null; error: unknown }>) =>
    r.status === "fulfilled" && !r.value.error ? (r.value.count ?? 0) : 0;

  const warnings: string[] = [];
  if (total.status === "fulfilled" && total.value.error) {
    warnings.push(
      "Ma’lumotlar bazasi jadvallari topilmadi — supabase/migrations dagi SQL fayllarni Supabase SQL Editor’da ishga tushiring.",
    );
  }

  // Aggregate views by day
  const byDay = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  if (viewRows.status === "fulfilled" && Array.isArray(viewRows.value.data)) {
    for (const row of viewRows.value.data as Array<{ created_at: string }>) {
      const key = row.created_at.slice(0, 10);
      if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
  }
  const viewsSeries = Array.from(byDay.entries()).map(([date, value]) => ({
    label: date.slice(5).replace("-", "/"),
    value,
  }));

  // Candidates per category
  const catCount = new Map<string, number>();
  if (catRows.status === "fulfilled" && Array.isArray(catRows.value.data)) {
    for (const row of catRows.value.data as unknown as Array<{ categories: { name: string } | null }>) {
      const name = row.categories?.name ?? "Boshqa";
      catCount.set(name, (catCount.get(name) ?? 0) + 1);
    }
  }
  const byCategory = Array.from(catCount.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const topLeaders =
    scoreRows.status === "fulfilled" && Array.isArray(scoreRows.value.data)
      ? (
          scoreRows.value.data as unknown as Array<{
            candidate_id: string;
            position: number;
            previous_position: number | null;
            total_score: number;
            candidates: { full_name: string; avatar_url: string | null } | null;
          }>
        ).map((r) => ({
          id: r.candidate_id,
          full_name: r.candidates?.full_name ?? "—",
          avatar_url: r.candidates?.avatar_url ?? null,
          position: r.position,
          change: r.previous_position != null ? r.previous_position - r.position : null,
          score: r.total_score,
        }))
      : [];

  return {
    totalCandidates: getCount(total as PromiseSettledResult<{ count: number | null; error: unknown }>),
    publishedCandidates: getCount(published as PromiseSettledResult<{ count: number | null; error: unknown }>),
    draftCandidates: getCount(drafts as PromiseSettledResult<{ count: number | null; error: unknown }>),
    newApplications: getCount(newApps as PromiseSettledResult<{ count: number | null; error: unknown }>),
    updatesInReview: getCount(inReview as PromiseSettledResult<{ count: number | null; error: unknown }>),
    dueCandidates: getCount(due as PromiseSettledResult<{ count: number | null; error: unknown }>),
    monthlyViews: getCount(views as PromiseSettledResult<{ count: number | null; error: unknown }>),
    aiJobsMonth: getCount(aiJobs as PromiseSettledResult<{ count: number | null; error: unknown }>),
    viewsSeries,
    byCategory,
    topLeaders,
    upcomingPodcasts:
      podcastRows.status === "fulfilled" && Array.isArray(podcastRows.value.data)
        ? (podcastRows.value.data as DashboardData["upcomingPodcasts"])
        : [],
    journal:
      journalRow.status === "fulfilled" && journalRow.value.data
        ? (journalRow.value.data as DashboardData["journal"])
        : null,
    recentAudit:
      auditRows.status === "fulfilled" && Array.isArray(auditRows.value.data)
        ? (
            auditRows.value.data as unknown as Array<{
              id: string;
              action: string;
              entity_type: string;
              created_at: string;
              profiles: { full_name: string } | null;
            }>
          ).map((r) => ({
            id: r.id,
            action: r.action,
            entity_type: r.entity_type,
            created_at: r.created_at,
            actor: r.profiles?.full_name ?? "Tizim",
          }))
        : [],
    warnings,
  };
}

export default async function DashboardPage() {
  await requirePermission("dashboard.view");
  const d = await getDashboardData();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Liderlar.uz platformasining umumiy holati"
      />

      {d.warnings.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-card border border-peach/50 bg-peach/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
          <div className="text-sm text-ink">
            {d.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Jami nomzodlar" value={d.totalCandidates} icon={Users} accent="cyan" href="/candidates" />
        <StatCard label="E’lon qilingan profillar" value={d.publishedCandidates} icon={BadgeCheck} accent="mint" href="/candidates?status=published" />
        <StatCard label="Qoralama profillar" value={d.draftCandidates} icon={FileEdit} accent="lavender" href="/candidates?status=draft" />
        <StatCard label="Yangi arizalar" value={d.newApplications} icon={ClipboardList} accent="peach" href="/applications?status=new" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ko‘rib chiqilayotgan yangilanishlar" value={d.updatesInReview} icon={Inbox} accent="sky" href="/monthly-updates" />
        <StatCard label="30 kunlik yangilash vaqti kelganlar" value={d.dueCandidates} icon={CalendarClock} accent="coral" href="/monthly-links?due=1" />
        <StatCard label="Oylik profil ko‘rishlar" value={d.monthlyViews} icon={Eye} accent="brand" />
        <StatCard label="AI qayta ishlagan materiallar (30 kun)" value={d.aiJobsMonth} icon={Sparkles} accent="rose" href="/ai" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <ChartCard title="Profil ko‘rishlari" subtitle="So‘nggi 30 kun, kunlik">
            <ViewsAreaChart data={d.viewsSeries} />
          </ChartCard>
        </div>
        <div className="xl:col-span-2">
          <ChartCard title="Yo‘nalishlar bo‘yicha nomzodlar" subtitle="Eng katta 8 ta yo‘nalish">
            {d.byCategory.length > 0 ? (
              <CategoryBarChart data={d.byCategory} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-soft">Hozircha ma’lumot yo‘q</p>
            )}
          </ChartCard>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <TrendCard title="Eng faol liderlar (TOP 5)" accent="cyan" action={<Link href="/rankings" className="text-xs font-bold text-brand hover:underline">Barchasi</Link>}>
          {d.topLeaders.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-soft">Reyting hali hisoblanmagan</p>
          ) : (
            <ul className="space-y-3">
              {d.topLeaders.map((l) => (
                <li key={l.id} className="flex items-center gap-3">
                  <RankingBadge position={l.position} change={l.change} />
                  <Avatar name={l.full_name} src={l.avatar_url} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{l.full_name}</span>
                  <span className="font-display text-sm font-semibold text-brand">{formatNumber(l.score)}</span>
                </li>
              ))}
            </ul>
          )}
        </TrendCard>

        <TrendCard title="Yaqinlashayotgan podcastlar" accent="lavender" action={<Link href="/podcast-calendar" className="text-xs font-bold text-brand hover:underline">Taqvim</Link>}>
          {d.upcomingPodcasts.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-soft">Rejalashtirilgan podcast yo‘q</p>
          ) : (
            <ul className="space-y-3">
              {d.upcomingPodcasts.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="rounded-xl bg-lavender/15 p-2 text-[#6a52c7]">
                    <Mic className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{p.title}</span>
                    <span className="block text-xs text-ink-soft">{formatDate(p.starts_at, true)}</span>
                  </span>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </TrendCard>

        <TrendCard title="So‘nggi admin harakatlari" accent="sky" action={<Link href="/audit-log" className="text-xs font-bold text-brand hover:underline">Audit log</Link>}>
          {d.recentAudit.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-soft">Hozircha yozuvlar yo‘q</p>
          ) : (
            <ul className="space-y-2.5">
              {d.recentAudit.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 text-sm">
                  <span className="h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full bg-sky" />
                  <span className="min-w-0 flex-1 truncate">
                    <b className="text-ink">{a.actor}</b>{" "}
                    <span className="text-ink-soft">{a.action}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-soft/70">{timeAgo(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </TrendCard>
      </div>

      {d.journal && (
        <div className="mt-5">
          <TrendCard title="Liderlar Online — so‘nggi son" accent="mint">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-mint/20 p-2 text-[#1d8a6b]">
                <BookOpen className="h-5 w-5" />
              </span>
              <span className="flex-1 text-sm font-semibold text-ink">
                №{d.journal.issue_number} · {d.journal.title}
              </span>
              <StatusBadge status={d.journal.status} />
            </div>
          </TrendCard>
        </div>
      )}

      {d.totalCandidates === 0 && d.warnings.length === 0 && (
        <div className="mt-5">
          <EmptyState
            title="Hali nomzodlar yo‘q"
            description="Birinchi lider profilini yarating yoki eski ma’lumotlarni import qiling."
            action={
              <Link
                href="/candidates/new"
                className="inline-flex h-10 items-center rounded-[14px] bg-gradient-to-r from-brand to-electric px-5 text-sm font-bold text-white"
              >
                Nomzod yaratish
              </Link>
            }
          />
        </div>
      )}
    </>
  );
}
