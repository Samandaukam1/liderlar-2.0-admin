import Link from "next/link";
import { Plus, Inbox, PencilLine, Link2 } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { StatusBadge, Badge, Avatar } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { cn, timeAgo, daysUntil } from "@/lib/utils";
import { INTAKE_TABS } from "@/lib/intake/constants";

export const metadata = { title: "Nomzod anketalari" };
export const dynamic = "force-dynamic";

interface IntakeRow {
  id: string;
  full_name: string;
  intake_method: string;
  status: string;
  phone_e164: string | null;
  telegram_username: string | null;
  last_autosave_at: string | null;
  updated_at: string;
  answered?: number;
  linkExpiresAt?: string | null;
}

export default async function IntakesPipelinePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("intakes.view");
  const sp = await props.searchParams;
  const { page, q } = parseListParams(sp);
  const tabKey = typeof sp.tab === "string" ? sp.tab : "all";
  const tab = INTAKE_TABS.find((t) => t.key === tabKey) ?? INTAKE_TABS[0];
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("candidate_intakes")
    .select("id, full_name, intake_method, status, phone_e164, telegram_username, last_autosave_at, updated_at", { count: "exact" })
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (tab.method) query = query.eq("intake_method", tab.method);
  if (tab.status) {
    query = Array.isArray(tab.status) ? query.in("status", tab.status) : query.eq("status", tab.status);
  }
  if (q) query = query.ilike("full_name", `%${q}%`);

  const [from, to] = listRange(page);
  const { data, count, error } = await query.range(from, to);
  let rows = (data ?? []) as IntakeRow[];

  // Progress + link expiry for the visible rows (one query each).
  const ids = rows.map((r) => r.id);
  const [{ count: totalQuestions }, answerAgg, linkAgg] = await Promise.all([
    admin.from("candidate_intake_questions").select("id", { count: "exact", head: true }).eq("is_required", true),
    ids.length
      ? admin.from("candidate_intake_answers").select("intake_id, answer_state").in("intake_id", ids)
      : Promise.resolve({ data: [] as { intake_id: string; answer_state: string }[] }),
    ids.length
      ? admin.from("candidate_intake_links").select("intake_id, expires_at").eq("status", "active").in("intake_id", ids)
      : Promise.resolve({ data: [] as { intake_id: string; expires_at: string }[] }),
  ]);

  const answeredByIntake = new Map<string, number>();
  for (const a of (answerAgg.data ?? []) as { intake_id: string; answer_state: string }[]) {
    if (a.answer_state === "answered" || a.answer_state === "no_answer") {
      answeredByIntake.set(a.intake_id, (answeredByIntake.get(a.intake_id) ?? 0) + 1);
    }
  }
  const linkByIntake = new Map<string, string>();
  for (const l of (linkAgg.data ?? []) as { intake_id: string; expires_at: string }[]) {
    linkByIntake.set(l.intake_id, l.expires_at);
  }
  const total = totalQuestions ?? 15;
  rows = rows.map((r) => ({
    ...r,
    answered: answeredByIntake.get(r.id) ?? 0,
    linkExpiresAt: linkByIntake.get(r.id) ?? null,
  }));

  const columns: Column<IntakeRow>[] = [
    {
      key: "name",
      header: "Nomzod",
      render: (r) => (
        <div className="flex items-center gap-3">
          <Avatar name={r.full_name} size={38} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{r.full_name}</p>
            <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
              {r.intake_method === "manual" ? <PencilLine className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
              {r.intake_method === "manual" ? "Qo‘lda" : "Havola"}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "progress",
      header: "Progress",
      render: (r) => {
        const pct = Math.round(((r.answered ?? 0) / total) * 100);
        return (
          <div className="w-28">
            <div className="mb-1 flex justify-between text-[11px] text-ink-soft">
              <span>{r.answered}/{total}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className={cn("h-full rounded-full", pct === 100 ? "bg-green" : "bg-brand")} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      },
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "contact",
      header: "Aloqa",
      desktopOnly: true,
      render: (r) => (
        <div className="text-xs text-ink-soft">
          <p>{r.phone_e164 ?? "—"}</p>
          <p>{r.telegram_username ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "link",
      header: "Havola muddati",
      desktopOnly: true,
      render: (r) => {
        if (r.intake_method !== "secure_link") return <span className="text-ink-soft">—</span>;
        if (!r.linkExpiresAt) return <Badge accent="coral">Faol emas</Badge>;
        const days = daysUntil(r.linkExpiresAt);
        if (days == null) return <span className="text-ink-soft">—</span>;
        if (days < 0) return <Badge accent="coral">Muddati tugagan</Badge>;
        return <Badge accent={days <= 5 ? "peach" : "cyan"}>{days} kun</Badge>;
      },
    },
    {
      key: "autosave",
      header: "Oxirgi saqlash",
      desktopOnly: true,
      render: (r) => <span className="text-xs text-ink-soft">{r.last_autosave_at ? timeAgo(r.last_autosave_at) : "—"}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Nomzod anketalari"
        description="Kelayotgan anketalar oqimi — yig‘ish, AI ko‘rik va nashr"
        breadcrumbs={[{ label: "Nomzod anketalari" }]}
        actions={
          <Link
            href="/nomzodlar/yangi"
            className="inline-flex h-10 items-center gap-2 rounded-[14px] bg-gradient-to-r from-brand to-electric px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(22,119,255,0.28)] transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Yangi nomzod
          </Link>
        }
      />

      {/* Tabs */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {/* The batch board is its own route: it is stateful (selection, live
            progress) in a way the filtered list is not. */}
        <Link
          href="/nomzodlar/anketalar/chop-etishga-tayyorlar"
          className="shrink-0 rounded-full border border-brand/40 bg-brand/10 px-3.5 py-1.5 text-sm font-semibold text-brand transition hover:bg-brand/15"
        >
          Chop etishga tayyorlar
        </Link>
        <Link
          href="/nomzodlar/anketalar/chop-etishga-tayyorlar?view=unpaid"
          className="shrink-0 rounded-full border border-line bg-card px-3.5 py-1.5 text-sm font-semibold text-ink-soft transition hover:border-brand/40 hover:text-ink"
        >
          To‘lov qilmaganlar
        </Link>
        {INTAKE_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/nomzodlar/anketalar?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition",
              t.key === tab.key
                ? "border-brand bg-brand text-white"
                : "border-line bg-card text-ink-soft hover:border-brand/40 hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Search */}
      <form className="mb-4" action="/nomzodlar/anketalar" method="get">
        <input type="hidden" name="tab" value={tab.key} />
        <input
          name="q"
          defaultValue={q}
          placeholder="Ism bo‘yicha qidirish…"
          className="h-10 w-full max-w-sm rounded-[14px] border border-line bg-card px-3.5 text-sm text-ink placeholder:text-ink-soft/60 focus:border-brand/60 focus:outline-2 focus:outline-brand/25"
        />
      </form>

      <DataTable
        columns={columns}
        rows={rows}
        rowHref={(r) => `/nomzodlar/anketalar/${r.id}`}
        empty={
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Anketalar yo‘q"}
            description={
              error
                ? "0010_candidate_intake_v2.sql migrationni ishga tushiring."
                : "Bu bo‘limda hozircha anketa yo‘q. Yangi nomzod qo‘shing."
            }
          />
        }
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/nomzodlar/anketalar" params={{ q, tab: tab.key }} />
    </>
  );
}
