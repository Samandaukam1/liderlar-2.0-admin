import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { loadAuditActors } from "@/lib/audit-actors";
import { auditSearch } from "@/lib/audit-view";
import { auditEventLabel } from "@/lib/vip/audit-events";

type Row = Record<string, unknown>;

/**
 * So'rov xatosi BO'SH CSV EMAS.
 *
 * Avval `error` e'tiborsiz qolardi: baza xato qaytarsa, admin "muvaffaqiyatli"
 * yuklangan, lekin bo'sh fayl olardi va ma'lumot yo'q deb o'ylardi. Endi
 * xato yuqoridagi `catch` ga tushadi va 500 qaytadi.
 */
function rowsOrThrow(entity: string, result: { data: unknown; error: { message: string } | null }): Row[] {
  if (result.error) throw new Error(`${entity}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

const EXPORTERS: Record<
  string,
  (admin: ReturnType<typeof createSupabaseAdminClient>, params: URLSearchParams) => Promise<{
    header: string[];
    rows: Array<Array<string | number | null>>;
  }>
> = {
  candidates: async (admin) => {
    const result = await admin
      .from("candidates")
      .select("full_name, slug, status, email, phone, created_at, regions(name), categories(name)")
      .is("deleted_at", null)
      .order("full_name")
      .limit(5000);
    return {
      header: ["full_name", "slug", "status", "email", "phone", "region", "category", "created_at"],
      rows: rowsOrThrow("candidates", result).map((c) => [
        String(c.full_name ?? ""),
        String(c.slug ?? ""),
        String(c.status ?? ""),
        String(c.email ?? ""),
        String(c.phone ?? ""),
        String((c.regions as Row | null)?.name ?? ""),
        String((c.categories as Row | null)?.name ?? ""),
        String(c.created_at ?? ""),
      ]),
    };
  },
  rankings: async (admin, params) => {
    const category = params.get("category") ?? "overall";
    const result = await admin
      .from("ranking_scores")
      .select("position, previous_position, total_score, category, candidates(full_name, slug)")
      .eq("category", category)
      .eq("is_current", true)
      .order("position")
      .limit(5000);
    return {
      header: ["position", "previous_position", "full_name", "slug", "total_score", "category"],
      rows: rowsOrThrow("rankings", result).map((r) => [
        Number(r.position ?? 0),
        r.previous_position == null ? "" : Number(r.previous_position),
        String((r.candidates as Row | null)?.full_name ?? ""),
        String((r.candidates as Row | null)?.slug ?? ""),
        Number(r.total_score ?? 0),
        String(r.category ?? ""),
      ]),
    };
  },
  applications: async (admin) => {
    const result = await admin
      .from("applications")
      .select(
        "full_name, phone, telegram, gender, age_range, promo_code, email, status, created_at, regions(name), categories(name)",
      )
      .order("created_at", { ascending: false })
      .limit(5000);
    return {
      header: [
        "full_name",
        "phone",
        "telegram",
        "gender",
        "age_range",
        "promo_code",
        "email",
        "status",
        "region",
        "category",
        "created_at",
      ],
      rows: rowsOrThrow("applications", result).map((a) => [
        String(a.full_name ?? ""),
        String(a.phone ?? ""),
        String(a.telegram ?? ""),
        String(a.gender ?? ""),
        String(a.age_range ?? ""),
        String(a.promo_code ?? ""),
        String(a.email ?? ""),
        String(a.status ?? ""),
        String((a.regions as Row | null)?.name ?? ""),
        String((a.categories as Row | null)?.name ?? ""),
        String(a.created_at ?? ""),
      ]),
    };
  },
  journals: async (admin) => {
    const result = await admin
      .from("journals")
      .select("issue_number, title, status, published_at, downloads_count")
      .order("issue_number")
      .limit(1000);
    return {
      header: ["issue_number", "title", "status", "published_at", "downloads_count"],
      rows: rowsOrThrow("journals", result).map((j) => [
        Number(j.issue_number ?? 0),
        String(j.title ?? ""),
        String(j.status ?? ""),
        String(j.published_at ?? ""),
        Number(j.downloads_count ?? 0),
      ]),
    };
  },
  audit: async (admin, params) => {
    /*
     * Sahifadagi filtrlar bilan bir xil: admin ko'rgan ro'yxatini oladi.
     * `profiles(...)` qo'shilmaydi — `actor_id` auth.users ga bog'langan
     * (qarang: `audit-actors.ts`).
     */
    let query = admin
      .from("audit_logs")
      .select("actor_id, action, entity_type, entity_id, severity, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(5000);
    const severity = params.get("severity");
    const entityType = params.get("entity");
    const entityId = params.get("eid");
    const search = auditSearch(params.get("q") ?? "");
    if (severity) query = query.eq("severity", severity);
    if (entityType) query = query.eq("entity_type", entityType);
    if (entityId && /^[A-Za-z0-9_-]{1,64}$/.test(entityId)) query = query.eq("entity_id", entityId);
    if (search.kind === "actions") query = query.in("action", search.actions);
    if (search.kind === "like") query = query.ilike("action", search.pattern);

    const logRows = rowsOrThrow("audit", await query) as Array<Row & { actor_id: string | null }>;
    const actors = await loadAuditActors(logRows);
    return {
      header: ["actor", "action", "entity_type", "entity_id", "severity", "reason", "created_at", "action_label"],
      rows: logRows.map((a) => [
        actors.actorOf(a.actor_id).name,
        String(a.action ?? ""),
        String(a.entity_type ?? ""),
        String(a.entity_id ?? ""),
        String(a.severity ?? ""),
        String(a.reason ?? ""),
        String(a.created_at ?? ""),
        auditEventLabel(String(a.action ?? "")),
      ]),
    };
  },
};

export async function GET(
  request: Request,
  context: { params: Promise<{ entity: string }> },
) {
  const ctx = await checkPermission("export.run");
  if (!ctx) {
    return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });
  }
  const { entity } = await context.params;
  const exporter = Object.hasOwn(EXPORTERS, entity) ? EXPORTERS[entity] : undefined;
  if (!exporter) {
    return NextResponse.json({ error: "Noma’lum eksport turi" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const url = new URL(request.url);
  try {
    const { header, rows } = await exporter(admin, url.searchParams);
    await logAudit({
      actorId: ctx.userId,
      action: `export.${entity}`,
      entityType: "export",
      metadata: { rows: rows.length },
    });
    const csv = toCsv([header, ...rows]);
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="liderlar-${entity}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error("export failed", err);
    return NextResponse.json({ error: "Eksport xatosi" }, { status: 500 });
  }
}
