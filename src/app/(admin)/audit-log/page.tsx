import { ScrollText, Download, AlertTriangle } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import { loadAuditActors } from "@/lib/audit-actors";
import {
  auditChangeRows,
  auditEntityLabel,
  auditEntityOptions,
  auditSearch,
  formatAuditValue,
  type AuditActor,
} from "@/lib/audit-view";
import { auditEventLabel, auditEventSpec } from "@/lib/vip/audit-events";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { Avatar, Badge, StatusBadge } from "@/components/admin/badges";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/utils";
import type { AuditLog } from "@/lib/types";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

type AuditRow = Omit<AuditLog, "profiles"> & { actor: AuditActor };

/**
 * `?eid=` — bitta obyekt tarixi (nomzod sahifasidagi "Barchasi" havolasi).
 * Faqat id ga o'xshash qiymat qabul qilinadi.
 */
function cleanEntityId(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text && /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : null;
}

/** Ko'rsatiladigan maydonlar soni — qolgani "+N" bo'lib turadi. */
const MAX_CHANGE_ROWS = 6;

function ChangeCell({ row }: { row: AuditRow }) {
  const changes = auditChangeRows(row.old_value, row.new_value);

  if (changes === null) {
    /*
     * Eski yozuv: ichma-ich obyekt. Xom ko'rinish qisqartirib
     * ko'rsatiladi, to'liq matn `title` da.
     */
    const raw = (value: unknown) => (typeof value === "object" ? JSON.stringify(value) : String(value));
    return (
      <div className="max-w-xs space-y-1 font-mono text-[11px]">
        {row.old_value != null && (
          <p className="truncate rounded bg-coral/10 px-1.5 py-0.5 text-[#a33232]" title={raw(row.old_value)}>
            − {formatAuditValue(row.old_value)}
          </p>
        )}
        {row.new_value != null && (
          <p className="truncate rounded bg-mint/15 px-1.5 py-0.5 text-[#14563f]" title={raw(row.new_value)}>
            + {formatAuditValue(row.new_value)}
          </p>
        )}
      </div>
    );
  }

  const meta = auditChangeRows(null, row.metadata) ?? [];
  if (changes.length === 0 && meta.length === 0) {
    return <span className="text-xs text-ink-soft">—</span>;
  }

  return (
    <div className="max-w-sm space-y-1 text-[11px]">
      {changes.slice(0, MAX_CHANGE_ROWS).map((change) => (
        <p key={change.field} className="break-words">
          <span className="font-mono text-ink-soft">{change.field}:</span>{" "}
          {change.before !== "—" && (
            <>
              <span className="rounded bg-coral/10 px-1 text-[#a33232]">{change.before}</span>{" "}
              <span aria-hidden>→</span>{" "}
            </>
          )}
          <span className="rounded bg-mint/15 px-1 text-[#14563f]">{change.after}</span>
        </p>
      ))}
      {changes.length > MAX_CHANGE_ROWS && (
        <p className="text-ink-soft">+{changes.length - MAX_CHANGE_ROWS} ta maydon</p>
      )}
      {meta.length > 0 && (
        <p className="break-words text-ink-soft">
          {meta
            .slice(0, 4)
            .map((item) => `${item.field}: ${item.after}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

export default async function AuditLogPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("audit.view");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["severity", "entity"]);
  const entityId = cleanEntityId(sp.eid);
  const search = auditSearch(q);
  const admin = createSupabaseAdminClient();

  /*
   * `profiles(...)` QO'SHILMAYDI: `actor_id` auth.users ga bog'langan va
   * PostgREST bu jadvalni `profiles` bilan birlashtira olmaydi — butun
   * so'rov xato qaytarardi. Ismlar pastda alohida o'qiladi.
   */
  let query = admin
    .from("audit_logs")
    .select(
      "id, actor_id, action, entity_type, entity_id, old_value, new_value, reason, severity, metadata, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (filters.severity) query = query.eq("severity", filters.severity);
  if (filters.entity) query = query.eq("entity_type", filters.entity);
  if (entityId) query = query.eq("entity_id", entityId);
  if (search.kind === "actions") query = query.in("action", search.actions);
  if (search.kind === "like") query = query.ilike("action", search.pattern);

  const [from, to] = listRange(page);
  const { data, count, error } = await query.range(from, to);
  if (error) console.error("[audit] jurnal o'qilmadi:", error.message);

  const logRows = (data ?? []) as unknown as Array<Omit<AuditLog, "profiles">>;
  const actors = await loadAuditActors(logRows);
  const rows: AuditRow[] = logRows.map((row) => ({ ...row, actor: actors.actorOf(row.actor_id) }));

  const columns: Column<AuditRow>[] = [
    {
      key: "actor",
      header: "Kim",
      render: (a) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={a.actor.name} src={a.actor.avatarUrl} size={30} />
          <span
            className={
              a.actor.kind === "user"
                ? "truncate text-sm font-semibold text-ink"
                : "truncate text-sm italic text-ink-soft"
            }
          >
            {a.actor.name}
          </span>
        </span>
      ),
    },
    {
      key: "action",
      header: "Amal",
      render: (a) => (
        <span className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-ink">{auditEventLabel(a.action)}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {auditEventSpec(a.action) ? null : <Badge accent="neutral">eski yozuv</Badge>}
            <span className="font-mono text-[11px] text-ink-soft">{a.action}</span>
            <span className="text-[11px] text-ink-soft">· {auditEntityLabel(a.entity_type)}</span>
          </span>
        </span>
      ),
    },
    { key: "severity", header: "Daraja", render: (a) => <StatusBadge status={a.severity} /> },
    {
      key: "diff",
      header: "O‘zgarish",
      desktopOnly: true,
      render: (a) => <ChangeCell row={a} />,
    },
    {
      key: "reason",
      header: "Sabab",
      desktopOnly: true,
      render: (a) => <span className="text-xs text-ink-soft">{a.reason ?? "—"}</span>,
    },
    {
      key: "time",
      header: "Vaqt",
      render: (a) => <span className="whitespace-nowrap text-xs text-ink-soft">{formatDate(a.created_at, true)}</span>,
    },
  ];

  /* CSV joriy filtrlar bilan: admin ko'rgan narsasini yuklab oladi. */
  const exportParams = new URLSearchParams();
  if (filters.severity) exportParams.set("severity", filters.severity);
  if (filters.entity) exportParams.set("entity", filters.entity);
  if (entityId) exportParams.set("eid", entityId);
  if (q) exportParams.set("q", q);
  const exportQuery = exportParams.toString();

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Barcha muhim amallar — kim, nima, qachon"
        breadcrumbs={[{ label: "Audit log" }]}
        actions={
          hasPermission(ctx.roles, "export.run") ? (
            <a
              href={exportQuery ? `/api/export/audit?${exportQuery}` : "/api/export/audit"}
              className="inline-flex h-9 items-center gap-1.5 rounded-[12px] border border-line bg-card px-3 text-xs font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand"
            >
              <Download className="h-3.5 w-3.5" /> CSV eksport
            </a>
          ) : undefined
        }
      />
      {entityId && (
        <p className="mb-3 text-sm text-ink-soft">
          Faqat bitta obyekt: <span className="font-mono text-ink">{entityId}</span>
        </p>
      )}
      {actors.failed && (
        <div className="mb-4 flex items-start gap-3 rounded-card border border-peach/50 bg-peach/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
          <p className="text-sm text-ink">
            Yozuvlar o‘qildi, lekin ularni kim qilganini aniqlab bo‘lmadi. Ismlar “noma’lum” bo‘lib turibdi —
            sahifani birozdan keyin yangilang.
          </p>
        </div>
      )}
      <DataTableToolbar
        searchPlaceholder="Amal: “uzaytirildi” yoki texnik nom “candidate.update”…"
        filters={[
          {
            key: "severity",
            label: "Daraja",
            options: [
              { value: "info", label: "Ma’lumot" },
              { value: "warning", label: "Ogohlantirish" },
              { value: "critical", label: "Muhim" },
            ],
          },
          { key: "entity", label: "Obyekt", options: auditEntityOptions() },
        ]}
      />
      {error ? (
        <ErrorState
          title="Jurnalni o‘qib bo‘lmadi"
          description="Ma’lumotlar bazasi so‘rovi xato qaytardi. Sahifani yangilang; takrorlansa, server logidagi “[audit]” yozuvini tekshiring."
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            empty={
              <EmptyState
                icon={<ScrollText className="h-7 w-7" />}
                title="Audit yozuvlari yo‘q"
                description={
                  q || filters.severity || filters.entity || entityId
                    ? "Tanlangan filtrlarga mos yozuv topilmadi."
                    : "Muhim amallar avtomatik yoziladi."
                }
              />
            }
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} />
        </>
      )}
    </>
  );
}
