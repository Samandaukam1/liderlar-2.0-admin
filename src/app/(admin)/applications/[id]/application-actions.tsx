"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquarePlus, UserPlus, X, HelpCircle } from "lucide-react";
import { Button, FormField, Textarea } from "@/components/ui/primitives";
import { Modal, ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  addApplicationNoteAction,
  convertApplicationAction,
  setApplicationStatusAction,
} from "@/lib/actions/applications";
import type { ApplicationStatus } from "@/lib/types";

export function ApplicationActions({
  applicationId,
  status,
  canConvert,
}: {
  applicationId: string;
  status: ApplicationStatus;
  canConvert: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<"rejected" | "needs_info" | "note" | null>(null);
  const [text, setText] = useState("");
  const [confirmConvert, setConfirmConvert] = useState(false);

  const set = (next: ApplicationStatus, comment?: string) =>
    startTransition(async () => {
      const res = await setApplicationStatusAction(applicationId, next, comment);
      if (res.ok) {
        toast("success", "Status yangilandi");
        setModal(null);
        setText("");
        router.refresh();
      } else toast("error", "Xatolik", res.error);
    });

  const open = status !== "converted";

  return (
    <div className="flex flex-wrap gap-2">
      {open && status === "new" && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => set("in_review")}>
          Ko‘rib chiqishni boshlash
        </Button>
      )}
      {open && status !== "accepted" && (
        <Button variant="success" size="sm" disabled={pending} onClick={() => set("accepted")}>
          <Check className="h-4 w-4" /> Qabul qilish
        </Button>
      )}
      {open && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => setModal("needs_info")}>
          <HelpCircle className="h-4 w-4" /> Ma’lumot so‘rash
        </Button>
      )}
      {open && status !== "rejected" && (
        <Button variant="danger" size="sm" disabled={pending} onClick={() => setModal("rejected")}>
          <X className="h-4 w-4" /> Rad etish
        </Button>
      )}
      {status === "accepted" && canConvert && (
        <Button size="sm" disabled={pending} onClick={() => setConfirmConvert(true)}>
          <UserPlus className="h-4 w-4" /> Nomzodga aylantirish
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setModal("note")}>
        <MessageSquarePlus className="h-4 w-4" /> Izoh
      </Button>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={
          modal === "rejected"
            ? "Rad etish sababi"
            : modal === "needs_info"
              ? "Qanday ma’lumot kerak?"
              : "Moderator izohi"
        }
      >
        <div className="space-y-4">
          <FormField label="Matn" htmlFor="app-comment">
            <Textarea
              id="app-comment"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>
              Bekor qilish
            </Button>
            <Button
              variant={modal === "rejected" ? "danger" : "primary"}
              disabled={pending || text.trim().length < 2}
              onClick={() => {
                if (modal === "note") {
                  startTransition(async () => {
                    const res = await addApplicationNoteAction(applicationId, text);
                    if (res.ok) {
                      toast("success", "Izoh qo‘shildi");
                      setModal(null);
                      setText("");
                      router.refresh();
                    } else toast("error", "Xatolik", res.error);
                  });
                } else if (modal) {
                  set(modal, text);
                }
              }}
            >
              Saqlash
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmConvert}
        onClose={() => setConfirmConvert(false)}
        onConfirm={() => {
          setConfirmConvert(false);
          startTransition(async () => {
            const res = await convertApplicationAction(applicationId);
            if (res.ok && res.candidateId) {
              toast("success", "Nomzod profili yaratildi");
              router.push(`/candidates/${res.candidateId}`);
            } else toast("error", "Xatolik", res.error);
          });
        }}
        title="Nomzodga aylantirish"
        description="Ariza asosida qoralama nomzod profili yaratiladi. Ariza “converted” holatiga o‘tadi."
        confirmLabel="Aylantirish"
      />
    </div>
  );
}
