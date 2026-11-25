"use client";

import { useState, useTransition } from "react";
import { ClipboardList, Copy } from "lucide-react";
import { StatusBadge } from "@/components/admin/badges";
import { Modal } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { getDailyApplicationsReport } from "./new-applications-actions";

const TITLE = "Kunlik arizalar hisoboti";
type Report = Extract<Awaited<ReturnType<typeof getDailyApplicationsReport>>, { status: "ready" }>;

export function DailyApplicationsReport() {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<Report | null>(null);
  const totals = report && [
    report.date.split("-").reverse().join("."),
    "",
    `Jami arizalar: ${report.total} ta`,
    `Telegram username’i bor: ${report.withUsername} ta`,
    `Telegram username’i yo‘q: ${report.total - report.withUsername} ta`,
  ].join("\n");

  function openReport() {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await getDailyApplicationsReport();
        if (result.status === "no_today_review") {
          toast("info", "Bugun «Ko‘rilmoqda»ga o‘tkazilgan ariza topilmadi");
          return;
        }
        if (result.status === "no_yesterday_review") {
          toast("info", "Kecha «Ko‘rilmoqda»ga o‘tkazilgan ariza topilmadi");
          return;
        }
        if (result.status === "no_boundary") {
          toast("info", "Hisobot chegarasidagi ariza topilmadi");
          return;
        }
        if (result.status === "error") throw new Error("Report unavailable");

        setReport(result);
      } catch {
        toast("error", "Hisobotni tayyorlab bo‘lmadi", "Qayta urinib ko‘ring.");
      }
    });
  }

  async function copyReport() {
    if (!totals) return;
    try {
      await navigator.clipboard.writeText(`${TITLE}\n${totals}`);
      toast("success", "Hisobot nusxalandi");
    } catch {
      toast("error", "Nusxalab bo‘lmadi", "Hisobot matnini belgilab, qo‘lda nusxalashingiz mumkin.");
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={openReport} aria-busy={pending} disabled={pending}>
        <ClipboardList className="h-4 w-4" aria-hidden />
        {pending ? "Hisoblanmoqda…" : TITLE}
      </Button>
      <Modal open={report !== null} onClose={() => setReport(null)} title={TITLE}>
        {report && (
          <>
            <pre className="whitespace-pre-wrap rounded-field border border-line bg-surface p-4 font-sans text-sm leading-6 text-ink">
              {totals}
            </pre>
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              {[
                { title: "Boshlanish chegarasi", inclusion: "Hisobga kirmaydi", boundary: report.start },
                { title: "Tugash chegarasi", inclusion: "Hisobga kiradi", boundary: report.end },
              ].map(({ title, inclusion, boundary }) => (
                <div key={title} className="min-w-0 rounded-field border border-line bg-card p-3">
                  <dt className="text-xs font-bold text-ink-soft">{title} · {inclusion}</dt>
                  <dd className="mt-1 space-y-1.5">
                    <p className="break-words text-sm font-semibold text-ink">{boundary.name}</p>
                    <p className="text-xs text-ink-soft">
                      Kelgan vaqti <time dateTime={boundary.receivedAt}>{formatDate(boundary.receivedAt, true)}</time>
                    </p>
                    <p className="text-xs text-ink-soft">
                      «Ko‘rilmoqda»ga o‘tgan vaqti <time dateTime={boundary.reviewedAt}>{formatDate(boundary.reviewedAt, true)}</time>
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                      Hozirgi status <StatusBadge status={boundary.status} />
                    </div>
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={copyReport}>
                <Copy className="h-4 w-4" aria-hidden />
                Nusxalash
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
