"use client";

import { useState, useTransition } from "react";
import { ClipboardList, Copy } from "lucide-react";
import { Modal } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { getDailyApplicationsReport } from "./new-applications-actions";

const TITLE = "Kunlik arizalar hisoboti";

export function DailyApplicationsReport() {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<string | null>(null);

  function openReport() {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await getDailyApplicationsReport();
        if (result.status === "no_export") {
          toast("info", "Bugungi eksport qaydi topilmadi");
          return;
        }
        if (result.status === "no_boundary") {
          toast("info", "Hisobotning boshlanish chegarasi topilmadi");
          return;
        }
        if (result.status === "error") throw new Error("Report unavailable");

        setReport([
          TITLE,
          result.date.split("-").reverse().join("."),
          "",
          `Jami arizalar: ${result.total} ta`,
          `Telegram username’i bor: ${result.withUsername} ta`,
          `Telegram username’i yo‘q: ${result.total - result.withUsername} ta`,
        ].join("\n"));
      } catch {
        toast("error", "Hisobotni tayyorlab bo‘lmadi", "Qayta urinib ko‘ring.");
      }
    });
  }

  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
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
              {report.slice(TITLE.length + 1)}
            </pre>
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
