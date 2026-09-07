import { MessagesSquare } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { getResponseLibrary } from "@/lib/sales/repository";
import { rankPatternsByOutcome } from "@/lib/sales/aggregate";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { PatternCard } from "./pattern-card";

export const metadata = { title: "AI Sotuv — Javoblar" };
export const dynamic = "force-dynamic";

const VARIANT_LETTERS = "ABCDEFGHIJKLMNOP";

/**
 * "Qaysi xabarga qanday javob" ko'rinishi.
 *
 * Har niyat ostida variantlar NATIJA bo'yicha saralangan: eng ko'p
 * ishlatilgani emas, eng yaxshi ishlagani yuqorida turadi. Natijasi
 * butunlay noma'lum variantlar ular ostiga tushadi — noma'lum hech
 * qachon "eng yaxshi" bo'lib ko'rinmasligi kerak.
 */
export default async function SalesResponsesPage() {
  const ctx = await requirePermission("sales.view");
  const canManage = hasPermission(ctx.roles, "sales.manage");

  const library = await getResponseLibrary(25);
  const withPatterns = library.filter((group) => group.patterns.length > 0);

  return (
    <div>
      <PageHeader
        title="Javoblar"
        description="Mijoz savoli → biz bergan javob variantlari, chastota va natija bilan."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Javoblar" }]}
      />
      <SalesTabs active="responses" />
      <NoAutoReplyNotice />

      <p className="mb-6 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
        Variantlar <strong className="font-bold text-ink">natija bo‘yicha</strong> saralangan:
        yuqorida eng ko‘p ishlatilgani emas, eng yaxshi natija bergani turadi.
        “Natija noma’lum” yozuvi 0% dan farq qiladi — u “bu javob ishlamadi”
        emas, “hali baholay olmaymiz” degani.
      </p>

      {withPatterns.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare className="h-7 w-7" />}
          title="Javob kutubxonasi bo‘sh"
          description="O‘rganish sahifasidagi “Chuqur o‘rganish” ishga tushirilgach, savol-javob juftlari shu yerda to‘planadi."
        />
      ) : (
        <div className="space-y-5">
          {withPatterns.map(({ intent, patterns }) => {
            const ranked = rankPatternsByOutcome(patterns);
            return (
              <section key={intent.id} className="rounded-card border border-line bg-card p-5 shadow-card">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-base font-semibold text-ink">{intent.label}</h2>
                  <Badge accent={intent.kind === "objection" ? "coral" : "sky"}>
                    {intent.kind === "objection" ? "e’tiroz" : "savol"}
                  </Badge>
                  <span className="text-xs text-ink-soft">
                    {intent.occurrences} marta · {intent.share.toFixed(1)}% ·{" "}
                    {intent.conversationCount} ta suhbat
                  </span>
                </div>

                {intent.examples.length > 0 ? (
                  <div className="mb-4">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                      Mijoz shunday so‘raydi
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {intent.examples.slice(0, 6).map((example) => (
                        <span
                          key={example}
                          className="rounded-badge bg-surface px-2 py-0.5 text-xs text-ink"
                        >
                          {example}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2.5">
                  {ranked.map((pattern, i) => (
                    <PatternCard
                      key={pattern.id}
                      id={pattern.id}
                      label={pattern.intentLabel}
                      responseExample={pattern.responseExample}
                      frequency={pattern.frequency}
                      successCount={pattern.successCount}
                      unknownCount={pattern.unknownCount}
                      successRate={pattern.successRate}
                      status={pattern.status}
                      conversationIds={pattern.conversationIds}
                      canManage={canManage}
                      variant={VARIANT_LETTERS[i] ?? String(i + 1)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
