"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ListChecks,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { diffWords, diffStats, type DiffOp } from "@/lib/diff";
import { Button, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface ImprovePayload {
  improved: string;
  facts: string[];
  warnings: string[];
}

export function AIDiffViewer({ ops }: { ops: DiffOp[] }) {
  return (
    <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-[16px] border border-line bg-surface/60 p-4 text-sm leading-relaxed">
      {ops.map((op, i) =>
        op.type === "same" ? (
          <span key={i}>{op.text}</span>
        ) : op.type === "added" ? (
          <mark key={i} className="rounded bg-mint/30 px-0.5 text-[#14563f]">
            {op.text}
          </mark>
        ) : (
          <del key={i} className="rounded bg-coral/20 px-0.5 text-[#a33232]">
            {op.text}
          </del>
        ),
      )}
    </div>
  );
}

export function AIProcessingPanel({ label = "Jaxongir AI matn ustida ishlamoqda…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-lavender/40 bg-gradient-to-r from-electric/5 via-lavender/10 to-cyan/5 p-4">
      <span className="ai-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white">
        <Sparkles className="h-4.5 w-4.5" />
      </span>
      <div className="flex-1">
        <p className="text-sm font-bold text-ink">{label}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-lavender/20">
          <div className="ai-gradient h-full w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * The full "Jaxongir AI bilan yaxshilash" flow: original → suggestion with
 * word diff, fact list and warnings. Nothing is auto-published — the admin
 * accepts, edits or rejects.
 */
export function AIImprovePanel({
  original,
  candidateName,
  entityType,
  entityId,
  initialSuggestion,
  onAccept,
  acceptLabel = "Qabul qilish va saqlash",
}: {
  original: string;
  candidateName?: string;
  entityType: "monthly_update" | "article" | "playground";
  entityId?: string | null;
  initialSuggestion?: string | null;
  /** Called with the accepted text; parent persists it (server action). */
  onAccept?: (text: string) => Promise<void> | void;
  acceptLabel?: string;
}) {
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ImprovePayload | null>(
    initialSuggestion ? { improved: initialSuggestion, facts: [], warnings: [] } : null,
  );
  const [editMode, setEditMode] = useState(false);
  const [edited, setEdited] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  const ops = useMemo(
    () => (result ? diffWords(original, editMode ? edited : result.improved) : []),
    [original, result, editMode, edited],
  );
  const stats = useMemo(() => diffStats(ops), [ops]);

  async function run() {
    setProcessing(true);
    setAccepted(false);
    try {
      const res = await fetch("/api/ai/improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: original, candidateName, entityType, entityId }),
      });
      const json = (await res.json()) as ImprovePayload & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "AI xatosi");
      setResult(json);
      setEdited(json.improved);
      setEditMode(false);
    } catch (e) {
      toast("error", "Jaxongir AI xatosi", e instanceof Error ? e.message : undefined);
    } finally {
      setProcessing(false);
    }
  }

  async function accept() {
    if (!result || !onAccept) return;
    setSaving(true);
    try {
      await onAccept(editMode ? edited : result.improved);
      setAccepted(true);
      toast("success", "AI taklifi qabul qilindi");
    } catch (e) {
      toast("error", "Saqlab bo‘lmadi", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-card border-2 border-lavender/35 bg-gradient-to-br from-card via-card to-lavender/[0.06] p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
          <span className="ai-gradient flex h-7 w-7 items-center justify-center rounded-lg text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          Jaxongir AI — tahririy yordamchi
        </h3>
        {!processing && (
          <Button variant="ai" size="sm" onClick={run}>
            <Sparkles className="h-4 w-4" />
            {result ? "Qayta yozdirish" : "Jaxongir AI bilan yaxshilash"}
          </Button>
        )}
      </div>

      {processing && <AIProcessingPanel />}

      <AnimatePresence>
        {result && !processing && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className="rounded-badge bg-mint/25 px-2 py-0.5 text-[#1d8a6b]">
                +{stats.added} so‘z qo‘shildi
              </span>
              <span className="rounded-badge bg-coral/15 px-2 py-0.5 text-[#c43d3d]">
                −{stats.removed} so‘z olib tashlandi
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
                  Original matn
                </p>
                <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-[16px] border border-line bg-card p-4 text-sm leading-relaxed text-ink-soft">
                  {original}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#6a52c7]">
                  AI taklifi (diff)
                </p>
                {editMode ? (
                  <Textarea
                    rows={12}
                    value={edited}
                    onChange={(e) => setEdited(e.target.value)}
                    aria-label="AI taklifini qo‘lda tahrirlash"
                  />
                ) : (
                  <AIDiffViewer ops={ops} />
                )}
              </div>
            </div>

            {result.facts.length > 0 && (
              <div className="rounded-[16px] border border-sky/40 bg-sky/8 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[#1873a8]">
                  <ListChecks className="h-4 w-4" /> Faktlar ro‘yxati (AI o‘zgartirmagan bo‘lishi shart)
                </p>
                <ul className="grid grid-cols-1 gap-1 text-xs text-ink sm:grid-cols-2">
                  {result.facts.map((f, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#1873a8]" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="rounded-[16px] border border-peach/50 bg-peach/10 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[#b3611f]">
                  <AlertTriangle className="h-4 w-4" /> Ogohlantirishlar — tekshirib chiqing
                </p>
                <ul className="space-y-1 text-xs text-ink">
                  {result.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {onAccept && !accepted && (
                <Button variant="success" size="sm" onClick={accept} disabled={saving}>
                  <Check className="h-4 w-4" />
                  {saving ? "Saqlanmoqda…" : acceptLabel}
                </Button>
              )}
              {accepted && (
                <span className="flex items-center gap-1.5 text-sm font-bold text-[#2e7d44]">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                    <path
                      d="M4 10.5l4 4 8-9"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="check-draw"
                    />
                  </svg>
                  Qabul qilindi
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditMode((v) => !v);
                  if (!editMode && result) setEdited(edited || result.improved);
                }}
              >
                {editMode ? "Diff ko‘rinishi" : "Qo‘lda tahrirlash"}
              </Button>
              <Button variant="ghost" size="sm" onClick={run}>
                <RefreshCw className="h-4 w-4" /> Qayta yozdirish
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn("text-coral hover:bg-coral/10")}
                onClick={() => {
                  setResult(null);
                  setAccepted(false);
                }}
              >
                <X className="h-4 w-4" /> Rad etish
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!result && !processing && (
        <p className="text-xs leading-relaxed text-ink-soft">
          AI imlo va uslubni tuzatadi, birinchi shaxsni uchinchi shaxsga o‘tkazadi,
          faktlarni o‘zgartirmaydi. Natija avtomatik e’lon qilinmaydi — siz diff’ni
          ko‘rib, qabul qilasiz, tahrirlaysiz yoki rad etasiz.
        </p>
      )}
    </section>
  );
}
