"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { createPostForCandidateAction } from "@/lib/actions/post-studio";

/**
 * Manual entry point. Posts are normally created by the two-hour pipeline, but
 * an admin still needs a way to build one for an older candidate whose intake
 * predates the automation.
 */
export function CreatePostForm({
  candidates,
}: {
  candidates: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const [candidateId, setCandidateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onCreate() {
    if (!candidateId) return;
    startTransition(async () => {
      const result = await createPostForCandidateAction(candidateId);
      if (result.ok && result.postId) router.push(`/postlar/${result.postId}`);
      else setError(result.error ?? "Post yaratilmadi");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={candidateId}
        onChange={(e) => setCandidateId(e.target.value)}
        className="w-auto min-w-[220px]"
        aria-label="Nomzod tanlang"
      >
        <option value="">Nomzod tanlang…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName}
          </option>
        ))}
      </Select>
      <Button type="button" size="sm" disabled={pending || !candidateId} onClick={onCreate}>
        <Plus className="h-3.5 w-3.5" />
        Post yaratish
      </Button>
      {error ? <span className="text-xs text-[#c43d3d]">{error}</span> : null}
    </div>
  );
}
