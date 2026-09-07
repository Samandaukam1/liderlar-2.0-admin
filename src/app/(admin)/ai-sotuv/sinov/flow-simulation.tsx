"use client";

import { useState, useTransition } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Badge } from "@/components/admin/badges";
import { Button, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { simulateSalesFlowAction } from "@/lib/actions/sales";
import { SALES_STAGE_LABELS, isSalesStage } from "@/lib/sales/flow/stages";
import type { SimulationRun } from "@/lib/sales/flow/simulate";

/**
 * SOTUV OQIMI SIMULYATSIYASI.
 *
 * Telegram'ga HECH NARSA ketmaydi va baza ham o'zgarmaydi: server
 * action sof simulyator funksiyasini chaqiradi. U modulda yuborish
 * yo'li umuman yo'q, shuning uchun bu kafolat bayroqqa emas, kod
 * tuzilishiga tayanadi.
 */

const DEFAULT_SCENARIO = [
  "salom",
  "ha",
  "yo‘q",
  "tanishdim",
  "ha",
  "Maryam",
  "Ravshanova Maryam Rasulovna",
].join("\n");

export function FlowSimulation() {
  const { toast } = useToast();
  const [script, setScript] = useState(DEFAULT_SCENARIO);
  const [run, setRun] = useState<SimulationRun | null>(null);
  const [pending, startTransition] = useTransition();

  function simulate() {
    const inputs = script
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => {
        // "chek" yoki "rasm" so'zi — media xabarni taqlid qiladi.
        if (/^(chek|rasm|skrinshot|photo)$/i.test(line)) {
          return { text: line, messageType: "photo" };
        }
        if (/^(pdf|hujjat|document)$/i.test(line)) {
          return { text: line, messageType: "document" };
        }
        return { text: line };
      });

    startTransition(async () => {
      const formData = new FormData();
      formData.set("inputs", JSON.stringify(inputs));
      const result = await simulateSalesFlowAction(formData);
      if (result.ok && result.run) setRun(result.run);
      else toast("error", "Simulyatsiya ishlamadi", result.error);
    });
  }

  return (
    <section className="rounded-card border border-line bg-card shadow-card">
      <div className="border-b border-line px-5 py-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
          Sales Flow Simulation
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          Har satr — mijozning bitta xabari. <code>chek</code> yoki{" "}
          <code>pdf</code> deb yozsangiz, to‘lov isboti yuborilgani taqlid
          qilinadi. Telegram’ga hech narsa ketmaydi.
        </p>
      </div>

      <div className="space-y-3 px-5 py-4">
        <Textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={8}
          className="font-mono text-xs"
          aria-label="Ssenariy"
        />
        <div className="flex gap-2">
          <Button onClick={simulate} disabled={pending}>
            <Play className="h-4 w-4" /> {pending ? "Ishlamoqda…" : "Ssenariyni o‘ynatish"}
          </Button>
          {run ? (
            <Button variant="ghost" onClick={() => setRun(null)}>
              <RotateCcw className="h-4 w-4" /> Tozalash
            </Button>
          ) : null}
        </div>

        {run ? (
          <div className="space-y-2 pt-2">
            <p className="text-sm text-ink-soft">
              Yakuniy bosqich:{" "}
              <b className="text-ink">
                {isSalesStage(run.finalStage)
                  ? SALES_STAGE_LABELS[run.finalStage]
                  : run.finalStage}
              </b>
              {run.fullName ? ` · F.I.Sh.: ${run.fullName}` : null}
            </p>

            {run.steps.map((step, i) => (
              <article key={i} className="rounded-[10px] border border-line bg-surface p-3">
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-ink">“{step.input}”</span>
                  <Badge accent="lavender">{step.intent}</Badge>
                  <span className="text-ink-soft">
                    {step.stageBefore} → <b className="text-ink">{step.stageAfter}</b>
                  </span>
                </p>

                {step.sent.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {step.sent.map((message, j) => (
                      <li key={j} className="rounded-[8px] bg-card px-2.5 py-1.5">
                        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                          {message.templateKey ?? "havola"}
                        </p>
                        <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-ink">
                          {message.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {step.scheduledFollowups.length > 0 ? (
                  <p className="mt-1.5 text-[11px] text-ink-soft">
                    Rejalashtirildi: {step.scheduledFollowups.join(", ")}
                  </p>
                ) : null}
                {step.cancelledFollowups.length > 0 ? (
                  <p className="mt-1 text-[11px] text-ink-soft">
                    Bekor qilindi: {step.cancelledFollowups.join(", ")}
                  </p>
                ) : null}
                {step.notes.length > 0 ? (
                  <p className="mt-1 text-[11px] text-peach">{step.notes.join(" · ")}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
