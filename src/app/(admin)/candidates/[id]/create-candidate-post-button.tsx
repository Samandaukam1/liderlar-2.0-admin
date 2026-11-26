"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  createPostForCandidateAction,
  preparePortraitAction,
  rerenderPostAction,
} from "@/lib/actions/post-studio";

export function CreateCandidatePostButton({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [progress, setProgress] = useState(1);
  const [label, setLabel] = useState("Ma’lumotlar tayyorlanmoqda…");
  const [error, setError] = useState<string | null>(null);

  function createPost() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setProgress(1);
    setLabel("Ma’lumotlar tayyorlanmoqda…");

    startTransition(async () => {
      try {
        const created = await createPostForCandidateAction(candidateId);
        if (!created.ok || !created.postId) {
          throw new Error(created.error ?? "Post yaratilmadi");
        }

        setProgress(35);
        setLabel("Portret tayyorlanmoqda…");
        const portrait = await preparePortraitAction(created.postId, { force: false });
        if (!portrait.ok) throw new Error(portrait.error ?? "Portret tayyorlanmadi");

        setProgress(75);
        setLabel("Dizayn joylashtirilmoqda…");
        const rendered = await rerenderPostAction(created.postId);
        if (!rendered.ok) throw new Error(rendered.error ?? "Dizayn tayyorlanmadi");

        setProgress(100);
        setLabel("Post tayyor — Studio ochilmoqda…");
        await new Promise((resolve) => setTimeout(resolve, 350));
        router.push(`/postlar/${created.postId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Post yaratishda xatolik. Qayta urinib ko‘ring.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <button
        type="button"
        disabled={pending}
        onClick={createPost}
        className="inline-flex h-8 items-center justify-center gap-2 rounded-[14px] border border-line-strong bg-card px-3 text-xs font-bold text-ink transition duration-150 hover:border-brand/50 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-70"
      >
        {!pending && <Plus className="h-4 w-4" aria-hidden="true" />}
        <span role="status" aria-live="polite">
          {pending ? `${progress}% — ${label}` : "Post yaratish"}
        </span>
      </button>
      {pending && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-1.5 w-full overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {error && <span role="alert" className="max-w-sm text-xs text-[#c43d3d]">{error}</span>}
    </div>
  );
}
