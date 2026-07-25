"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CloudOff,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Camera,
  Paperclip,
  ShieldCheck,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Input } from "@/components/ui/primitives";
import { RichEditor } from "@/components/intake/rich-editor";
import { canAdvanceAnswer, NO_ANSWER_TEXT, type AnswerState } from "@/lib/intake/constants";

/* ----------------------------- types ----------------------------- */

export interface IntakeQuestionView {
  question_no: number;
  prompt: string;
  help: string | null;
  required: boolean;
  allowNoAnswer: boolean;
}
export interface IntakeTemplateView {
  intro: string;
  photoTitle: string;
  photoInstruction: string;
  footer: string;
  questions: IntakeQuestionView[];
}
export interface IntakeAnswerView {
  question_no: number;
  answer_state: AnswerState;
  rich_content: unknown;
  plain_text: string;
  lock_version: number;
}
export interface IntakeAttachmentView {
  id: string;
  file_name: string;
  mime_type: string;
  kind: string;
  size_bytes: number;
  signedUrl: string | null;
  question_no: number | null;
}

export interface AutosaveResp {
  ok: boolean;
  lock_version?: number;
  conflict?: boolean;
  server?: { answer_state: string; rich_content: unknown; plain_text: string; lock_version: number };
  error?: string;
  progress?: { answered: number; total: number };
}
export interface UploadResp {
  ok: boolean;
  attachment?: IntakeAttachmentView;
  error?: string;
}
export interface IntakeTransport {
  autosave(p: {
    question_no: number;
    answer_state: AnswerState;
    rich_content: unknown;
    plain_text: string;
    lock_version: number;
  }): Promise<AutosaveResp>;
  upload(file: File, opts: { purpose: "photo" | "attachment"; question_no?: number }): Promise<UploadResp>;
  submit(c: { phone: string; telegram: string; consent: boolean }): Promise<{ ok: boolean; errors?: string[] }>;
  heartbeat(): Promise<void>;
}

interface AnswerLocal {
  answerState: AnswerState;
  richContent: unknown;
  plainText: string;
  lockVersion: number;
  dirty: boolean;
}

type SaveStatus = "idle" | "saving" | "saved" | "offline" | "retry";

/* ----------------------------- save indicator ----------------------------- */

function SaveIndicator({ status }: { status: SaveStatus }) {
  const map = {
    idle: { icon: Check, text: "Saqlangan", cls: "text-ink-soft" },
    saving: { icon: Loader2, text: "Saqlanmoqda…", cls: "text-brand", spin: true },
    saved: { icon: Check, text: "Saqlandi", cls: "text-green" },
    offline: { icon: CloudOff, text: "Internet yo‘q", cls: "text-amber" },
    retry: { icon: RefreshCw, text: "Qayta urinilmoqda…", cls: "text-amber", spin: true },
  } as const;
  const m = map[status];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", m.cls)}>
      <Icon className={cn("h-3.5 w-3.5", "spin" in m && m.spin && "animate-spin")} /> {m.text}
    </span>
  );
}

/* ----------------------------- main engine ----------------------------- */

export function IntakeForm({
  mode,
  template,
  initialAnswers,
  initialPhoto,
  initialAttachments,
  initialContact,
  consentText,
  maxUploadBytes,
  draftKey,
  transport,
  readOnly = false,
}: {
  mode: "public" | "admin";
  template: IntakeTemplateView;
  initialAnswers: IntakeAnswerView[];
  initialPhoto: { url: string | null; file_name: string } | null;
  initialAttachments?: IntakeAttachmentView[];
  initialContact: { phone: string | null; telegram: string | null; consent: boolean };
  consentText: string;
  maxUploadBytes: number;
  draftKey: string;
  transport: IntakeTransport;
  readOnly?: boolean;
}) {
  const questions = template.questions;
  const totalStages = questions.length + 2; // photo + questions + contact
  const [stage, setStage] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [photo, setPhoto] = useState(initialPhoto);
  const [attachments, setAttachments] = useState<IntakeAttachmentView[]>(initialAttachments ?? []);
  const [contact, setContact] = useState({
    phone: initialContact.phone ?? "",
    telegram: initialContact.telegram ?? "",
    consent: initialContact.consent ?? false,
  });
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  // Answers live in React state (read during render); a mirror ref gives
  // callbacks/effects the latest value without reading a ref during render.
  const [answers, setAnswers] = useState<Map<number, AnswerLocal>>(() => {
    const map = new Map<number, AnswerLocal>();
    for (const q of questions) {
      const a = initialAnswers.find((x) => x.question_no === q.question_no);
      map.set(q.question_no, {
        answerState: (a?.answer_state as AnswerState) ?? "unanswered",
        richContent: a?.rich_content ?? { type: "doc", content: [] },
        plainText: a?.plain_text ?? "",
        lockVersion: a?.lock_version ?? 0,
        dirty: false,
      });
    }
    // Recover any newer local draft (offline fallback).
    try {
      const cached = localStorage.getItem(`intake-draft-${draftKey}`);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<number, AnswerLocal>;
        for (const [no, val] of Object.entries(parsed)) {
          const key = Number(no);
          const cur = map.get(key);
          if (cur && val.dirty) map.set(key, { ...cur, ...val });
        }
      }
    } catch {
      /* ignore */
    }
    return map;
  });
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const setAnswer = useCallback(
    (no: number, patch: Partial<AnswerLocal> | ((a: AnswerLocal) => AnswerLocal)) => {
      setAnswers((prev) => {
        const cur = prev.get(no);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(no, typeof patch === "function" ? patch(cur) : { ...cur, ...patch });
        return next;
      });
    },
    [],
  );

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<number[]>([]);

  const persistLocal = useCallback(() => {
    try {
      const obj: Record<number, AnswerLocal> = {};
      answersRef.current.forEach((v, k) => (obj[k] = v));
      localStorage.setItem(`intake-draft-${draftKey}`, JSON.stringify(obj));
    } catch {
      /* quota / private mode — non-fatal */
    }
  }, [draftKey]);

  const flushOne = useCallback(
    async (questionNo: number): Promise<void> => {
      const a = answersRef.current.get(questionNo);
      if (!a || !a.dirty) return;
      setSaveStatus("saving");
      try {
        const resp = await transport.autosave({
          question_no: questionNo,
          answer_state: a.answerState,
          rich_content: a.richContent,
          plain_text: a.plainText,
          lock_version: a.lockVersion,
        });
        if (resp.ok) {
          setAnswer(questionNo, { lockVersion: resp.lock_version ?? a.lockVersion, dirty: false });
          setSaveStatus("saved");
          persistLocal();
        } else if (resp.conflict && resp.server) {
          // Optimistic-concurrency clash: adopt the server version and inform.
          const server = resp.server;
          setAnswer(questionNo, () => ({
            answerState: server.answer_state as AnswerState,
            richContent: server.rich_content,
            plainText: server.plain_text,
            lockVersion: server.lock_version,
            dirty: false,
          }));
          setSaveStatus("saved");
          alert("Bu javob boshqa qurilmada yangilangan. Serverdagi so‘nggi versiya yuklandi.");
        } else {
          setSaveStatus("retry");
          queue.current.push(questionNo);
        }
      } catch {
        setSaveStatus(navigator.onLine ? "retry" : "offline");
        if (!queue.current.includes(questionNo)) queue.current.push(questionNo);
        persistLocal();
      }
    },
    [transport, persistLocal, setAnswer],
  );

  const flushAll = useCallback(async () => {
    for (const q of questions) await flushOne(q.question_no);
  }, [questions, flushOne]);

  // Reconnect: drain the retry queue in order.
  useEffect(() => {
    const onOnline = async () => {
      setSaveStatus("retry");
      const pending = [...new Set(queue.current)];
      queue.current = [];
      for (const no of pending) await flushOne(no);
      setSaveStatus("saved");
    };
    const onOffline = () => setSaveStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushOne]);

  // Heartbeat + flush on unload (keepalive/beacon).
  useEffect(() => {
    if (readOnly) return;
    // Presence heartbeat only matters for the remote public form.
    const hb = mode === "public" ? setInterval(() => void transport.heartbeat().catch(() => {}), 45000) : null;
    const onHide = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      answersRef.current.forEach((a, no) => {
        if (a.dirty) {
          void transport.autosave({
            question_no: no,
            answer_state: a.answerState,
            rich_content: a.richContent,
            plain_text: a.plainText,
            lock_version: a.lockVersion,
          }).catch(() => {});
        }
      });
      persistLocal();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && onHide());
    return () => {
      if (hb) clearInterval(hb);
      window.removeEventListener("pagehide", onHide);
    };
  }, [transport, persistLocal, readOnly, mode]);

  const scheduleSave = useCallback(
    (questionNo: number) => {
      if (readOnly) return;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => void flushOne(questionNo), 850);
    },
    [flushOne, readOnly],
  );

  const onEditorChange = useCallback(
    (questionNo: number, json: unknown, text: string) => {
      setAnswer(questionNo, (prev) => ({
        ...prev,
        richContent: json,
        plainText: text,
        answerState: text.trim() ? "answered" : "unanswered",
        dirty: true,
      }));
      setSaveStatus("saving");
      scheduleSave(questionNo);
    },
    [scheduleSave, setAnswer],
  );

  const onNoAnswer = useCallback(
    (questionNo: number) => {
      const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: NO_ANSWER_TEXT }] }] };
      setAnswer(questionNo, (prev) => ({
        ...prev,
        answerState: "no_answer",
        richContent: doc,
        plainText: NO_ANSWER_TEXT,
        dirty: true,
      }));
      void flushOne(questionNo);
    },
    [flushOne, setAnswer],
  );

  /* ----------------------------- navigation ----------------------------- */

  const currentQuestion = stage >= 1 && stage <= questions.length ? questions[stage - 1] : null;
  const canGoNext = useMemo(() => {
    if (stage === 0) return true; // photo optional to advance (but recommended)
    if (stage > questions.length) return true;
    const q = questions[stage - 1];
    const a = answers.get(q.question_no);
    if (!a) return false;
    if (!q.required) return true;
    return canAdvanceAnswer(a.answerState, a.plainText);
  }, [stage, questions, answers]);

  const goNext = useCallback(async () => {
    if (currentQuestion) await flushOne(currentQuestion.question_no);
    setStage((s) => Math.min(s + 1, totalStages - 1));
  }, [currentQuestion, flushOne, totalStages]);
  const goPrev = useCallback(async () => {
    if (currentQuestion) await flushOne(currentQuestion.question_no);
    setStage((s) => Math.max(s - 1, 0));
  }, [currentQuestion, flushOne]);

  /* ----------------------------- uploads ----------------------------- */

  const doUpload = useCallback(
    async (file: File, purpose: "photo" | "attachment", questionNo?: number) => {
      if (file.size > maxUploadBytes) {
        alert(`Fayl juda katta (maksimum ${Math.round(maxUploadBytes / 1024 / 1024)} MB)`);
        return;
      }
      setBusy(true);
      const resp = await transport.upload(file, { purpose, question_no: questionNo });
      setBusy(false);
      if (!resp.ok || !resp.attachment) {
        alert(resp.error ?? "Yuklab bo‘lmadi");
        return;
      }
      if (purpose === "photo") {
        setPhoto({ url: resp.attachment.signedUrl, file_name: resp.attachment.file_name });
      } else {
        setAttachments((prev) => [...prev, resp.attachment!]);
      }
    },
    [transport, maxUploadBytes],
  );

  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachTarget, setAttachTarget] = useState<number | null>(null);

  /* ----------------------------- submit ----------------------------- */

  const answeredCount = questions.filter((q) => {
    const a = answers.get(q.question_no);
    return a && canAdvanceAnswer(a.answerState, a.plainText);
  }).length;

  const doSubmit = useCallback(async () => {
    setBusy(true);
    await flushAll();
    const resp = await transport.submit(contact);
    setBusy(false);
    if (resp.ok) {
      setSubmitted(true);
      try {
        localStorage.removeItem(`intake-draft-${draftKey}`);
      } catch {
        /* ignore */
      }
    } else {
      setSubmitErrors(resp.errors ?? ["Yuborib bo‘lmadi"]);
    }
  }, [flushAll, transport, contact, draftKey]);

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg rounded-panel border border-mint/50 bg-card p-10 text-center shadow-card">
        <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green/15 text-green">
          <Check className="h-9 w-9" />
        </span>
        <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-ink">Rahmat!</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Anketangiz muvaffaqiyatli yuborildi. Jamoamiz uni ko‘rib chiqadi va zarur bo‘lsa siz bilan bog‘lanadi.
        </p>
        <p className="mt-6 text-xs text-ink-soft">{template.footer}</p>
      </div>
    );
  }

  /* ----------------------------- render ----------------------------- */

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Progress header */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur md:mx-0 md:rounded-b-card md:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
              {stage === 0 ? template.photoTitle : stage > questions.length ? "Yakuniy bosqich" : `Savol ${stage} / ${questions.length}`}
            </p>
            <div className="mt-1.5 h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-cyan transition-all"
                style={{ width: `${(stage / (totalStages - 1)) * 100}%` }}
              />
            </div>
          </div>
          <SaveIndicator status={saveStatus} />
        </div>
      </div>

      {/* Question navigator */}
      {stage >= 1 && stage <= questions.length && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {questions.map((q, i) => {
            const a = answers.get(q.question_no);
            const done = a && canAdvanceAnswer(a.answerState, a.plainText);
            return (
              <button
                key={q.question_no}
                onClick={() => setStage(i + 1)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold transition",
                  stage === i + 1
                    ? "bg-brand text-white"
                    : done
                      ? "bg-mint/25 text-green"
                      : "bg-card text-ink-soft hover:bg-brand/10",
                )}
                title={q.prompt}
              >
                {q.question_no}
              </button>
            );
          })}
        </div>
      )}

      {/* Stage content */}
      <div className="rounded-card border border-line bg-card p-6 shadow-card">
        {stage === 0 && (
          <PhotoStage
            title={template.photoTitle}
            instruction={template.photoInstruction}
            photo={photo}
            busy={busy}
            readOnly={readOnly}
            onPick={(f) => doUpload(f, "photo")}
          />
        )}

        {currentQuestion && (
          <div>
            <div className="mb-3">
              <h3 className="text-base font-bold text-ink">
                <span className="mr-2 text-brand">{currentQuestion.question_no}.</span>
                {currentQuestion.prompt}
              </h3>
              {currentQuestion.help && <p className="mt-1 text-xs text-ink-soft">{currentQuestion.help}</p>}
            </div>
            <RichEditor
              key={currentQuestion.question_no}
              value={answers.get(currentQuestion.question_no)?.richContent}
              editable={!readOnly}
              placeholder="Javobingizni shu yerga yozing…"
              onChange={(json, text) => onEditorChange(currentQuestion.question_no, json, text)}
              onNoAnswer={currentQuestion.allowNoAnswer && !readOnly ? () => onNoAnswer(currentQuestion.question_no) : undefined}
              showNoAnswer={currentQuestion.allowNoAnswer}
              onAttachClick={readOnly ? undefined : () => { setAttachTarget(currentQuestion.question_no); attachInputRef.current?.click(); }}
            />
            <AttachmentList
              items={attachments.filter((a) => a.question_no === currentQuestion.question_no)}
            />
          </div>
        )}

        {stage > questions.length && (
          <ContactStage
            contact={contact}
            consentText={consentText}
            errors={submitErrors}
            readOnly={readOnly}
            answeredCount={answeredCount}
            total={questions.length}
            hasPhoto={!!photo}
            busy={busy}
            onChange={setContact}
            onSubmit={doSubmit}
          />
        )}
      </div>

      {/* Nav footer */}
      {stage <= questions.length && (
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={goPrev} disabled={stage === 0}>
            <ChevronLeft className="h-4 w-4" /> Orqaga
          </Button>
          <div className="text-xs text-ink-soft">
            {stage >= 1 && stage <= questions.length && !canGoNext && (
              <span className="text-amber">Javob bering yoki “Yo‘q” tugmasini bosing</span>
            )}
          </div>
          <Button onClick={goNext} disabled={!canGoNext}>
            {stage === questions.length ? "Yakuniy bosqich" : "Keyingi"} <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-ink-soft">{template.footer}</p>

      {/* Hidden attachment input */}
      <input
        ref={attachInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && attachTarget != null) void doUpload(f, "attachment", attachTarget);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ----------------------------- sub-stages ----------------------------- */

function PhotoStage({
  title,
  instruction,
  photo,
  busy,
  readOnly,
  onPick,
}: {
  title: string;
  instruction: string;
  photo: { url: string | null; file_name: string } | null;
  busy: boolean;
  readOnly: boolean;
  onPick: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="text-center">
      <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan/20 to-lavender/20 text-brand">
        <Camera className="h-7 w-7" />
      </span>
      <h3 className="font-display text-lg font-semibold uppercase tracking-wide text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{instruction}</p>

      {photo?.url && (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
        <img
          src={photo.url}
          alt={photo.file_name}
          className="mx-auto mt-5 h-52 w-52 rounded-2xl border border-line object-cover shadow-card"
        />
      )}

      {!readOnly && (
        <div className="mt-5">
          <Button variant={photo ? "secondary" : "primary"} onClick={() => ref.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {photo ? "Boshqa rasm yuklash" : "Rasm yuklash"}
          </Button>
          <input
            ref={ref}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = "";
            }}
          />
          <p className="mt-3 text-xs text-ink-soft">JPG, PNG, WEBP yoki HEIC</p>
        </div>
      )}
    </div>
  );
}

function AttachmentList({ items }: { items: IntakeAttachmentView[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {items.map((a) => (
        <div key={a.id} className="flex items-center gap-3 rounded-field border border-line bg-surface/50 p-2">
          {a.kind === "image" && a.signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
            <img src={a.signedUrl} alt={a.file_name} className="h-12 w-12 rounded-lg border border-line object-cover" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Paperclip className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{a.file_name}</p>
            <p className="text-xs text-ink-soft">
              {a.kind} · {(a.size_bytes / 1024).toFixed(0)} KB
            </p>
          </div>
          {a.kind === "audio" && a.signedUrl && <audio controls src={a.signedUrl} className="h-8" />}
        </div>
      ))}
    </div>
  );
}

function ContactStage({
  contact,
  consentText,
  errors,
  readOnly,
  answeredCount,
  total,
  hasPhoto,
  busy,
  onChange,
  onSubmit,
}: {
  contact: { phone: string; telegram: string; consent: boolean };
  consentText: string;
  errors: string[];
  readOnly: boolean;
  answeredCount: number;
  total: number;
  hasPhoto: boolean;
  busy: boolean;
  onChange: (c: { phone: string; telegram: string; consent: boolean }) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-display text-lg font-semibold uppercase tracking-wide text-ink">Yakuniy ma’lumot</h3>
        <p className="mt-1 text-sm text-ink-soft">Bog‘lanish uchun ma’lumotlaringizni kiriting va rozilikni tasdiqlang.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-field border border-line bg-surface/50 p-3 text-center">
          <p className="text-lg font-bold text-ink">{answeredCount}/{total}</p>
          <p className="text-[11px] text-ink-soft">Javoblar</p>
        </div>
        <div className="rounded-field border border-line bg-surface/50 p-3 text-center">
          <p className={cn("text-lg font-bold", hasPhoto ? "text-green" : "text-amber")}>{hasPhoto ? "✓" : "—"}</p>
          <p className="text-[11px] text-ink-soft">Rasm</p>
        </div>
        <div className="rounded-field border border-line bg-surface/50 p-3 text-center">
          <p className={cn("text-lg font-bold", contact.consent ? "text-green" : "text-amber")}>{contact.consent ? "✓" : "—"}</p>
          <p className="text-[11px] text-ink-soft">Rozilik</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Telefon raqami</label>
          <Input
            value={contact.phone}
            disabled={readOnly}
            placeholder="+998 90 123 45 67"
            onChange={(e) => onChange({ ...contact, phone: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Telegram username</label>
          <Input
            value={contact.telegram}
            disabled={readOnly}
            placeholder="@username"
            onChange={(e) => onChange({ ...contact, telegram: e.target.value })}
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-field border border-line bg-surface/40 p-4">
        <input
          type="checkbox"
          checked={contact.consent}
          disabled={readOnly}
          onChange={(e) => onChange({ ...contact, consent: e.target.checked })}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
        />
        <span className="text-sm leading-relaxed text-ink-soft">{consentText}</span>
      </label>

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-field border border-coral/40 bg-coral/5 p-3">
          {errors.map((e, i) => (
            <li key={i} className="text-sm font-semibold text-coral">• {e}</li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <Button
          className="w-full"
          size="lg"
          onClick={onSubmit}
          disabled={busy || !contact.consent}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Anketani yuborish
        </Button>
      )}
      {!contact.consent && !readOnly && (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-soft">
          <ShieldCheck className="h-3.5 w-3.5" /> Yuborish uchun rozilikni belgilang
        </p>
      )}
    </div>
  );
}
