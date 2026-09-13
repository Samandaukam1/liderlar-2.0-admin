"use client";

import { useCallback, useRef, useState } from "react";
import { Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  advanceMiningRunAction,
  startMiningRunAction,
  cancelMiningRunAction,
} from "@/lib/actions/sales";
import type { MiningRunRow } from "@/lib/sales/mining/intelligence-repo";
import { COVERAGE_LABELS } from "@/lib/sales/mining/coverage";
import { RUN_STATUS_LABELS } from "@/lib/sales/mining/run-types";

/**
 * QAZISH YUGURISHINI BOSHQARUVCHI KLIENT.
 *
 * NEGA SIKL: 777 suhbat bitta server chaqiruviga sig'maydi. Server
 * vaqt byudjeti doirasida ishlaydi va kursorni bazaga yozadi; bu
 * komponent esa tugagunicha qayta chaqiradi.
 *
 * PROGRESS BAZADAN KELADI, taymer chizgan animatsiya emas. ETA ham
 * shunday: u KUZATILGAN tezlikdan hisoblanadi va tezlik hali
 * o'lchanmagan bo'lsa umuman ko'rsatilmaydi.
 */
export function MiningRunner({
  activeRun,
  runs,
}: {
  activeRun: MiningRunRow | null;
  runs: MiningRunRow[];
}) {
  const { toast } = useToast();
  const [running, setRunning] = useState(activeRun != null);
  const [current, setCurrent] = useState<MiningRunRow | null>(activeRun);
  const cancelled = useRef(false);

  const drive = useCallback(
    async (runId: string) => {
      // Cheksiz sikldan himoya: server kursor siljimasa `completed`
      // yoki `failed` qaytaradi, lekin qadamlar soni ham cheklanadi.
      for (let step = 0; step < 500; step += 1) {
        if (cancelled.current) return;

        const formData = new FormData();
        formData.set("runId", runId);
        const result = await advanceMiningRunAction(formData);

        if (!result.ok) {
          toast("error", "Qazish to‘xtadi", result.error);
          setRunning(false);
          return;
        }
        if (result.status === "completed") {
          toast("success", "Qazish yakunlandi", "Natijalar saqlandi — sahifani yangilang.");
          setRunning(false);
          return;
        }
        if (result.status === "failed" || result.status === "cancelled") {
          toast("warning", "Qazish tugadi", RUN_STATUS_LABELS[result.status]);
          setRunning(false);
          return;
        }
      }
      toast("warning", "Qazish uzun davom etdi", "Davom ettirish uchun qayta bosing.");
      setRunning(false);
    },
    [toast],
  );

  const start = useCallback(
    async (kind: "incremental" | "full_rebuild") => {
      cancelled.current = false;
      setRunning(true);

      const formData = new FormData();
      formData.set("kind", kind);
      const result = await startMiningRunAction(formData);

      if (!result.ok || !result.runId) {
        toast("error", "Boshlab bo‘lmadi", result.error);
        setRunning(false);
        return;
      }
      if (result.status === "completed") {
        toast("success", "Qazish yakunlandi", "Natijalar saqlandi — sahifani yangilang.");
        setRunning(false);
        return;
      }
      await drive(result.runId);
    },
    [drive, toast],
  );

  const stop = useCallback(async () => {
    if (!current) return;
    cancelled.current = true;
    const formData = new FormData();
    formData.set("runId", current.id);
    await cancelMiningRunAction(formData);
    setRunning(false);
    setCurrent(null);
    toast("info", "Bekor qilindi", "Yarim natija saqlandi, qamrov “qisman” deb belgilandi.");
  }, [current, toast]);

  return (
    <div className="rounded-card border border-line bg-card p-4 shadow-card">
      <h2 className="mb-1 text-sm font-bold text-ink">Qazish yugurishi</h2>
      <p className="mb-3 text-xs text-ink-soft">
        Tahlil <b>siz bosganda</b> ishlaydi, sahifa ochilganda emas. Shuning uchun
        ko‘rsatilgan raqamlar qaysi yugurishdan kelgani aniq bo‘ladi.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" onClick={() => start("incremental")} disabled={running}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Yangilash (faqat yangi xabarlar)
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => start("full_rebuild")}
          disabled={running}
        >
          <Play className="mr-1.5 h-4 w-4" />
          To‘liq qayta qurish
        </Button>
        {running ? (
          <Button type="button" variant="ghost" onClick={stop}>
            To‘xtatish
          </Button>
        ) : null}
      </div>

      <p className="mb-3 text-xs text-ink-soft">
        To‘liq qayta qurish natijasi <b>o‘z-o‘zidan faollashmaydi</b>: yangi uslub
        profili qoralama bo‘lib qoladi va uni siz faollashtirasiz.
      </p>

      {runs.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="border-b border-line text-left text-ink-soft">
              <tr>
                <th className="py-1.5 font-semibold">Turi</th>
                <th className="py-1.5 font-semibold">Holat</th>
                <th className="py-1.5 font-semibold">Qamrov</th>
                <th className="py-1.5 text-right font-semibold">Suhbat</th>
                <th className="py-1.5 text-right font-semibold">Xabar</th>
                <th className="py-1.5 text-right font-semibold">Tezlik</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 text-ink-soft">
                    {run.kind === "full_rebuild" ? "To‘liq" : "Yangilash"}
                  </td>
                  <td className="py-1.5 text-ink">{RUN_STATUS_LABELS[run.status]}</td>
                  <td className="py-1.5">
                    <span
                      className={
                        run.coverageStatus === "full" ? "text-ink" : "font-semibold text-coral"
                      }
                    >
                      {COVERAGE_LABELS[run.coverageStatus]}
                    </span>
                  </td>
                  <td className="py-1.5 text-right text-ink">
                    {run.conversationsProcessed} / {run.conversationsDiscovered}
                  </td>
                  <td className="py-1.5 text-right text-ink-soft">{run.messagesProcessed}</td>
                  <td className="py-1.5 text-right text-ink-soft">
                    {/* ETA VA TEZLIK — O'LCHANGAN. O'lchanmagan bo'lsa
                        son ko'rsatilmaydi (45-band). */}
                    {run.measuredRatePerSec == null
                      ? "o‘lchanmadi"
                      : `${run.measuredRatePerSec}/sek`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
