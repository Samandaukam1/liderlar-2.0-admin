import { CalendarClock, KeyRound, Link2 } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import { deriveTokenStatus } from "@/lib/tokens";
import type { MonthlyUpdateToken } from "@/lib/types";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/cards";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { CandidateMiniCard, StatusBadge, Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate, daysUntil, nowIso as getNowIso, isoDaysAhead } from "@/lib/utils";
import { BulkTokensButton, CreateTokenButton, TokenRowActions } from "./token-manager";

export const metadata = { title: "Oylik havolalar" };
export const dynamic = "force-dynamic";

export default async function MonthlyLinksPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("tokens.view");
  const canManage = hasPermission(ctx.roles, "tokens.manage");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["status", "candidate", "due"]);
  const admin = createSupabaseAdminClient();
  const nowIso = getNowIso();
  const soonIso = isoDaysAhead(5);

  // Status counts
  const [active, used, revoked, expired, dueSoon, overdue] = await Promise.all([
    admin.from("monthly_update_tokens").select("id", { count: "exact", head: true }).eq("status", "active").gt("expires_at", nowIso),
    admin.from("monthly_update_tokens").select("id", { count: "exact", head: true }).eq("status", "used"),
    admin.from("monthly_update_tokens").select("id", { count: "exact", head: true }).eq("status", "revoked"),
    admin.from("monthly_update_tokens").select("id", { count: "exact", head: true }).eq("status", "active").lte("expires_at", nowIso),
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("status", "published").is("deleted_at", null).gt("next_update_due_at", nowIso).lte("next_update_due_at", soonIso),
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("status", "published").is("deleted_at", null).lte("next_update_due_at", nowIso),
  ]);

  // Candidates due for a new link (auto surfaced)
  const { data: dueCandidates } = await admin
    .from("candidates")
    .select("id, full_name, avatar_url, next_update_due_at, last_updated_at")
    .eq("status", "published")
    .is("deleted_at", null)
    .lte("next_update_due_at", soonIso)
    .order("next_update_due_at", { ascending: true })
    .limit(50);

  // Token list
  let query = admin
    .from("monthly_update_tokens")
    .select(
      "id, candidate_id, status, expires_at, used_at, created_at, revoked_at, candidates!inner(full_name, avatar_url, next_update_due_at, last_updated_at)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });
  if (filters.candidate) query = query.eq("candidate_id", filters.candidate);
  if (filters.status === "active") query = query.eq("status", "active").gt("expires_at", nowIso);
  if (filters.status === "expired") query = query.eq("status", "active").lte("expires_at", nowIso);
  if (filters.status === "used") query = query.eq("status", "used");
  if (filters.status === "revoked") query = query.eq("status", "revoked");
  if (q) query = query.ilike("candidates.full_name", `%${q}%`);

  const [from, to] = listRange(page);
  const { data: tokenRows, count, error } = await query.range(from, to);
  const tokens = (tokenRows ?? []) as unknown as MonthlyUpdateToken[];

  // Candidates for the create modal
  const { data: allCandidates } = await admin
    .from("candidates")
    .select("id, full_name")
    .is("deleted_at", null)
    .neq("status", "archived")
    .order("full_name")
    .limit(500);

  const columns: Column<MonthlyUpdateToken>[] = [
    {
      key: "candidate",
      header: "Nomzod",
      render: (t) => (
        <CandidateMiniCard
          name={t.candidates?.full_name ?? "—"}
          avatarUrl={t.candidates?.avatar_url}
          href={`/candidates/${t.candidate_id}`}
          meta={
            t.candidates?.last_updated_at
              ? `Oxirgi yangilanish: ${formatDate(t.candidates.last_updated_at)}`
              : "Hali yangilanmagan"
          }
        />
      ),
    },
    {
      key: "status",
      header: "Token holati",
      render: (t) => <StatusBadge status={deriveTokenStatus(t)} />,
    },
    {
      key: "expires",
      header: "Muddati",
      render: (t) => {
        const days = daysUntil(t.expires_at);
        return (
          <span className="text-xs text-ink-soft">
            {formatDate(t.expires_at, true)}
            {days != null && days >= 0 && deriveTokenStatus(t) === "active" ? (
              <span className="ml-1.5 font-bold text-brand">({days} kun)</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "used",
      header: "Foydalanilgan",
      desktopOnly: true,
      render: (t) => <span className="text-xs text-ink-soft">{formatDate(t.used_at, true)}</span>,
    },
    {
      key: "created",
      header: "Yaratilgan",
      desktopOnly: true,
      render: (t) => <span className="text-xs text-ink-soft">{formatDate(t.created_at, true)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-28 text-right",
      render: (t) =>
        canManage ? (
          <TokenRowActions
            tokenId={t.id}
            candidateId={t.candidate_id}
            status={deriveTokenStatus(t)}
          />
        ) : null,
    },
  ];

  const dueList = (dueCandidates ?? []) as Array<{
    id: string;
    full_name: string;
    avatar_url: string | null;
    next_update_due_at: string | null;
  }>;

  return (
    <>
      <PageHeader
        title="Oylik havolalar"
        description="Har 30 kunlik yangilanish tokenlari — yaratish, uzaytirish, bekor qilish"
        breadcrumbs={[{ label: "Oylik havolalar" }]}
        actions={
          canManage ? (
            <CreateTokenButton
              candidates={allCandidates ?? []}
              preselectedId={filters.candidate || undefined}
            />
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Faol tokenlar" value={active.count ?? 0} icon={KeyRound} accent="cyan" />
        <StatCard label="Foydalanilgan" value={used.count ?? 0} icon={KeyRound} accent="mint" />
        <StatCard label="Muddati tugagan" value={expired.count ?? 0} icon={KeyRound} accent="peach" />
        <StatCard label="Bekor qilingan" value={revoked.count ?? 0} icon={KeyRound} accent="coral" />
        <StatCard label="Muddat yaqin (5 kun)" value={dueSoon.count ?? 0} icon={CalendarClock} accent="lavender" />
        <StatCard label="Muddati o‘tgan" value={overdue.count ?? 0} icon={CalendarClock} accent="coral" />
      </div>

      {dueList.length > 0 && (
        <section className="mt-5 rounded-card border border-lavender/40 bg-gradient-to-br from-card to-lavender/[0.07] p-5 shadow-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <CalendarClock className="h-4 w-4 text-[#6a52c7]" />
              Yangilash vaqti kelgan nomzodlar ({dueList.length})
            </h2>
            {canManage && <BulkTokensButton candidateIds={dueList.map((c) => c.id)} />}
          </div>
          <div className="flex flex-wrap gap-2">
            {dueList.map((c) => {
              const days = daysUntil(c.next_update_due_at);
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-3"
                >
                  <CandidateMiniCard name={c.full_name} avatarUrl={c.avatar_url} href={`/candidates/${c.id}`} />
                  {days != null && (
                    <Badge accent={days < 0 ? "coral" : "lavender"}>
                      {days < 0 ? `${Math.abs(days)} kun kechikkan` : `${days} kun qoldi`}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="mt-6">
        <DataTableToolbar
          searchPlaceholder="Nomzod ismi bo‘yicha…"
          filters={[
            {
              key: "status",
              label: "Token holati",
              options: [
                { value: "active", label: "Faol" },
                { value: "used", label: "Foydalanilgan" },
                { value: "expired", label: "Muddati tugagan" },
                { value: "revoked", label: "Bekor qilingan" },
              ],
            },
          ]}
        />
        <DataTable
          columns={columns}
          rows={tokens}
          empty={
            <EmptyState
              icon={<Link2 className="h-7 w-7" />}
              title={error ? "Jadval topilmadi" : "Tokenlar yo‘q"}
              description={
                error
                  ? "Supabase migrationlarni ishga tushiring."
                  : "Nomzod uchun birinchi yangilash havolasini yarating."
              }
            />
          }
        />
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={count ?? 0}
          basePath="/monthly-links"
          params={{ q, ...filters }}
        />
      </div>
    </>
  );
}
