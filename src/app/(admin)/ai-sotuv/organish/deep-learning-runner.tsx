"use client";

import { useCallback, useRef, useState } from "react";
import { Brain, Play, RotateCcw } from "lucide-react";
import { Button, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  advanceDeepLearningAction,
  startDeepLearningAction,
  type DeepLearningActionResult,
} from "@/lib/actions/sales";
import { formatEta } from "@/lib/sales/progress-tracker";
import { formatCostUsd } from "@/lib/sales/cost";

/**
 * Chuqur o'rganishni boshqaruvchi klient.
 *
 * NEGA SIKL: 500 ta suhbat bitta server chaqiruviga sig'maydi. Server
 * har chaqiruvda vaqt byudjeti doirasida ishlaydi va holatni qaytaradi,
 * bu komponent esa tugagunicha qayta chaqiradi. Progress SHU JAVOBDAN
 * keladi — ya'ni "327 / 500" bazadan o'qilgan haqiqiy sanoq, taymer
 * chizgan animatsiya emas.
 */

type Snapshot = NonNullable<DeepLearningActionResult["snapshot"]>;

export function DeepLearningRunner({
  defaultTarget,
  defaultBatchSize,
  resumableJobId,
}: {
  defaultTarget: number;
  defaultBatchSize: number;
  resumableJobId: string | null;
}) {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState(String(defaultTarget));
  const [batchSize, setBatchSize] = useState(String(defaultBatchSize));
  // Sikl davomida to'xtatish uchun — komponent yopilsa ham so'rov
  // navbati cheksiz davom etmasin.
  const cancelled = useRef(false);

  const drive = useCallback(
    async (jobId: string) => {
      while (true) {
        if (cancelled.current) return;
        const formData = new FormData();
        formData.set("jobId", jobId);
        const result = await advanceDeepLearningAction(formData);

        if (!result.ok || !result.snapshot) {
          toast("error", "O‘rganish to‘xtadi", result.error);
          return;
        }
        setSnapshot(result.snapshot);
        if (result.snapshot.finished) {
          toast(
            result.snapshot.failedBatches > 0 ? "warning" : "success",
            "O‘rganish yakunlandi",
            `${result.snapshot.processedConversations} ta suhbat, ` +
              `${result.snapshot.processedMessages} ta xabar` +
              (result.snapshot.failedBatches > 0
                ? `, ${result.snapshot.failedBatches} ta batch xato bilan tugadi.`
                : "."),
          );
          return;
        }
      }
    },
    [toast],
  );

  async function start() {
    cancelled.current = false;
    setRunning(true);
    setSnapshot(null);
    try {
      const formData = new FormData();
      formData.set("target", target);
      formData.set("batchSize", batchSize);
      const result = await startDeepLearningAction(formData);

      if (!result.ok || !result.snapshot || !result.jobId) {
        toast("error", "Boshlanmadi", result.error);
        return;
      }
      setSnapshot(result.snapshot);
      if (!result.snapshot.finished) await drive(result.jobId);
      else toast("success", "O‘rganish yakunlandi");
    } finally {
      setRunning(false);
    }
  }

  async function resume(jobId: string) {
    cancelled.current = false;
    setRunning(true);
    try {
      await drive(jobId);
    } finally {
      setRunning(false);
    }
  }

  function stop() {
    // Server tomonda batch checkpointlari saqlangan — to'xtatish
    // ma'lumotni yo'qotmaydi, keyin "Davom ettirish" ishlaydi.
    cancelled.current = true;
    setRunning(false);
    toast("info", "To‘xtatildi", "Bajarilgan batch’lar saqlandi, keyin davom ettirish mumkin.");
  }

  return (
    <section className="rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
        <Brain className="h-4 w-4" /> Chuqur o‘rganish
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        Eng so‘nggi yozishilgan suhbatlarning <b>barcha</b> xabarlari
        ketma-ketligi tahlil qilinadi: savol → javob → keyingi savol.
        O‘zgarmagan suhbat qayta modelga yuborilmaydi.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[160px]">
          <Label htmlFor="target">Suhbatlar soni</Label>
          <Select
            id="target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={running}
          >
            {[50, 100, 250, 500, 1000].map((n) => (
              <option key={n} value={n}>
                Oxirgi {n} ta
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[160px]">
          <Label htmlFor="batchSize">Batch hajmi</Label>
          <Select
            id="batchSize"
            value={batchSize}
            onChange={(e) => setBatchSize(e.target.value)}
            disabled={running}
          >
            {[10, 15, 20, 25].map((n) => (
              <option key={n} value={n}>
                {n} suhbat / chaqiruv
              </option>
            ))}
          </Select>
        </div>

        <Button type="button" variant="ai" onClick={start} disabled={running}>
          <Play className="h-4 w-4" />
          {running ? "Ishlamoqda…" : "O‘rganishni boshlash"}
        </Button>

        {running ? (
          <Button type="button" variant="secondary" onClick={stop}>
            To‘xtatish
          </Button>
        ) : null}

        {!running && resumableJobId ? (
          <Button type="button" variant="secondary" onClick={() => resume(resumableJobId)}>
            <RotateCcw className="h-4 w-4" /> Tugallanmaganini davom ettirish
          </Button>
        ) : null}
      </div>

      {snapshot ? (
        <div className="mt-5 rounded-card border border-line bg-surface p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
              {snapshot.progress.stageLabel}
            </p>
            <p className="font-display text-xl font-semibold text-brand">
              {snapshot.progress.percent.toFixed(1)}%
            </p>
          </div>

          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-card">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-electric transition-all"
              style={{ width: `${Math.min(100, snapshot.progress.percent)}%` }}
            />
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                Suhbatlar
              </dt>
              <dd className="font-semibold text-ink">{snapshot.progress.conversationLabel}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                Xabarlar
              </dt>
              <dd className="font-semibold text-ink">{snapshot.progress.messageLabel}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                ETA
              </dt>
              {/* O'lchash uchun ma'lumot yetmasa "—" — o'ylab topilgan vaqt emas. */}
              <dd className="font-semibold text-ink">{formatEta(snapshot.progress.etaSeconds)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                Token / narx
              </dt>
              <dd className="font-semibold text-ink">
                {snapshot.usage.totalTokens.toLocaleString("uz-UZ")} ·{" "}
                {formatCostUsd(snapshot.estimatedCostUsd)}
              </dd>
            </div>
          </dl>

          {snapshot.failedBatches > 0 ? (
            <p className="mt-3 text-xs text-coral">
              {snapshot.failedBatches} ta batch xato bilan tugadi — qolganlari ishlandi.
            </p>
          ) : null}
          {snapshot.error ? (
            <p className="mt-2 text-xs text-coral">{snapshot.error}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
