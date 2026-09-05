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
  Sparkles,
  MessageCircleQuestion,
  ChevronDown,
  Info,
  Copy,
  Maximize2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Input } from "@/components/ui/primitives";
import { RichEditor } from "@/components/intake/rich-editor";
import {
  canAdvanceAnswer,
  NO_ANSWER_TEXT,
  MANUAL_PHOTO_PROMPTS,
  type AnswerState,
  type Gender,
} from "@/lib/intake/constants";
import { validateContact } from "@/lib/intake/schemas";
import {
  autosaveRetryDelay,
  canSubmitCandidateFinal,
  mergeAutosaveConflict,
  photoPollingDelay,
} from "@/lib/intake/client-flow";

/* ----------------------------- types ----------------------------- */

export interface IntakeQuestionView {
  question_no: number;
  canonicalKey: string | null;
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
export type PhotoJobStatus = "queued" | "processing" | "completed" | "failed";
export type PhotoSelectionKind = "original" | "ai";
export interface CandidatePhotoStateView {
  job: {
    id: string;
    status: PhotoJobStatus;
    createdAt: string;
    finishedAt: string | null;
  } | null;
  completed: {
    id: string;
    url: string | null;
    createdAt: string;
  } | null;
  selection: {
    kind: PhotoSelectionKind | null;
    editId: string | null;
    originalAttachmentId: string | null;
    confirmedAt: string | null;
    confirmed: boolean;
  };
}
export interface IntakeFeedbackView {
  question_no: number | null;
  feedback_text: string;
  feedback_type: string;
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
  /**
   * Candidates no longer start photo jobs — they bring a portrait they made
   * themselves. Status polling stays so an admin-started edit still surfaces.
   */
  getPhotoStatus?(): Promise<{ ok: boolean; photoEdit?: CandidatePhotoStateView; error?: string }>;
  confirmPhoto?(selection: {
    kind: PhotoSelectionKind;
    photo_edit_id?: string | null;
  }): Promise<{ ok: boolean; photoEdit?: CandidatePhotoStateView; error?: string }>;
}

interface AnswerLocal {
  answerState: AnswerState;
  richContent: unknown;
  plainText: string;
  lockVersion: number;
  dirty: boolean;
  localRevision: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "offline" | "retry";

interface SaveControl {
  debounceTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
  queued: boolean;
  retryAttempt: number;
  requestSequence: number;
}

/* ----------------------------- save indicator ----------------------------- */

function SaveIndicator({ status }: { status: SaveStatus }) {
  const map = {
    idle: { icon: Check, text: "Saqlandi", cls: "text-ink-soft" },
    saving: { icon: Loader2, text: "Saqlanmoqda…", cls: "text-brand", spin: true },
    saved: { icon: Check, text: "Saqlandi", cls: "text-green" },
    offline: { icon: CloudOff, text: "Internet tiklangach saqlanadi", cls: "text-amber" },
    retry: { icon: RefreshCw, text: "Qayta saqlanmoqda…", cls: "text-amber", spin: true },
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
  initialPhotoEdit,
  initialAttachments,
  initialContact,
  consentText,
  maxUploadBytes,
  photoPrompts,
  draftKey,
  transport,
  gender = null,
  readOnly = false,
  feedback = [],
}: {
  mode: "public" | "admin";
  template: IntakeTemplateView;
  initialAnswers: IntakeAnswerView[];
  initialPhoto: { url: string | null; file_name: string } | null;
  initialPhotoEdit?: CandidatePhotoStateView | null;
  initialAttachments?: IntakeAttachmentView[];
  initialContact: { phone: string | null; telegram: string | null; consent: boolean };
  consentText: string;
  maxUploadBytes: number;
  /** Copy-paste AI prompts, assembled from the admin panel fragments. */
  photoPrompts?: Record<Gender, string>;
  draftKey: string;
  transport: IntakeTransport;
  /** Picks which manual photo prompt the candidate is shown. */
  gender?: Gender | null;
  readOnly?: boolean;
  feedback?: IntakeFeedbackView[];
}) {
  const questions = template.questions;
  const requiresPhotoConfirmation = mode === "public" && !!transport.confirmPhoto;
  const contactStage = questions.length + 1;
  const confirmationStage = questions.length + 2;
  const totalStages = questions.length + (requiresPhotoConfirmation ? 3 : 2);
  const [stage, setStage] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [questionSaveStatuses, setQuestionSaveStatuses] = useState<Map<number, SaveStatus>>(
    () => new Map(questions.map((q) => [q.question_no, "idle" as const])),
  );
  const [photo, setPhoto] = useState(initialPhoto);
  const [photoEdit, setPhotoEdit] = useState<CandidatePhotoStateView | null>(initialPhotoEdit ?? null);
  const [photoActionError, setPhotoActionError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<IntakeAttachmentView[]>(initialAttachments ?? []);
  const [contact, setContact] = useState({
    phone: initialContact.phone ?? "",
    telegram: initialContact.telegram ?? "",
    consent: initialContact.consent ?? false,
  });
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [photoConfirming, setPhotoConfirming] = useState(false);

  const { feedbackByQuestion, generalFeedback } = useMemo(() => {
    const map = new Map<number, IntakeFeedbackView[]>();
    const general: IntakeFeedbackView[] = [];
    for (const f of feedback) {
      if (f.question_no == null) general.push(f);
      else {
        const arr = map.get(f.question_no) ?? [];
        arr.push(f);
        map.set(f.question_no, arr);
      }
    }
    return { feedbackByQuestion: map, generalFeedback: general };
  }, [feedback]);

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
        localRevision: 0,
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
          if (cur && val.dirty) {
            map.set(key, {
              ...cur,
              ...val,
              localRevision: Number.isFinite(val.localRevision) ? val.localRevision : 1,
            });
          }
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
        answersRef.current = next;
        return next;
      });
    },
    [],
  );

  const saveControls = useRef<Map<number, SaveControl>>(new Map());
  const flushOneRef = useRef<(questionNo: number) => Promise<void>>(async () => {});

  const getSaveControl = useCallback((questionNo: number): SaveControl => {
    const existing = saveControls.current.get(questionNo);
    if (existing) return existing;
    const created: SaveControl = {
      debounceTimer: null,
      retryTimer: null,
      inFlight: null,
      queued: false,
      retryAttempt: 0,
      requestSequence: 0,
    };
    saveControls.current.set(questionNo, created);
    return created;
  }, []);

  const setQuestionSaveStatus = useCallback((questionNo: number, status: SaveStatus) => {
    setQuestionSaveStatuses((previous) => {
      const next = new Map(previous);
      next.set(questionNo, status);
      return next;
    });
    setSaveStatus(status);
  }, []);

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
      const control = getSaveControl(questionNo);
      if (control.debounceTimer) {
        clearTimeout(control.debounceTimer);
        control.debounceTimer = null;
      }
      if (control.retryTimer) {
        clearTimeout(control.retryTimer);
        control.retryTimer = null;
      }
      if (control.inFlight) {
        control.queued = true;
        await control.inFlight;
        if (answersRef.current.get(questionNo)?.dirty && !control.retryTimer) {
          await flushOneRef.current(questionNo);
        }
        return;
      }

      const a = answersRef.current.get(questionNo);
      if (!a || !a.dirty) return;
      const sentRevision = a.localRevision;
      const sentSequence = ++control.requestSequence;
      control.queued = false;
      setQuestionSaveStatus(questionNo, control.retryAttempt > 0 ? "retry" : "saving");

      const request = (async () => {
        let shouldDrainImmediately = false;
        try {
          const resp = await transport.autosave({
            question_no: questionNo,
            answer_state: a.answerState,
            rich_content: a.richContent,
            plain_text: a.plainText,
            lock_version: a.lockVersion,
          });
          const current = answersRef.current.get(questionNo);
          if (!current || sentSequence !== control.requestSequence) return;

          if (resp.ok) {
            const unchangedSinceRequest = current.localRevision === sentRevision;
            setAnswer(questionNo, {
              lockVersion: resp.lock_version ?? a.lockVersion,
              dirty: !unchangedSinceRequest,
            });
            control.retryAttempt = 0;
            shouldDrainImmediately = !unchangedSinceRequest;
            setQuestionSaveStatus(questionNo, unchangedSinceRequest ? "saved" : "saving");
            persistLocal();
          } else if (resp.conflict && resp.server) {
            // Silent merge: only adopt the server lock. The editor's local
            // rich/plain value remains untouched and is retried against that
            // newest revision, so neither device's text is discarded.
            setAnswer(questionNo, (local) =>
              mergeAutosaveConflict(local, resp.server!.lock_version),
            );
            control.retryAttempt = 0;
            shouldDrainImmediately = true;
            setQuestionSaveStatus(questionNo, "retry");
            persistLocal();
          } else {
            throw new Error(resp.error ?? "autosave failed");
          }
        } catch {
          control.retryAttempt += 1;
          const offline = typeof navigator !== "undefined" && !navigator.onLine;
          setQuestionSaveStatus(questionNo, offline ? "offline" : "retry");
          persistLocal();
          const retryDelay = autosaveRetryDelay(control.retryAttempt);
          control.retryTimer = setTimeout(() => {
            control.retryTimer = null;
            void flushOneRef.current(questionNo);
          }, retryDelay);
        } finally {
          control.inFlight = null;
          if (control.queued || shouldDrainImmediately) {
            control.queued = false;
            queueMicrotask(() => void flushOneRef.current(questionNo));
          }
        }
      })();
      control.inFlight = request;
      await request;
      if (answersRef.current.get(questionNo)?.dirty && !control.retryTimer) {
        await flushOneRef.current(questionNo);
      }
    },
    [getSaveControl, persistLocal, setAnswer, setQuestionSaveStatus, transport],
  );
  useEffect(() => {
    flushOneRef.current = flushOne;
  }, [flushOne]);

  const flushAll = useCallback(async () => {
    await Promise.all(questions.map((q) => flushOne(q.question_no)));
  }, [questions, flushOne]);

  // Reconnect: immediately drain every dirty question. Per-question controls
  // still guarantee that no two saves for the same answer run concurrently.
  useEffect(() => {
    const onOnline = () => {
      setSaveStatus("retry");
      answersRef.current.forEach((answer, no) => {
        if (answer.dirty) {
          setQuestionSaveStatus(no, "retry");
          void flushOne(no);
        }
      });
    };
    const onOffline = () => {
      setSaveStatus("offline");
      answersRef.current.forEach((answer, no) => {
        if (answer.dirty) setQuestionSaveStatus(no, "offline");
      });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushOne, setQuestionSaveStatus]);

  // Heartbeat + flush on unload (keepalive/beacon).
  useEffect(() => {
    if (readOnly) return;
    const controls = saveControls.current;
    // Presence heartbeat only matters for the remote public form.
    const hb = mode === "public" ? setInterval(() => void transport.heartbeat().catch(() => {}), 45000) : null;
    const onHide = () => {
      answersRef.current.forEach((a, no) => {
        if (a.dirty) void flushOne(no);
      });
      persistLocal();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (hb) clearInterval(hb);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controls.forEach((control) => {
        if (control.debounceTimer) clearTimeout(control.debounceTimer);
        if (control.retryTimer) clearTimeout(control.retryTimer);
      });
    };
  }, [flushOne, transport, persistLocal, readOnly, mode]);

  const scheduleSave = useCallback(
    (questionNo: number) => {
      if (readOnly) return;
      const control = getSaveControl(questionNo);
      if (control.debounceTimer) clearTimeout(control.debounceTimer);
      control.debounceTimer = setTimeout(() => {
        control.debounceTimer = null;
        void flushOne(questionNo);
      }, 900);
    },
    [flushOne, getSaveControl, readOnly],
  );

  const onEditorChange = useCallback(
    (questionNo: number, json: unknown, text: string) => {
      setAnswer(questionNo, (prev) => ({
        ...prev,
        richContent: json,
        plainText: text,
        answerState: text.trim() ? "answered" : "unanswered",
        dirty: true,
        localRevision: prev.localRevision + 1,
      }));
      setQuestionSaveStatus(questionNo, "saving");
      persistLocal();
      scheduleSave(questionNo);
    },
    [persistLocal, scheduleSave, setAnswer, setQuestionSaveStatus],
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
        localRevision: prev.localRevision + 1,
      }));
      setQuestionSaveStatus(questionNo, "saving");
      persistLocal();
      void flushOne(questionNo);
    },
    [flushOne, persistLocal, setAnswer, setQuestionSaveStatus],
  );

  /* ----------------------------- navigation ----------------------------- */

  const currentQuestion = stage >= 1 && stage <= questions.length ? questions[stage - 1] : null;
  const canGoNext = useMemo(() => {
    if (stage === 0) return true; // photo optional to advance (but recommended)
    if (stage === contactStage && requiresPhotoConfirmation) {
      return validateContact(contact).ok;
    }
    if (stage > questions.length) return true;
    const q = questions[stage - 1];
    const a = answers.get(q.question_no);
    if (!a) return false;
    if (!q.required) return true;
    return canAdvanceAnswer(a.answerState, a.plainText);
  }, [answers, contact, contactStage, questions, requiresPhotoConfirmation, stage]);

  const goNext = useCallback(async () => {
    if (currentQuestion) await flushOne(currentQuestion.question_no);
    setStage((s) => Math.min(s + 1, totalStages - 1));
  }, [currentQuestion, flushOne, totalStages]);
  const goPrev = useCallback(async () => {
    if (currentQuestion) await flushOne(currentQuestion.question_no);
    setStage((s) => Math.max(s - 1, 0));
  }, [currentQuestion, flushOne]);
  const goToQuestion = useCallback(
    async (nextStage: number) => {
      if (currentQuestion) await flushOne(currentQuestion.question_no);
      setStage(nextStage);
    },
    [currentQuestion, flushOne],
  );

  /* ----------------------------- uploads ----------------------------- */

  const doUpload = useCallback(
    async (file: File, purpose: "photo" | "attachment", questionNo?: number) => {
      setUploadError(null);
      if (file.size > maxUploadBytes) {
        setUploadError(`Fayl juda katta (maksimum ${Math.round(maxUploadBytes / 1024 / 1024)} MB)`);
        return;
      }
      setBusy(true);
      let resp: UploadResp;
      try {
        resp = await transport.upload(file, { purpose, question_no: questionNo });
      } catch {
        resp = { ok: false, error: "Tarmoq xatosi. Qayta urinib ko‘ring." };
      } finally {
        setBusy(false);
      }
      if (!resp.ok || !resp.attachment) {
        setUploadError(resp.error ?? "Yuklab bo‘lmadi");
        return;
      }
      if (purpose === "photo") {
        setPhoto({ url: resp.attachment.signedUrl, file_name: resp.attachment.file_name });
        setPhotoEdit(null);
        setPhotoActionError(null);
        if (transport.getPhotoStatus) {
          const state = await transport.getPhotoStatus();
          if (state.ok && state.photoEdit) setPhotoEdit(state.photoEdit);
        }
      } else {
        setAttachments((prev) => [...prev, resp.attachment!]);
      }
    },
    [transport, maxUploadBytes],
  );

  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachTarget, setAttachTarget] = useState<number | null>(null);

  /* ----------------------------- background photo job ----------------------------- */

  const photoJob = photoEdit?.job;
  useEffect(() => {
    if (
      !transport.getPhotoStatus ||
      !photoJob ||
      !["queued", "processing"].includes(photoJob.status)
    ) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (immediate = false) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      const delay = immediate ? 0 : photoPollingDelay(document.visibilityState === "hidden");
      timer = setTimeout(async () => {
        const response = await transport.getPhotoStatus!().catch(() => ({ ok: false as const }));
        if (cancelled) return;
        if (response.ok && response.photoEdit) {
          setPhotoEdit(response.photoEdit);
          if (response.photoEdit.job?.status === "completed") setPhotoActionError(null);
          if (["queued", "processing"].includes(response.photoEdit.job?.status ?? "")) schedule();
        } else {
          schedule();
        }
      }, delay);
    };
    const onVisibilityChange = () => schedule(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [photoJob, transport]);

  const confirmPhoto = useCallback(
    async (kind: PhotoSelectionKind, editId?: string | null) => {
      if (!transport.confirmPhoto) return false;
      setPhotoConfirming(true);
      setPhotoActionError(null);
      try {
        const response = await transport.confirmPhoto({
          kind,
          photo_edit_id: kind === "ai" ? editId : null,
        });
        if (!response.ok || !response.photoEdit) {
          setPhotoActionError(response.error ?? "Rasmni tasdiqlab bo‘lmadi");
          return false;
        }
        setPhotoEdit(response.photoEdit);
        return true;
      } catch {
        setPhotoActionError("Tarmoq xatosi. Qayta urinib ko‘ring.");
        return false;
      } finally {
        setPhotoConfirming(false);
      }
    },
    [transport],
  );

  /* ----------------------------- submit ----------------------------- */

  const answeredCount = questions.filter((q) => {
    const a = answers.get(q.question_no);
    return a && canAdvanceAnswer(a.answerState, a.plainText);
  }).length;

  // A question offering the "Yo‘q" escape never blocks submission, even when
  // left untouched — only a required question that refuses "Yo‘q" does.
  const missingRequiredCount = questions.filter((q) => {
    if (!q.required || q.allowNoAnswer) return false;
    const a = answers.get(q.question_no);
    return !(a && canAdvanceAnswer(a.answerState, a.plainText));
  }).length;

  const doSubmit = useCallback(async () => {
    if (requiresPhotoConfirmation && !photoEdit?.selection.confirmed) {
      setSubmitErrors(["Yuborishdan oldin rasmingizni tasdiqlang"]);
      return;
    }
    setBusy(true);
    setSubmitErrors([]);
    try {
      await flushAll();
      const resp = await transport.submit(contact);
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
    } catch {
      setSubmitErrors(["Yuborib bo‘lmadi — qayta urinib ko‘ring"]);
    } finally {
      // Must run even when flushAll() throws, otherwise the button stays
      // disabled for the rest of the session.
      setBusy(false);
    }
  }, [contact, draftKey, flushAll, photoEdit?.selection.confirmed, requiresPhotoConfirmation, transport]);

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
              {stage === 0
                ? template.photoTitle
                : stage <= questions.length
                  ? `Savol ${stage} / ${questions.length}`
                  : stage === contactStage
                    ? "Yakuniy ma’lumot"
                    : "Rasm va ma’lumotlarni tasdiqlash"}
            </p>
            <div className="mt-1.5 h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-cyan transition-all"
                style={{ width: `${(stage / (totalStages - 1)) * 100}%` }}
              />
            </div>
          </div>
          <SaveIndicator
            status={
              currentQuestion
                ? questionSaveStatuses.get(currentQuestion.question_no) ?? "idle"
                : saveStatus
            }
          />
        </div>
      </div>

      {/* General AI feedback (not tied to a specific question) */}
      {generalFeedback.length > 0 && (
        <div className="mb-4">
          <FeedbackPanel items={generalFeedback} title="Umumiy AI izohi" />
        </div>
      )}

      {/* Question navigator */}
      {stage >= 1 && stage <= questions.length && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {questions.map((q, i) => {
            const a = answers.get(q.question_no);
            const done = a && canAdvanceAnswer(a.answerState, a.plainText);
            return (
              <button
                key={q.question_no}
                onClick={() => void goToQuestion(i + 1)}
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
        {uploadError && (
          <p role="status" className="mb-4 rounded-field border border-coral/40 bg-coral/5 p-3 text-sm font-semibold text-coral">
            {uploadError}
          </p>
        )}
        {stage === 0 && (
          <PhotoStage
            title={template.photoTitle}
            instruction={template.photoInstruction}
            photo={photo}
            gender={gender}
            showPromptGuide={mode === "public" && !readOnly}
            photoPrompts={photoPrompts}
            busy={busy}
            readOnly={readOnly}
            onPick={(f) => doUpload(f, "photo")}
          />
        )}

        {currentQuestion && (
          <div>
            <div className="mb-3">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-bold text-ink">
                  <span className="mr-2 text-brand">{currentQuestion.question_no}.</span>
                  {currentQuestion.prompt}
                </h3>
                <span aria-live="polite" className="shrink-0">
                  <SaveIndicator status={questionSaveStatuses.get(currentQuestion.question_no) ?? "idle"} />
                </span>
              </div>
              {currentQuestion.help && (
                <p
                  className={cn(
                    "mt-2 text-xs",
                    currentQuestion.canonicalKey === "post_quote"
                      ? "flex items-start gap-2 rounded-[12px] border border-brand/30 bg-brand/[0.07] p-3 font-semibold leading-relaxed text-ink"
                      : "text-ink-soft",
                  )}
                >
                  {currentQuestion.canonicalKey === "post_quote" ? (
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                  ) : null}
                  <span>{currentQuestion.help}</span>
                </p>
              )}
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
            {feedbackByQuestion.has(currentQuestion.question_no) && (
              <FeedbackPanel items={feedbackByQuestion.get(currentQuestion.question_no)!} />
            )}
          </div>
        )}

        {stage === contactStage && (
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
            showSubmit={!requiresPhotoConfirmation}
          />
        )}

        {requiresPhotoConfirmation && stage === confirmationStage && (
          <FinalConfirmationStage
            photo={photo}
            photoEdit={photoEdit}
            contact={contact}
            answeredCount={answeredCount}
            total={questions.length}
            missingRequiredCount={missingRequiredCount}
            busy={busy}
            confirming={photoConfirming}
            actionError={photoActionError}
            onConfirm={confirmPhoto}
            onSubmit={doSubmit}
            submitErrors={submitErrors}
          />
        )}
      </div>

      {/* Nav footer */}
      {stage < totalStages - 1 && (
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={goPrev} disabled={stage === 0}>
            <ChevronLeft className="h-4 w-4" /> Orqaga
          </Button>
          <div className="text-xs text-ink-soft">
            {stage >= 1 && stage <= questions.length && !canGoNext && (
              <span className="text-amber">Javob bering yoki “Yo‘q” tugmasini bosing</span>
            )}
            {stage === contactStage && !canGoNext && (
              <span className="text-amber">Telefon, Telegram va rozilikni tekshiring</span>
            )}
          </div>
          <Button onClick={goNext} disabled={!canGoNext}>
            {stage === questions.length
              ? "Yakuniy ma’lumot"
              : stage === contactStage
                ? "Rasmni tasdiqlash"
                : "Keyingi"}{" "}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      {requiresPhotoConfirmation && stage === confirmationStage && (
        <div className="mt-5">
          <Button variant="secondary" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" /> Orqaga
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
  gender,
  showPromptGuide,
  photoPrompts,
  busy,
  readOnly,
  onPick,
}: {
  title: string;
  instruction: string;
  photo: { url: string | null; file_name: string } | null;
  gender: Gender | null;
  showPromptGuide: boolean;
  photoPrompts?: Record<Gender, string>;
  busy: boolean;
  readOnly: boolean;
  onPick: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="text-center">
      {showPromptGuide && (
        <div className="mb-6 flex items-start gap-3 rounded-[22px] border border-cyan/35 bg-gradient-to-br from-brand/[0.07] to-cyan/[0.09] p-4 text-left">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Info className="h-4 w-4" />
          </span>
          <p className="text-sm leading-relaxed text-ink">
            Avval quyidagi matnni nusxalab oling, rasmingiz bilan birga sun’iy intellektga bering va
            tayyor bo‘lgan natijani shu yerga yuklang.
          </p>
        </div>
      )}
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

      {showPromptGuide && <PhotoPromptCard gender={gender} prompts={photoPrompts} />}
    </div>
  );
}

/**
 * The candidate improves the photo themselves: they copy this prompt into any AI
 * image tool and upload the result. Replaces the old in-form generation button.
 */
function PhotoPromptCard({
  gender,
  prompts,
}: {
  gender: Gender | null;
  prompts?: Record<Gender, string>;
}) {
  // Gender is nullable on the intake row; without it the candidate picks, so
  // nobody is handed the wrong prompt silently.
  const [promptGender, setPromptGender] = useState<Gender>(gender ?? "male");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // The admin panel is the source; MANUAL_PHOTO_PROMPTS only covers the case
  // where the fragments could not be loaded at all.
  const prompt = prompts?.[promptGender]?.trim() || MANUAL_PHOTO_PROMPTS[promptGender];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div className="mt-6 rounded-field border border-line bg-surface/40 p-4 text-left">
      <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
        <Sparkles className="h-4 w-4 text-brand" /> Rasmingizni sun’iy intellektga bering va natijani yuboring
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
        Quyidagi matnni nusxalang va rasmingiz bilan birga o‘zingiz foydalanadigan sun’iy intellekt
        xizmatiga yuboring. Tayyor rasmni yuqoridagi «Rasm yuklash» tugmasi orqali joylang.
      </p>

      {!gender && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(["male", "female"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setPromptGender(g)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                promptGender === g ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-soft hover:border-brand/40",
              )}
            >
              {g === "male" ? "Erkaklar uchun" : "Ayollar uchun"}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-[18px] border border-line bg-card p-3 text-xs leading-relaxed text-ink">
        {prompt}
      </p>

      <Button variant="ai" className="mt-3 w-full" onClick={() => void copy()}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? "Nusxalandi" : "Matnni nusxalash"}
      </Button>
      {copyFailed && (
        <p role="status" className="mt-2 text-xs font-semibold text-coral">
          Nusxalab bo‘lmadi — matnni qo‘lda belgilab nusxalang.
        </p>
      )}
    </div>
  );
}

function FinalConfirmationStage({
  photo,
  photoEdit,
  contact,
  answeredCount,
  total,
  missingRequiredCount,
  busy,
  confirming,
  actionError,
  onConfirm,
  onSubmit,
  submitErrors,
}: {
  photo: { url: string | null; file_name: string } | null;
  photoEdit: CandidatePhotoStateView | null;
  contact: { phone: string; telegram: string; consent: boolean };
  answeredCount: number;
  total: number;
  missingRequiredCount: number;
  busy: boolean;
  confirming: boolean;
  actionError: string | null;
  onConfirm: (kind: PhotoSelectionKind, editId?: string | null) => Promise<boolean>;
  onSubmit: () => void;
  submitErrors: string[];
}) {
  const [pendingChoice, setPendingChoice] = useState<PhotoSelectionKind | null>(null);
  const completed = photoEdit?.completed ?? null;
  const processing = photoEdit?.job?.status === "queued" || photoEdit?.job?.status === "processing";
  const failed = photoEdit?.job?.status === "failed";
  // Candidates no longer start AI edits, but an admin-run one (or a job from
  // before the switch) still deserves a choice here.
  const hasAiOption = !!completed || processing || failed;
  const choice = pendingChoice ?? photoEdit?.selection.kind ?? null;
  // Authoritative, server-derived confirmation (photo_confirmed_at + matching
  // selected_photo_source/id) — never the local "Tanlandi" choice.
  const confirmed = photoEdit?.selection.confirmed ?? false;
  const answersComplete = missingRequiredCount === 0;
  const contactValid = validateContact(contact).ok;
  const canSubmit = canSubmitCandidateFinal({
    everyAnswerValid: answersComplete,
    contactValid,
    photoConfirmed: confirmed,
  });

  // Spell out every outstanding requirement — a disabled button with no
  // explanation is what made this look broken.
  const blockers = [
    missingRequiredCount > 0 && `${missingRequiredCount} ta majburiy savol javobsiz`,
    !contactValid && "Telefon raqami, Telegram username va rozilik to‘ldirilishi kerak",
    !confirmed && (hasAiOption ? "Original yoki AI rasmni tasdiqlang" : "Yuklagan rasmingizni tasdiqlang"),
  ].filter(Boolean) as string[];

  // Safe diagnostics only — no token/phone/telegram/name/PII.
  console.info("INTAKE_FINAL_STATE", {
    answersComplete,
    contactComplete: contactValid,
    photoConfirmed: confirmed,
    selectedPhotoSource: photoEdit?.selection.kind ?? null,
    isSubmitting: busy,
    canSubmit,
  });

  const selectAndConfirm = async (kind: PhotoSelectionKind) => {
    setPendingChoice(kind);
    const ok = await onConfirm(kind, kind === "ai" ? completed?.id : null);
    if (!ok) setPendingChoice(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-lg font-semibold uppercase tracking-wide text-ink">
          Rasm va ma’lumotlarni tasdiqlash
        </h3>
        <p className="mt-1 text-sm text-ink-soft">
          {hasAiOption
            ? "Yakuniy rasmni ongli ravishda tanlang, so‘ng ma’lumotlaringizni yuboring."
            : "Yuklagan rasmingizni tasdiqlang, so‘ng ma’lumotlaringizni yuboring."}
        </p>
      </div>

      {processing && (
        <div aria-live="polite" className="flex items-start gap-3 rounded-[22px] border border-cyan/35 bg-brand/[0.05] p-4">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-brand" />
          <div>
            <p className="text-sm font-bold text-ink">Rasmingiz hali tayyorlanmoqda. Javoblaringiz saqlandi.</p>
            <p className="mt-1 text-xs text-ink-soft">AI rasm tayyor bo‘lgach shu sahifada avtomatik ko‘rinadi.</p>
          </div>
        </div>
      )}

      {failed && (
        <div role="status" className="flex items-start gap-3 rounded-[22px] border border-coral/35 bg-coral/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral" />
          <p className="text-sm text-coral">
            Rasmni tayyorlashda muammo yuz berdi. Qayta urinishingiz yoki original rasmni tanlashingiz mumkin.
          </p>
        </div>
      )}

      <div
        role="radiogroup"
        aria-label="Yakuniy rasm"
        className={cn("grid gap-4", hasAiOption ? "sm:grid-cols-2" : "mx-auto max-w-xs")}
      >
        <PhotoChoiceCard
          label={hasAiOption ? "Original rasm" : "Yuklagan rasmingiz"}
          url={photo?.url ?? null}
          alt={photo?.file_name ?? "Yuklangan rasm"}
          selected={choice === "original"}
          confirmed={confirmed && photoEdit?.selection.kind === "original"}
          onSelect={() => setPendingChoice("original")}
        />
        {hasAiOption && (
          <PhotoChoiceCard
            label="Jaxongir AI bilan yaxshilangan"
            url={completed?.url ?? null}
            alt="Jaxongir AI bilan yaxshilangan rasm"
            selected={choice === "ai"}
            confirmed={confirmed && photoEdit?.selection.kind === "ai"}
            loading={processing && !completed}
            onSelect={() => completed && setPendingChoice("ai")}
          />
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-field border border-line bg-surface/50 p-3 text-center">
          <p className={cn("text-lg font-bold", answeredCount === total ? "text-green" : "text-amber")}>{answeredCount}/{total}</p>
          <p className="text-[11px] text-ink-soft">Javoblar</p>
        </div>
        <div className="rounded-field border border-line bg-surface/50 p-3 text-center">
          <p className={cn("text-lg font-bold", contactValid ? "text-green" : "text-amber")}>{contactValid ? "✓" : "—"}</p>
          <p className="text-[11px] text-ink-soft">Aloqa</p>
        </div>
        <div className="rounded-field border border-line bg-surface/50 p-3 text-center">
          <p className={cn("text-lg font-bold", confirmed ? "text-green" : "text-amber")}>{confirmed ? "✓" : "—"}</p>
          <p className="text-[11px] text-ink-soft">Rasm tasdig‘i</p>
        </div>
      </div>

      {actionError && (
        <p role="status" className="rounded-field border border-coral/40 bg-coral/5 p-3 text-sm font-semibold text-coral">
          {actionError}
        </p>
      )}

      {submitErrors.length > 0 && (
        <ul role="status" className="space-y-1 rounded-field border border-coral/40 bg-coral/5 p-3">
          {submitErrors.map((error, index) => (
            <li key={index} className="text-sm font-semibold text-coral">• {error}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void selectAndConfirm(choice ?? (completed ? "ai" : "original"))}
        disabled={confirming || (!photo?.url && choice !== "ai") || (choice === "ai" && !completed)}
        className="ai-gradient inline-flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-[20px] px-6 text-[18px] font-extrabold text-white shadow-[0_12px_30px_rgba(0,199,232,0.22)] transition-all active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {confirming ? <Loader2 className="h-[22px] w-[22px] animate-spin" /> : <Check className="h-[22px] w-[22px]" />}
        {confirmed && choice === (photoEdit?.selection.kind ?? null) ? "Rasm tasdiqlandi" : "Shu rasmni tasdiqlash"}
      </button>

      {hasAiOption && photo?.url && photoEdit?.selection.kind !== "original" && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void selectAndConfirm("original")}
          disabled={confirming}
        >
          <Camera className="h-4 w-4" /> Original rasmni tanlash
        </Button>
      )}

      <Button className="w-full" size="lg" onClick={onSubmit} disabled={busy || !canSubmit}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Anketani yuborish
      </Button>
      {blockers.length > 0 && (
        <div className="rounded-field border border-amber/40 bg-amber/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
            <ShieldCheck className="h-3.5 w-3.5" /> Yuborish uchun quyidagilar kerak:
          </p>
          <ul className="mt-1.5 space-y-1">
            {blockers.map((b) => (
              <li key={b} className="text-xs text-ink-soft">• {b}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PhotoChoiceCard({
  label,
  url,
  alt,
  selected,
  confirmed,
  loading = false,
  onSelect,
}: {
  label: string;
  url: string | null;
  alt: string;
  selected: boolean;
  confirmed: boolean;
  loading?: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={url ? 0 : -1}
      onClick={url ? onSelect : undefined}
      onKeyDown={(event) => {
        if (url && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "relative overflow-hidden rounded-[22px] border-2 bg-surface/40 p-3 transition",
        url && "cursor-pointer",
        selected ? "border-cyan shadow-card ring-2 ring-cyan/20" : "border-line",
      )}
    >
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
        <p className="text-xs font-bold text-ink">{label}</p>
        {selected && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan text-white">
            <Check className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      {url ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
          <img src={url} alt={alt} className="aspect-[4/5] w-full rounded-2xl object-cover" />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-xl bg-ink/75 text-white backdrop-blur"
            aria-label={`${label}ni katta ko‘rish`}
          >
            <Maximize2 className="h-4 w-4" />
          </a>
        </div>
      ) : (
        <div className="flex aspect-[4/5] w-full items-center justify-center rounded-2xl border border-dashed border-line bg-card">
          {loading ? <Loader2 className="h-7 w-7 animate-spin text-brand" /> : <Camera className="h-7 w-7 text-ink-soft" />}
        </div>
      )}
      <p className={cn("mt-2 text-center text-xs font-semibold", confirmed ? "text-green" : "text-ink-soft")}>
        {confirmed ? "Tasdiqlandi" : selected ? "Tanlandi" : url ? "Tanlash" : "Kutilmoqda"}
      </p>
    </div>
  );
}

function FeedbackPanel({ items, title = "AI izohi" }: { items: IntakeFeedbackView[]; title?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-3 overflow-hidden rounded-field border border-amber/50 bg-amber/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-amber">
          <MessageCircleQuestion className="h-4 w-4" /> {title}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-amber transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {items.map((f, i) => (
            <p key={i} className="whitespace-pre-wrap text-sm text-ink">
              {f.feedback_text}
            </p>
          ))}
          <p className="text-xs text-ink-soft">Iltimos, javobingizni yuqorida tahrirlab, so‘ng qayta yuboring.</p>
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
  showSubmit = true,
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
  showSubmit?: boolean;
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

      {!readOnly && showSubmit && (
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
      {!validateContact(contact).ok && !readOnly && showSubmit && (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-soft">
          <ShieldCheck className="h-3.5 w-3.5" />
          {!contact.consent
            ? "Yuborish uchun rozilikni belgilang"
            : "Telefon (+998…) va Telegram username (@…) to‘g‘ri kiritilishi kerak"}
        </p>
      )}
    </div>
  );
}
