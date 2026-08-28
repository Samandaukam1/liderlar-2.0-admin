"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import {
  createPostForCandidateAction,
  preparePortraitAction,
  rerenderPostAction,
} from "@/lib/actions/post-studio";

/**
 * Manual entry point. Posts are normally created by the two-hour pipeline, but
 * an admin still needs a way to build one for an older candidate whose intake
 * predates the automation.
 *
 * Creation runs in three real steps — row, cut-out, render — and the bar moves
 * as each one actually returns, rather than animating on a timer. Background
 * removal is around a second on its own, so a button that simply went quiet
 * read as a hang.
 */

const STEPS = [
  { at: 10, label: "Ma’lumotlar tayyorlanmoqda…" },
  { at: 35, label: "Portret tayyorlanmoqda…" },
  { at: 75, label: "Dizayn joylashtirilmoqda…" },
  { at: 100, label: "Post tayyor" },
] as const;

export function CreatePostForm({
  candidates,
}: {
  candidates: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const [candidateId, setCandidateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();

  function onCreate() {
    if (!candidateId) return;
    setError(null);
    setNotice(null);

    startTransition(async () => {
      setStep(0);
      const created = await createPostForCandidateAction(candidateId);
      if (!created.ok || !created.postId) {
        setStep(0);
        setError(created.error ?? "Post yaratilmadi");
        return;
      }
      const postId = created.postId;

      // The cut-out is reused when the candidate's photo has not changed, so
      // this is fast on a repeat and ~1s the first time.
      setStep(1);
      const portrait = await preparePortraitAction(postId, { force: false });

      setStep(2);
      const rendered = await rerenderPostAction(postId);

      setStep(3);
      const problems = [portrait.error, rendered.error].filter(Boolean) as string[];
      if (problems.length > 0) {
        // The post exists and is flagged for review; the admin still goes to
        // the studio, but with the reason in front of them.
        setNotice(problems.join(" · "));
      }
      router.push(`/postlar/${postId}`);
    });
  }

  const current = STEPS[step];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={candidateId}
          onChange={(e) => setCandidateId(e.target.value)}
          className="w-auto min-w-[220px]"
          aria-label="Nomzod tanlang"
          disabled={pending}
        >
          <option value="">Nomzod tanlang…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.fullName}
            </option>
          ))}
        </Select>
        <Button type="button" size="sm" disabled={pending || !candidateId} onClick={onCreate}>
          {pending ? null : <Plus className="h-3.5 w-3.5" />}
          {pending ? `${current.at}% — ${current.label}` : "Post yaratish"}
        </Button>
        {error ? <span className="text-xs text-[#c43d3d]">{error}</span> : null}
      </div>

      {pending ? (
        <div
          className="h-1.5 w-full max-w-[420px] overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={current.at}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={current.label}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${current.at}%` }}
          />
        </div>
      ) : null}

      {!pending && step === STEPS.length - 1 && !error ? (
        <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
          <Check className="h-3.5 w-3.5" />
          {notice ?? "Post tayyor — portret, iqtibos va dizayn joylashtirildi."}
        </span>
      ) : null}
    </div>
  );
}
