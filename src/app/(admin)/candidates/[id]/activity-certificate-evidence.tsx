"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileUp } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  EVIDENCE_ACCEPT,
  EVIDENCE_BUCKET,
  EVIDENCE_TYPE_ERROR,
  validEvidenceMeta,
} from "@/lib/profile-editor/evidence-rules";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type EvidenceRequest =
  | { step: "sign"; mimeType: string; size: number }
  | { step: "confirm"; receipt: string };

type EvidenceReply = {
  ok?: boolean;
  error?: string;
  path?: string;
  token?: string;
  receipt?: string;
};

async function postEvidence(endpoint: string, body: EvidenceRequest) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const reply = await response.json().catch(() => null) as EvidenceReply | null;
  if (!response.ok || !reply?.ok) {
    throw new Error(reply?.error || "Dalilni yuklab bo‘lmadi.");
  }
  return reply;
}

export function ActivityCertificateEvidence({
  candidateId,
  certificateId,
  hasEvidence,
  legacyEvidenceUrl,
}: {
  candidateId: string;
  certificateId: string;
  hasEvidence: boolean;
  legacyEvidenceUrl?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = uploading || refreshing;
  const endpoint = `/api/admin/candidates/${candidateId}/certificates/${certificateId}/evidence`;
  const legacyHref = legacyEvidenceUrl && /^https:\/\//i.test(legacyEvidenceUrl) ? legacyEvidenceUrl : null;
  const evidenceHref = hasEvidence
    ? `/api/profile/certificate-evidence/${certificateId}`
    : legacyHref;

  async function upload(file: File) {
    if (busy) return;
    setError(null);
    if (!validEvidenceMeta(file.type, file.size)) {
      setError(EVIDENCE_TYPE_ERROR);
      return;
    }

    setUploading(true);
    try {
      const { path, token, receipt } = await postEvidence(endpoint, {
        step: "sign",
        mimeType: file.type,
        size: file.size,
      });
      if (!path || !token || !receipt) throw new Error("Dalil uchun yuklash havolasi olinmadi.");

      const storage = createSupabaseBrowserClient().storage.from(EVIDENCE_BUCKET);
      const { error: uploadError } = await storage.uploadToSignedUrl(path, token, file, {
        contentType: file.type,
        cacheControl: "0",
      });
      if (uploadError) throw new Error("Faylni yuklab bo‘lmadi. Qayta urinib ko‘ring.");

      await postEvidence(endpoint, { step: "confirm", receipt });
      toast("success", "Dalil saqlandi");
      startRefresh(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dalilni yuklab bo‘lmadi.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        type="file"
        accept={EVIDENCE_ACCEPT}
        className="hidden"
        disabled={busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-brand">
        {evidenceHref && (
          <a
            href={evidenceHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Dalilni ochish <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >
          <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
          {busy ? "Dalil yuklanmoqda…" : evidenceHref ? "Dalilni almashtirish" : "Dalil yuklash (PDF yoki rasm)"}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-ink-soft">PDF, JPG, PNG yoki WebP · 10 MB gacha</p>
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-[#a33232]">{error}</p>}
    </div>
  );
}
