"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCircle2, Eye, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  archiveCandidateAction,
  restoreCandidateAction,
  setCandidateStatusAction,
} from "@/lib/actions/candidates";
import type { CandidateStatus } from "@/lib/types";

export function StatusActions({
  candidateId,
  status,
  isDeleted,
  canPublish,
  canArchive,
}: {
  candidateId: string;
  status: CandidateStatus;
  isDeleted: boolean;
  canPublish: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const setStatus = (next: CandidateStatus) => {
    startTransition(async () => {
      const res = await setCandidateStatusAction(candidateId, next);
      if (res.ok) {
        toast("success", "Status yangilandi");
        router.refresh();
      } else {
        toast("error", "Xatolik", res.error);
      }
    });
  };

  if (isDeleted) {
    return (
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await restoreCandidateAction(candidateId);
            if (res.ok) {
              toast("success", "Nomzod tiklandi");
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          })
        }
      >
        <RotateCcw className="h-4 w-4" /> Arxivdan tiklash
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "review" && status !== "published" && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setStatus("review")}>
          <Eye className="h-4 w-4" /> Ko‘rib chiqishga
        </Button>
      )}
      {status !== "published" && canPublish && (
        <Button variant="success" size="sm" disabled={pending} onClick={() => setConfirmPublish(true)}>
          <CheckCircle2 className="h-4 w-4" /> Nashr etish
        </Button>
      )}
      {status === "published" && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setStatus("draft")}>
          <Send className="h-4 w-4" /> Qoralamaga qaytarish
        </Button>
      )}
      {canArchive && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmArchive(true)}>
          <Archive className="h-4 w-4" /> Arxivlash
        </Button>
      )}

      <ConfirmDialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        onConfirm={() => {
          setConfirmPublish(false);
          setStatus("published");
        }}
        title="Profilni nashr etish"
        description="Profil liderlar.uz saytida ommaga ko‘rinadi va 30 kunlik yangilanish sikli boshlanadi."
        confirmLabel="Nashr etish"
      />
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          startTransition(async () => {
            const res = await archiveCandidateAction(candidateId);
            if (res && !res.ok) toast("error", "Xatolik", res.error);
          });
        }}
        title="Profilni arxivlash"
        description="Profil saytdan olib tashlanadi, ammo ma’lumotlar o‘chirilmaydi (soft delete). Keyinchalik tiklash mumkin."
        confirmLabel="Arxivlash"
        danger
      />
    </div>
  );
}
