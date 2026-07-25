"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, LinkIcon, ShieldAlert } from "lucide-react";
import {
  IntakeForm,
  type IntakeTransport,
  type IntakeTemplateView,
  type IntakeAnswerView,
} from "@/components/intake/intake-form";

interface ResolvedState {
  full_name: string;
  gender: string | null;
  status: string;
  contact: { phone: string | null; telegram: string | null; consent: boolean };
  template: IntakeTemplateView;
  answers: IntakeAnswerView[];
  photo: { file_name: string; url: string | null } | null;
  feedback: { question_no: number | null; feedback_text: string; feedback_type: string }[];
  settings: { consentText: string; consentVersion: string; maxUploadBytes: number };
}

function useDraftKey(): string {
  const [key] = useState(() => {
    try {
      let k = sessionStorage.getItem("intake-draft-key");
      if (!k) {
        k = crypto.randomUUID();
        sessionStorage.setItem("intake-draft-key", k);
      }
      return k;
    } catch {
      return crypto.randomUUID();
    }
  });
  return key;
}

/** Public secure-link form. The raw token stays in client memory only. */
export function PublicIntake({ token }: { token: string }) {
  const [state, setState] = useState<ResolvedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftKey = useDraftKey();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/intake/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || !json.ok) {
          setError(json.error ?? "Havolani ochib bo‘lmadi");
          return;
        }
        setState(json as ResolvedState);
      } catch {
        if (alive) setError("Tarmoq xatosi. Internetni tekshiring.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const transport = useMemo<IntakeTransport>(() => {
    const postJson = (path: string, body: object) =>
      fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ token, ...body }),
      });
    return {
      async autosave(p) {
        try {
          const r = await postJson("/api/intake/autosave", p);
          return await r.json();
        } catch {
          return { ok: false, error: "network" };
        }
      },
      async upload(file, opts) {
        const fd = new FormData();
        fd.set("token", token);
        fd.set("file", file);
        fd.set("purpose", opts.purpose);
        if (opts.question_no != null) fd.set("question_no", String(opts.question_no));
        const r = await fetch("/api/intake/upload", { method: "POST", body: fd });
        return r.json();
      },
      async submit(c) {
        const r = await postJson("/api/intake/submit", c);
        return r.json();
      },
      async heartbeat() {
        await postJson("/api/intake/heartbeat", {}).catch(() => {});
      },
      async generatePhoto(params) {
        try {
          const r = await postJson("/api/intake/photo-edit", params);
          const j = await r.json();
          if (!r.ok || !j.ok) return { ok: false, error: j.error ?? "Rasmni yaratib bo‘lmadi" };
          return { ok: true, url: j.edit?.url ?? null };
        } catch {
          return { ok: false, error: "Tarmoq xatosi" };
        }
      },
    };
  }, [token]);

  if (error) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-panel border border-coral/40 bg-card p-10 text-center shadow-card">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-coral/15 text-coral">
          <LinkIcon className="h-7 w-7" />
        </span>
        <h1 className="font-display text-xl font-semibold uppercase tracking-wide text-ink">Havola yaroqsiz</h1>
        <p className="mt-2 text-sm text-ink-soft">{error}</p>
        <p className="mt-4 text-xs text-ink-soft">Havola muddati tugagan yoki bekor qilingan bo‘lishi mumkin. Iltimos, jamoamiz bilan bog‘laning.</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mt-32 flex flex-col items-center gap-3 text-ink-soft">
        <Loader2 className="h-7 w-7 animate-spin text-brand" />
        <p className="text-sm">Anketa yuklanmoqda…</p>
      </div>
    );
  }

  const readOnly = !["draft", "needs_clarification"].includes(state.status);

  return (
    <div className="px-4 py-8" data-intake-gender={state.gender === "female" ? "female" : "male"}>
      <div className="mx-auto mb-8 max-w-3xl text-center">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide text-ink">
          Assalomu alaykum, {state.full_name}!
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">{state.template.intro}</p>
      </div>

      {state.status === "needs_clarification" && (
        <div className="mx-auto mb-6 flex max-w-3xl items-start gap-2 rounded-field border border-peach/50 bg-peach/10 p-3 text-sm text-amber">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Jamoamiz ayrim javoblarni aniqlashtirishingizni so‘radi. Iltimos, tegishli savollarni ko‘rib chiqing va yangilang.</span>
        </div>
      )}

      <IntakeForm
        mode="public"
        template={state.template}
        initialAnswers={state.answers}
        initialPhoto={state.photo ? { url: state.photo.url, file_name: state.photo.file_name } : null}
        initialContact={state.contact}
        consentText={state.settings.consentText}
        maxUploadBytes={state.settings.maxUploadBytes}
        draftKey={draftKey}
        transport={transport}
        readOnly={readOnly}
        feedback={state.feedback}
      />
    </div>
  );
}
