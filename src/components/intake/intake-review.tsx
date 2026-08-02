"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Wand2,
  Camera,
  Check,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  MessageCircleQuestion,
  AlertTriangle,
  ShieldCheck,
  Send,
  Maximize2,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Textarea, Card } from "@/components/ui/primitives";
import { Badge, StatusBadge } from "@/components/admin/badges";
import { Modal, ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  approveIntakeAction,
  requestClarificationAction,
  promoteIntakeAction,
  publishIntakeAction,
  saveFinalAnswerAction,
  selectPhotoAction,
} from "@/lib/actions/intakes";

export interface AnswerFull {
  question_no: number;
  prompt: string;
  plain_text: string;
  ai_improved_text: string | null;
  ai_removed_segments: { text: string; reason: string }[];
  ai_fact_flags: { type: string; claim: string; explanation: string }[];
  ai_clarification_questions: string[];
  ai_confidence: number | null;
  ai_fact_preservation: FactPreservationView | null;
  final_text: string | null;
  editor_state: string;
  moderation_flagged: boolean;
}

/** Written by the ai-improve route; absent on answers improved before the check existed. */
export interface FactPreservationView {
  ok: boolean;
  detected: number;
  preserved: number;
  missing: { kind: string; value: string }[];
  retries: number;
  kept_original: boolean;
}
export interface PhotoEditView {
  id: string;
  url: string | null;
  is_selected: boolean;
  status: string;
  prompt: string;
}

export function IntakeReview({
  intakeId,
  status,
  fullName,
  answers,
  original,
  photoEdits,
  photoPrompts,
  globalAi,
}: {
  intakeId: string;
  status: string;
  fullName: string;
  answers: AnswerFull[];
  original: { url: string | null; file_name: string } | null;
  photoEdits: PhotoEditView[];
  photoPrompts: { default: string; male: string; female: string };
  globalAi: {
    biography_draft: string | null;
    short_bio: string | null;
    editorial_commentary: string | null;
    moderation_summary: string | null;
    global_fact_conflicts: string[];
    ai_ready_for_review: boolean;
  };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-6">
        <GlobalAiBar intakeId={intakeId} status={status} globalAi={globalAi} />
        <AnswersPanel intakeId={intakeId} answers={answers} />
        {globalAi.biography_draft && <BiographyPanel globalAi={globalAi} />}
      </div>

      <aside className="space-y-6">
        <PhotoPanel
          intakeId={intakeId}
          original={original}
          edits={photoEdits}
          prompts={photoPrompts}
        />
        <ActionsBar
          intakeId={intakeId}
          status={status}
          fullName={fullName}
          pending={pending}
          run={(fn, ok) =>
            startTransition(async () => {
              const r = await fn();
              if (r.ok) {
                toast.toast("success", ok);
                if (r.candidateId) router.push(`/candidates/${r.candidateId}`);
                else router.refresh();
              } else {
                toast.toast("error", "Xatolik", r.error);
              }
            })
          }
        />
      </aside>
    </div>
  );
}

/* --------------------------- global AI --------------------------- */

function GlobalAiBar({
  intakeId,
  status,
  globalAi,
}: {
  intakeId: string;
  status: string;
  globalAi: { moderation_summary: string | null; global_fact_conflicts: string[]; ai_ready_for_review: boolean };
}) {
  const router = useRouter();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const idemKey = useRef(crypto.randomUUID());

  const runAll = async () => {
    idemKey.current = crypto.randomUUID(); // fresh idempotent op per explicit click
    setRunning(true);
    try {
      const res = await fetch(`/api/admin/intakes/${intakeId}/ai-improve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotency_key: idemKey.current }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        toast.toast("success", "Jaxongir AI barcha javoblarni yaxshiladi");
        router.refresh();
      } else {
        toast.toast("error", "AI xatosi", json.error);
      }
    } catch {
      toast.toast("error", "Tarmoq xatosi");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-electric/20 bg-gradient-to-br from-brand/[0.03] to-lavender/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl ai-gradient text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-bold text-ink">Jaxongir AI muharrir</h3>
            <p className="text-xs text-ink-soft">Imlo, uslub, uchinchi shaxs, fakt bayroqlari va biografiya drafti</p>
          </div>
        </div>
        <Button variant="ai" onClick={runAll} disabled={running || status === "published"}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          Barcha javoblarni yaxshilash
        </Button>
      </div>

      {globalAi.moderation_summary && (
        <div className="mt-4 flex items-start gap-2 rounded-field border border-peach/50 bg-peach/10 p-3 text-sm text-amber">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{globalAi.moderation_summary}</span>
        </div>
      )}
      {globalAi.global_fact_conflicts.length > 0 && (
        <div className="mt-3 rounded-field border border-coral/30 bg-coral/5 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-coral">Fakt ziddiyatlari</p>
          <ul className="space-y-1 text-sm text-ink-soft">
            {globalAi.global_fact_conflicts.map((c, i) => <li key={i}>• {c}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* --------------------------- answers --------------------------- */

function AnswersPanel({ intakeId, answers }: { intakeId: string; answers: AnswerFull[] }) {
  return (
    <div className="space-y-4">
      {answers.map((a) => (
        <AnswerCard key={a.question_no} intakeId={intakeId} answer={a} />
      ))}
    </div>
  );
}

function AnswerCard({ intakeId, answer }: { intakeId: string; answer: AnswerFull }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [finalText, setFinalText] = useState(answer.final_text ?? answer.ai_improved_text ?? answer.plain_text);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyText, setClarifyText] = useState(answer.ai_clarification_questions[0] ?? "");

  const saveFinal = (state: "accepted" | "partially_accepted" | "rejected" | "manual") =>
    startTransition(async () => {
      const r = await saveFinalAnswerAction(intakeId, answer.question_no, finalText, state);
      if (r.ok) {
        toast.toast("success", "Yakuniy javob saqlandi");
        router.refresh();
      } else toast.toast("error", "Xatolik", r.error);
    });

  const sendClarify = () =>
    startTransition(async () => {
      const r = await requestClarificationAction(intakeId, clarifyText, answer.question_no);
      if (r.ok) {
        toast.toast("success", "Aniqlashtirish so‘raldi");
        setClarifyOpen(false);
        router.refresh();
      } else toast.toast("error", "Xatolik", r.error);
    });

  return (
    <Card className={cn(answer.moderation_flagged && "border-coral/40")}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold text-ink">
          <span className="mr-1.5 text-brand">{answer.question_no}.</span>
          {answer.prompt}
        </h4>
        <div className="flex shrink-0 items-center gap-1.5">
          {answer.moderation_flagged && <Badge accent="coral">Moderatsiya</Badge>}
          {answer.editor_state !== "pending" && <StatusBadge status={answer.editor_state} />}
          {answer.ai_confidence != null && (
            <Badge accent={answer.ai_confidence >= 0.7 ? "mint" : "peach"}>
              {Math.round(answer.ai_confidence * 100)}%
            </Badge>
          )}
        </div>
      </div>

      {/* Original vs AI */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-field border border-line bg-surface/40 p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft">Asl matn</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{answer.plain_text || "—"}</p>
        </div>
        <div className="rounded-field border border-electric/20 bg-brand/[0.03] p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-brand">AI variant</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{answer.ai_improved_text || "— (AI hali ishlamagan)"}</p>
        </div>
      </div>

      {/* Lost facts — the loudest warning on the card: the AI variant dropped
          something the candidate actually wrote. */}
      {answer.ai_fact_preservation && !answer.ai_fact_preservation.ok && (
        <div className="mt-3 rounded-field border border-coral/40 bg-coral/10 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-coral">
            <AlertTriangle className="h-3.5 w-3.5" />
            Yo‘qolgan faktlar ({answer.ai_fact_preservation.missing.length})
          </p>
          <ul className="space-y-0.5 text-xs text-ink-soft">
            {answer.ai_fact_preservation.missing.map((fact, i) => (
              <li key={i}>• {fact.value}</li>
            ))}
          </ul>
          {answer.ai_fact_preservation.kept_original && (
            <p className="mt-1.5 text-xs font-semibold text-coral">
              {answer.ai_fact_preservation.retries} marta qayta urinildi — fakt saqlanmagani uchun ASL matn qoldirildi.
            </p>
          )}
        </div>
      )}
      {answer.ai_fact_preservation?.ok && answer.ai_fact_preservation.detected > 0 && (
        <p className="mt-2 text-[11px] text-mint">
          ✓ {answer.ai_fact_preservation.detected} ta aniq ma’lumot saqlandi
          {answer.ai_fact_preservation.retries > 0 && ` (${answer.ai_fact_preservation.retries} marta qayta urinish bilan)`}
        </p>
      )}

      {/* Fact flags & removed segments */}
      {answer.ai_fact_flags.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {answer.ai_fact_flags.map((f, i) => (
            <div key={i} className="flex items-start gap-2 rounded-field border border-amber/30 bg-amber/5 p-2 text-xs">
              <Badge accent="amber">{f.type}</Badge>
              <span className="text-ink-soft"><b className="text-ink">{f.claim}</b> — {f.explanation}</span>
            </div>
          ))}
        </div>
      )}
      {answer.ai_removed_segments.length > 0 && (
        <div className="mt-2 rounded-field border border-coral/25 bg-coral/5 p-2">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-coral">Olib tashlangan</p>
          {answer.ai_removed_segments.map((s, i) => (
            <p key={i} className="text-xs text-ink-soft"><s>{s.text}</s> — {s.reason}</p>
          ))}
        </div>
      )}

      {/* Final editable */}
      <div className="mt-3">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft">Yakuniy javob (tahrirlash mumkin)</p>
        <Textarea rows={4} value={finalText} onChange={(e) => setFinalText(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="success" onClick={() => saveFinal("accepted")} disabled={pending}>
            <ThumbsUp className="h-3.5 w-3.5" /> Qabul qilish
          </Button>
          <Button size="sm" variant="secondary" onClick={() => saveFinal("manual")} disabled={pending}>
            <Check className="h-3.5 w-3.5" /> Qo‘lda saqlash
          </Button>
          <Button size="sm" variant="ghost" onClick={() => saveFinal("rejected")} disabled={pending}>
            <ThumbsDown className="h-3.5 w-3.5" /> Rad etish
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setClarifyOpen(true)}>
            <MessageCircleQuestion className="h-3.5 w-3.5" /> Aniqlashtirish
          </Button>
        </div>
      </div>

      <Modal open={clarifyOpen} onClose={() => setClarifyOpen(false)} title={`Aniqlashtirish — ${answer.question_no}-savol`}>
        <Textarea
          rows={3}
          value={clarifyText}
          onChange={(e) => setClarifyText(e.target.value)}
          placeholder="Nomzoddan nimani aniqlashtirish kerak?"
        />
        <p className="mt-2 text-xs text-ink-soft">Bu anketani “Aniqlashtirish kerak” holatiga o‘tkazadi va havolani qayta ochadi.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setClarifyOpen(false)}>Bekor</Button>
          <Button onClick={sendClarify} disabled={pending || !clarifyText.trim()}>
            <Send className="h-4 w-4" /> Yuborish
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

/* --------------------------- biography --------------------------- */

function BiographyPanel({
  globalAi,
}: {
  globalAi: { biography_draft: string | null; short_bio: string | null; editorial_commentary: string | null };
}) {
  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 font-bold text-ink">
        <Sparkles className="h-4 w-4 text-brand" /> Biografik maqola drafti
      </h3>
      {globalAi.short_bio && (
        <div className="mb-3 rounded-field border border-line bg-surface/40 p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft">Qisqa bio</p>
          <p className="text-sm text-ink">{globalAi.short_bio}</p>
        </div>
      )}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{globalAi.biography_draft}</p>
      {globalAi.editorial_commentary && (
        <div className="mt-4 rounded-field border border-lavender/30 bg-lavender/5 p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-lavender">Muharrir izohi</p>
          <p className="text-sm text-ink-soft">{globalAi.editorial_commentary}</p>
        </div>
      )}
    </Card>
  );
}

/* --------------------------- photo --------------------------- */

function PhotoPanel({
  intakeId,
  original,
  edits,
  prompts,
}: {
  intakeId: string;
  original: { url: string | null; file_name: string } | null;
  edits: PhotoEditView[];
  prompts: { default: string; male: string; female: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [gender, setGender] = useState<"none" | "male" | "female">("none");
  const [prompt, setPrompt] = useState(prompts.default);
  const [running, setRunning] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const idemKey = useRef(crypto.randomUUID());

  const applyGender = (g: "none" | "male" | "female") => {
    setGender(g);
    const add = g === "male" ? prompts.male : g === "female" ? prompts.female : "";
    setPrompt([prompts.default, add].filter(Boolean).join("\n\n"));
  };

  const standardize = async () => {
    idemKey.current = crypto.randomUUID();
    setRunning(true);
    try {
      const res = await fetch(`/api/admin/intakes/${intakeId}/photo-edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, idempotency_key: idemKey.current }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        toast.toast("success", "Rasm qayta ishlandi");
        router.refresh();
      } else toast.toast("error", "Rasm xatosi", json.error);
    } catch {
      toast.toast("error", "Tarmoq xatosi");
    } finally {
      setRunning(false);
    }
  };

  const select = async (editId: string | null) => {
    const r = await selectPhotoAction(intakeId, editId);
    if (r.ok) {
      toast.toast("success", editId ? "Qayta ishlangan rasm tanlandi" : "Original tanlandi");
      router.refresh();
    } else toast.toast("error", "Xatolik", r.error);
  };

  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 font-bold text-ink">
        <Camera className="h-4 w-4 text-brand" /> Portret
      </h3>

      {original?.url ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL */}
          <img src={original.url} alt="original" className="w-full rounded-field border border-line object-cover" />
          <button
            onClick={() => setZoom(original.url)}
            className="absolute right-2 top-2 rounded-lg bg-navy-deep/60 p-1.5 text-white backdrop-blur"
            aria-label="Kattalashtirish"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <p className="mt-1 text-center text-[11px] text-ink-soft">Original</p>
        </div>
      ) : (
        <p className="rounded-field border border-dashed border-line-strong p-4 text-center text-sm text-ink-soft">
          Original rasm hali yuklanmagan
        </p>
      )}

      {original?.url && (
        <>
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">Kiyim uslubi</p>
            <div className="flex gap-1.5">
              {(["none", "female", "male"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => applyGender(g)}
                  className={cn(
                    "flex-1 rounded-lg border px-2 py-1 text-xs font-semibold transition",
                    gender === g ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-soft",
                  )}
                >
                  {g === "none" ? "Neytral" : g === "female" ? "Ayol" : "Erkak"}
                </button>
              ))}
            </div>
          </div>
          <Textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="mt-2 text-xs" />
          <Button variant="ai" className="mt-2 w-full" onClick={standardize} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Jaxongir AI bilan standartlashtirish
          </Button>
        </>
      )}

      {/* Processed results */}
      {edits.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Natijalar</p>
          <div className="grid grid-cols-2 gap-2">
            {edits.map((e) => (
              <div key={e.id} className={cn("overflow-hidden rounded-field border", e.is_selected ? "border-brand ring-2 ring-brand/25" : "border-line")}>
                {e.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL
                  <img src={e.url} alt="edited" className="aspect-square w-full cursor-zoom-in object-cover" onClick={() => e.url && setZoom(e.url)} />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-xs text-ink-soft">{e.status}</div>
                )}
                <button
                  onClick={() => select(e.id)}
                  className={cn("w-full py-1 text-xs font-bold", e.is_selected ? "bg-brand text-white" : "bg-surface text-ink-soft hover:bg-brand/10")}
                >
                  {e.is_selected ? "Tanlangan" : "Tanlash"}
                </button>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => select(null)}>
            Originalni tanlash
          </Button>
        </div>
      )}

      <Modal open={!!zoom} onClose={() => setZoom(null)} title="Rasm" wide>
        {zoom && (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL
          <img src={zoom} alt="zoom" className="mx-auto max-h-[70vh] rounded-field object-contain" />
        )}
      </Modal>
    </Card>
  );
}

/* --------------------------- actions --------------------------- */

function ActionsBar({
  intakeId,
  status,
  fullName,
  pending,
  run,
}: {
  intakeId: string;
  status: string;
  fullName: string;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string; candidateId?: string }>, okMsg: string) => void;
}) {
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const canApprove = ["submitted", "ai_reviewing", "needs_clarification"].includes(status);
  const canPromote = status === "approved";
  const canPublish = status === "promoted";

  return (
    <Card>
      <h3 className="mb-3 font-bold text-ink">Amallar</h3>
      <div className="space-y-2">
        {canApprove && (
          <Button variant="success" className="w-full" disabled={pending} onClick={() => run(() => approveIntakeAction(intakeId), "Tasdiqlandi")}>
            <ShieldCheck className="h-4 w-4" /> Tasdiqlash
          </Button>
        )}

        {canPromote && (
          <Button variant="primary" className="w-full" disabled={pending} onClick={() => setPromoteOpen(true)}>
            <ArrowRight className="h-4 w-4" /> Nomzodlar bo‘limiga yuborish
          </Button>
        )}

        {canPublish && (
          <Button variant="ai" className="w-full" disabled={pending} onClick={() => setPublishOpen(true)}>
            <Send className="h-4 w-4" /> Chop etish
          </Button>
        )}

        {status === "published" && (
          <div className="rounded-field border border-mint/50 bg-mint/10 p-3 text-center text-sm font-semibold text-green">
            <Check className="mx-auto mb-1 h-5 w-5" /> Nashr etilgan
          </div>
        )}
      </div>

      <ConfirmDialog
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        onConfirm={() => {
          setPromoteOpen(false);
          run(() => promoteIntakeAction(intakeId), "Nomzodlar bo‘limiga yuborildi (draft)");
        }}
        title="Nomzodga aylantirish"
        description={`Jaxongir AI “${fullName}” anketasining barcha xom javoblarini strukturalaydi va nomzod profilini DRAFT sifatida yaratadi. Natija review sahifasida ochiladi; bu hali nashr emas.`}
        confirmLabel="Yuborish"
      />
      <ConfirmDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onConfirm={() => {
          setPublishOpen(false);
          run(() => publishIntakeAction(intakeId), "Nashr etildi");
        }}
        title="Chop etishni tasdiqlang"
        description={`“${fullName}” profili va biografik maqolasi OMMAGA nashr etiladi. Rozilik va yakuniy portret tekshirilgan bo‘lishi kerak.`}
        confirmLabel="Ha, chop etish"
        danger
        requireText="CHOP ETISH"
      />
    </Card>
  );
}
