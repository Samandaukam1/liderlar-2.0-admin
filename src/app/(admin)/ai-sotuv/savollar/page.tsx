import { HelpCircle } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { AnswerGapForm } from "./answer-gap-form";

export const metadata = { title: "AI Sotuv — Javobsiz savollar" };
export const dynamic = "force-dynamic";

/**
 * BILIM BO'SHLIQLARI (25-band).
 *
 * Har safar AI "bilmayman" deb javob berganda savol shu yerga
 * tushadi. Bu tasodifiy ro'yxat emas: u AYNAN mijozlar so'ragan va
 * javob topilmagan savollar, eng ko'p so'ralganidan boshlab.
 *
 * MODEL TAXMINI AVTOMATIK BILIMGA AYLANMAYDI. "AI nima degani"
 * ustuni faqat ma'lumot uchun: javobni odam yozadi.
 */
export default async function SalesGapsPage() {
  const ctx = await requirePermission("sales.view");
  const canManage = hasPermission(ctx.roles, "sales.manage");

  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("sales_knowledge_gaps")
    .select("id, question, ask_count, last_asked_at, ai_fallback, status, answer")
    .eq("status", "open")
    .order("ask_count", { ascending: false })
    .limit(100);

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Javobsiz savollar"
        description="Mijozlar so‘ragan, lekin bilim bazasida javobi topilmagan savollar."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Javobsiz savollar" }]}
      />
      <SalesTabs active="gaps" />
      <NoAutoReplyNotice />

      <p className="mb-4 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
        AI bu savollarga javob bermadi va fakt <b>o‘ylab topmadi</b> — buning
        o‘rniga aniqlashtirishni va’da qildi. Javobni siz yozasiz; tasdiqlangan
        javob bilim bazasiga tushadi va keyingi safar AI o‘zi javob beradi.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
          Javobsiz savol yo‘q.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id as string} className="rounded-card border border-line bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="flex-1 text-sm font-semibold text-ink">
                  <HelpCircle className="mr-1.5 inline h-4 w-4 text-ink-soft" />
                  {row.question as string}
                </p>
                <Badge accent={(row.ask_count as number) > 2 ? "coral" : "neutral"}>
                  {row.ask_count as number} marta so‘ralgan
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-ink-soft">
                Oxirgi: {formatDate(row.last_asked_at as string)}
              </p>
              {row.ai_fallback ? (
                <p className="mt-2 rounded-card border border-line bg-surface px-3 py-2 text-xs text-ink-soft">
                  <b>AI javobi:</b> {row.ai_fallback as string}
                </p>
              ) : null}
              {canManage ? <AnswerGapForm gapId={row.id as string} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
