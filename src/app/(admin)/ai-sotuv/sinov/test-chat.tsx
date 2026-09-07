"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  RotateCcw,
  Send,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/admin/badges";
import { Button, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { sendTestChatMessageAction, type TestChatActionResult } from "@/lib/actions/sales";
import { formatCostUsd } from "@/lib/sales/cost";

/**
 * Sinov oynasi — admin mijoz rolida yozadi, AI sotuvchi javob beradi.
 *
 * Telegram'ga HECH NARSA ketmaydi: bu komponent server action'ni
 * chaqiradi, u esa faqat OpenAI bilan gaplashib javobni qaytaradi.
 */

type Result = NonNullable<TestChatActionResult["result"]>;

interface Turn {
  role: "customer" | "assistant";
  text: string;
  /** Faqat AI javobida bo'ladi. */
  result?: Result;
}

export function TestChat({ canRun }: { canRun: boolean }) {
  const { toast } = useToast();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  async function send() {
    const message = draft.trim();
    if (!message || pending) return;

    // Kontekst SERVERGA yuboriladi — model oldingi gaplarni unutmasligi
    // uchun. Yangi javob kelgunicha optimistik ravishda ko'rsatiladi.
    const history = turns.map((turn) => ({ role: turn.role, text: turn.text }));
    setTurns((prev) => [...prev, { role: "customer", text: message }]);
    setDraft("");
    setPending(true);

    try {
      const formData = new FormData();
      formData.set("message", message);
      formData.set("history", JSON.stringify(history));
      const response = await sendTestChatMessageAction(formData);

      if (!response.ok || !response.result) {
        toast("error", "Javob olinmadi", response.error);
        // Yuborilgan xabar qoladi — admin qayta urinishi mumkin.
        return;
      }
      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: response.result!.reply, result: response.result },
      ]);
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setTurns([]);
    setDraft("");
  }

  return (
    <div className="rounded-card border border-line bg-card shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
          Sinov suhbati
        </p>
        <Button size="sm" variant="ghost" onClick={reset} disabled={turns.length === 0}>
          <RotateCcw className="h-3.5 w-3.5" /> Yangi suhbat
        </Button>
      </div>

      <div className="max-h-[520px] space-y-3 overflow-y-auto px-5 py-4">
        {turns.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-soft">
            Mijoz rolida yozing — masalan “Assalomu alaykum, narxi qancha?”
          </p>
        ) : (
          turns.map((turn, i) => (
            <div key={i}>
              <div
                className={
                  turn.role === "customer"
                    ? "ml-auto max-w-[80%] rounded-card border border-line bg-surface px-4 py-2.5"
                    : "max-w-[85%] rounded-card border border-brand/30 bg-brand/8 px-4 py-2.5"
                }
              >
                <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                  {turn.role === "customer" ? "Mijoz (siz)" : "AI sotuvchi"}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-ink">{turn.text}</p>
              </div>
              {turn.result ? <Diagnostics result={turn.result} /> : null}
            </div>
          ))
        )}
        {pending ? (
          <p className="text-sm text-ink-soft">AI javob yozmoqda…</p>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line px-5 py-4">
        {canRun ? (
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="Mijoz rolida yozing…"
              disabled={pending}
              aria-label="Sinov xabari"
            />
            <Button onClick={send} disabled={pending || draft.trim() === ""}>
              <Send className="h-4 w-4" /> Yuborish
            </Button>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">
            Sinov chatdan foydalanish uchun <b>sales.learn</b> ruxsati kerak
            (har xabar pullik AI chaqiruvi qiladi).
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ diagnostika ------------------------------ */

function Diagnostics({ result }: { result: Result }) {
  const [open, setOpen] = useState(false);
  const d = result.diagnostics;

  return (
    <div className="mt-1.5 max-w-[85%] rounded-[10px] border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
        <span>
          Intent:{" "}
          <b className="text-ink">{d.intentKey ?? "aniqlanmadi"}</b>
          {d.intentKey && !d.intentKnown ? (
            <Badge accent="peach" className="ml-1">
              yangi
            </Badge>
          ) : null}
        </span>
        <span>
          Knowledge: <b className="text-ink">{d.knowledgeCount} ta</b>
        </span>
        <span>
          Response patterns: <b className="text-ink">{d.patternCount} ta</b>
        </span>
        <span>
          Style profile:{" "}
          <b className="text-ink">{d.styleProfileActive ? "active" : "yo‘q"}</b>
        </span>
        <span>
          Confidence: <b className="text-ink">{Math.round(d.confidence * 100)}%</b>
        </span>
      </div>

      {d.missingKnowledge ? (
        <p className="mt-2 flex items-center gap-1.5 rounded-[8px] bg-peach/20 px-2 py-1 text-[11px] font-bold text-[#b3611f]">
          <ShieldAlert className="h-3.5 w-3.5" />
          MISSING_KNOWLEDGE — bu savol bo‘yicha tasdiqlangan bilim yo‘q, AI
          fakt aytmasligi kerak edi.
        </p>
      ) : null}

      {d.unsupportedNumbers.length > 0 ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-[8px] bg-coral/15 px-2 py-1 text-[11px] font-bold text-[#c43d3d]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Manbada yo‘q son: {d.unsupportedNumbers.join(", ")} — bu javobni
            ishlatib bo‘lmaydi.
          </span>
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
        <span>
          in {result.usage.promptTokens} / out {result.usage.completionTokens} token
        </span>
        <span>{formatCostUsd(result.estimatedCostUsd)}</span>
        <span>{result.latencyMs} ms</span>
        <span>{result.model}</span>
        {d.sources.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 font-semibold text-brand hover:underline"
          >
            Manbalarni ko‘rish
            <ChevronDown className={open ? "h-3 w-3 rotate-180" : "h-3 w-3"} />
          </button>
        ) : null}
      </div>

      {open ? (
        <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
          {d.sources.map((source) => (
            <li key={`${source.kind}-${source.id}`} className="rounded-[8px] bg-card px-2.5 py-2">
              <p className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                <Badge accent={source.kind === "knowledge" ? "sky" : "lavender"}>
                  {source.kind === "knowledge" ? "bilim" : "shablon"}
                </Badge>
                <span className="normal-case tracking-normal">{source.meta}</span>
                {source.sourceConversationId ? (
                  <Link
                    href={`/ai-sotuv/suhbatlar/${source.sourceConversationId}`}
                    className="inline-flex items-center gap-1 normal-case tracking-normal text-brand hover:underline"
                  >
                    manba suhbat <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : null}
              </p>
              <p className="mt-1 text-xs font-semibold text-ink">{source.title}</p>
              <p className="mt-0.5 line-clamp-3 text-xs text-ink-soft">{source.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
