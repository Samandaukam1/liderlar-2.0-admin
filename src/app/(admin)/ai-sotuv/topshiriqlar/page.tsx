import Link from "next/link";
import { UserCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import {
  ESCALATION_CATEGORY_LABELS,
  type EscalationCategory,
} from "@/lib/sales/flow/case-escalation-rules";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { ResolveForm } from "./resolve-form";

export const metadata = { title: "AI Sotuv — Odam kerak" };
export const dynamic = "force-dynamic";

/**
 * SHAXSIY HOLAT TOPSHIRIQLARI (7- va 13-band).
 *
 * "Maqolam tayyormi?", "To'lovim tushdimi?" — bu savollarning
 * javobi BILIM EMAS: u har mijozda boshqacha. Ularni bilim
 * bazasiga yozish eng xavfli xato bo'lardi — keyingi mijoz
 * boshqa odamning javobini olardi.
 *
 * Bot "administratorga yo'naltirdim" deyishga FAQAT shu yerga
 * yozuv tushgandan keyin haqli (12-band). Ya'ni bu ro'yxat
 * bo'sh turmasligi kerak — u mijozga berilgan va'daning o'zi.
 */
export default async function SalesEscalationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await requirePermission("sales.view");
  const canManage = hasPermission(ctx.roles, "sales.manage");
  const { view } = await searchParams;
  const showClosed = view === "yopilgan";

  const db = createSupabaseAdminClient();
  const query = db
    .from("sales_case_escalations")
    .select(
      "id, conversation_id, category, question, reason, context_summary, status, created_at, resolved_at, resolution",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const { data } = showClosed
    ? await query.neq("status", "open")
    : await query.eq("status", "open");

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Odam kerak"
        description="Javobi aynan shu mijozga tegishli bo‘lgan so‘rovlar. Bilim bazasiga tushmaydi."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Odam kerak" }]}
      />
      <SalesTabs active="escalations" />
      <NoAutoReplyNotice />

      <p className="mb-4 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
        Bot bu so‘rovlarga <b>javob to‘qimaydi</b>: to‘lov, maqola yoki ariza holatini
        tizim tasdiqlamagan bo‘lsa, u mijozga «mas’ul hamkasbimga yo‘naltirdim» deydi va
        shu yerga yozuv qo‘yadi. Ya’ni bu ro‘yxatdagi har qator — mijozga berilgan
        va’da.
      </p>

      <div className="mb-4 flex gap-1.5">
        <ViewTab href="/ai-sotuv/topshiriqlar" label="Ochiq" active={!showClosed} />
        <ViewTab href="/ai-sotuv/topshiriqlar?view=yopilgan" label="Yopilgan" active={showClosed} />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
          {showClosed ? "Yopilgan topshiriq yo‘q." : "Ochiq topshiriq yo‘q."}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id as string}
              className="rounded-card border border-line bg-card p-4 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="flex-1 text-sm font-semibold text-ink">
                  <UserCheck className="mr-1.5 inline h-4 w-4 text-ink-soft" />
                  {row.question as string}
                </p>
                <Badge accent="peach">{categoryLabel(row.category as string)}</Badge>
              </div>

              <p className="mt-1 text-[11px] text-ink-soft">
                {formatDate(row.created_at as string)} · {row.reason as string}
              </p>
              {row.context_summary ? (
                <p className="mt-1 text-[11px] text-ink-soft">{row.context_summary as string}</p>
              ) : null}

              <Link
                href={`/ai-sotuv/suhbatlar/${row.conversation_id as string}`}
                className="mt-2 inline-block text-xs font-semibold text-brand hover:underline"
              >
                Suhbatni ochish →
              </Link>

              {row.resolution ? (
                <p className="mt-2 rounded-card border border-line bg-surface px-3 py-2 text-xs text-ink-soft">
                  <b>Natija:</b> {row.resolution as string}
                </p>
              ) : null}

              {canManage && row.status === "open" ? (
                <ResolveForm escalationId={row.id as string} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ViewTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full border border-brand bg-brand px-3.5 py-1.5 text-sm font-semibold text-white"
          : "rounded-full border border-line bg-card px-3.5 py-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
      }
    >
      {label}
    </Link>
  );
}

function categoryLabel(key: string): string {
  return ESCALATION_CATEGORY_LABELS[key as EscalationCategory] ?? key;
}
