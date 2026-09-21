import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import {
  GAP_CLASSIFICATION_LABELS,
  type GapClassification,
} from "@/lib/sales/gaps/gap-classification";
import { MESSAGE_INTENT_LABELS, type MessageIntent } from "@/lib/sales/flow/message-intent";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { AnswerGapForm } from "./answer-gap-form";
import { CleanupControls } from "./cleanup-controls";

export const metadata = { title: "AI Sotuv — Javobsiz savollar" };
export const dynamic = "force-dynamic";

/**
 * BILIM BO'SHLIQLARI (25-band) — QAYTA QURILGAN (22-band).
 *
 * ILGARI bu sahifa har qanday "javob topilmadi" holatini
 * ko'rsatardi va natijada u oddiy muloqot bilan to'lib ketdi:
 * "Hop", "Rahmat", ".", odamlarning ismlari.
 *
 * ENDI ro'yxat TASNIFLANGAN. Navbatda faqat haqiqiy savollar
 * va shubhali yozuvlar qoladi; qolgani arxivda — o'chirilmagan,
 * tekshirish mumkin.
 *
 * SHAXSIY HOLAT savollari bu yerga UMUMAN tushmaydi: ular
 * "Odam kerak" bo'limiga boradi, chunki ularning javobi bilim
 * emas (7-band).
 */
export default async function SalesGapsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await requirePermission("sales.view");
  const canManage = hasPermission(ctx.roles, "sales.manage");
  const { view } = await searchParams;
  const showArchive = view === "arxiv";

  const db = createSupabaseAdminClient();

  const [{ data }, { data: allRows }, { count: escalations }] = await Promise.all([
    db
      .from("sales_knowledge_gaps")
      .select(
        "id, question, ask_count, last_asked_at, ai_fallback, status, answer, kind, classification, classification_reason, message_intent",
      )
      .eq("status", showArchive ? "archived" : "open")
      .order("ask_count", { ascending: false })
      .limit(100),
    // Sanoqlar uchun — yengil ustun.
    db.from("sales_knowledge_gaps").select("status, classification"),
    db
      .from("sales_case_escalations")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
  ]);

  const rows = data ?? [];

  const counts = { open: 0, archived: 0, unclassified: 0 };
  const byClassification: Record<string, number> = {};
  for (const row of allRows ?? []) {
    if (row.status === "open") counts.open += 1;
    if (row.status === "archived") counts.archived += 1;
    const key = (row.classification as string | null) ?? null;
    if (key === null) counts.unclassified += 1;
    else byClassification[key] = (byClassification[key] ?? 0) + 1;
  }

  return (
    <div>
      <PageHeader
        title="Javobsiz savollar"
        description="Mijozlar so‘ragan, lekin bilim bazasida javobi topilmagan HAQIQIY savollar."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Javobsiz savollar" }]}
        actions={canManage ? <CleanupControls /> : undefined}
      />
      <SalesTabs active="gaps" />
      <NoAutoReplyNotice />

      {/* --------------------------- SANOQLAR --------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Navbatda" value={counts.open} accent />
        <Stat label="Arxivda" value={counts.archived} />
        <Stat label="Tasniflanmagan" value={counts.unclassified} />
        <Stat label="Odam kerak" value={escalations ?? 0} />
      </div>

      {Object.keys(byClassification).length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {Object.entries(byClassification)
            .sort((a, b) => b[1] - a[1])
            .map(([key, value]) => (
              <Badge key={key} accent={key === "real_knowledge_gap" ? "mint" : "neutral"}>
                {classificationLabel(key)}: {value}
              </Badge>
            ))}
        </div>
      ) : null}

      <p className="mb-4 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
        AI bu savollarga javob bermadi va fakt <b>o‘ylab topmadi</b>. Salomlashish,
        minnatdorchilik, tasdiq, ism va anketa javoblari bu yerga <b>tushmaydi</b> —
        ular savol emas. Mijozning o‘z holati haqidagi savollar{" "}
        <Link href="/ai-sotuv/topshiriqlar" className="font-semibold text-brand hover:underline">
          «Odam kerak»
        </Link>{" "}
        bo‘limida.
      </p>

      <div className="mb-4 flex gap-1.5">
        <ViewTab href="/ai-sotuv/savollar" label="Navbat" active={!showArchive} />
        <ViewTab href="/ai-sotuv/savollar?view=arxiv" label="Arxiv" active={showArchive} />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
          {showArchive ? "Arxiv bo‘sh." : "Javobsiz savol yo‘q."}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const isCase = row.kind === "case";
            return (
              <li
                key={row.id as string}
                className="rounded-card border border-line bg-card p-4 shadow-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="flex-1 text-sm font-semibold text-ink">
                    <HelpCircle className="mr-1.5 inline h-4 w-4 text-ink-soft" />
                    {row.question as string}
                  </p>
                  <Badge accent={(row.ask_count as number) > 2 ? "coral" : "neutral"}>
                    {row.ask_count as number} marta so‘ralgan
                  </Badge>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {row.classification ? (
                    <Badge
                      accent={row.classification === "real_knowledge_gap" ? "mint" : "neutral"}
                    >
                      {classificationLabel(row.classification as string)}
                    </Badge>
                  ) : (
                    <Badge accent="neutral">tasniflanmagan</Badge>
                  )}
                  {row.message_intent ? (
                    <Badge accent="sky">{intentLabel(row.message_intent as string)}</Badge>
                  ) : null}
                  {isCase ? <Badge accent="peach">shaxsiy holat</Badge> : null}
                  <span className="text-[11px] text-ink-soft">
                    Oxirgi: {formatDate(row.last_asked_at as string)}
                  </span>
                </div>

                {row.classification_reason ? (
                  <p className="mt-1 text-[11px] text-ink-soft">
                    Sabab: {row.classification_reason as string}
                  </p>
                ) : null}

                {row.ai_fallback ? (
                  <p className="mt-2 rounded-card border border-line bg-surface px-3 py-2 text-xs text-ink-soft">
                    <b>AI javobi:</b> {row.ai_fallback as string}
                  </p>
                ) : null}

                {/*
                  SHAXSIY HOLATGA "BILIM BAZASIGA QO'SHISH" TAKLIF
                  QILINMAYDI (8-band). Taqiq amalning o'zida ham bor —
                  bu yerda faqat ko'rinish.
                */}
                {canManage && !isCase && !showArchive ? (
                  <AnswerGapForm gapId={row.id as string} />
                ) : null}

                {isCase ? (
                  <p className="mt-3 rounded-card border border-peach/50 bg-peach/10 px-3 py-2 text-xs text-ink">
                    Javobi aynan shu mijozga tegishli — bilim bazasiga qo‘shilmaydi.{" "}
                    <Link
                      href="/ai-sotuv/topshiriqlar"
                      className="font-semibold text-brand hover:underline"
                    >
                      «Odam kerak» bo‘limi
                    </Link>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-card border border-line bg-card px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={accent ? "text-xl font-bold text-brand" : "text-xl font-bold text-ink"}>
        {value}
      </p>
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

/* Noma'lum kalit ham ko'rsatiladi — sahifa yiqilmasin. */
function classificationLabel(key: string): string {
  return GAP_CLASSIFICATION_LABELS[key as GapClassification] ?? key;
}

function intentLabel(key: string): string {
  return MESSAGE_INTENT_LABELS[key as MessageIntent] ?? key;
}
