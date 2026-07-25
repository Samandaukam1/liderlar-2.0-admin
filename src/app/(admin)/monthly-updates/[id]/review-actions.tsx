"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, GitMerge, RotateCcw, X } from "lucide-react";
import { Button, FormField, Textarea } from "@/components/ui/primitives";
import { Modal, ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  mergeUpdateAction,
  saveUpdateTextsAction,
  setUpdateStatusAction,
} from "@/lib/actions/monthly";
import { AIImprovePanel } from "@/components/admin/ai-panel";
import type { MonthlyUpdateStatus } from "@/lib/types";

export function ReviewActions({
  updateId,
  status,
  canMerge,
}: {
  updateId: string;
  status: MonthlyUpdateStatus;
  canMerge: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [commentModal, setCommentModal] = useState<"needs_changes" | "rejected" | null>(null);
  const [comment, setComment] = useState("");
  const [confirmMerge, setConfirmMerge] = useState(false);

  const set = (next: MonthlyUpdateStatus, c?: string) =>
    startTransition(async () => {
      const res = await setUpdateStatusAction(updateId, next, c);
      if (res.ok) {
        toast("success", "Status yangilandi");
        setCommentModal(null);
        setComment("");
        router.refresh();
      } else toast("error", "Xatolik", res.error);
    });

  return (
    <div className="flex flex-wrap gap-2">
      {(status === "submitted" || status === "needs_changes") && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => set("under_review")}>
          Tekshirishni boshlash
        </Button>
      )}
      {(status === "submitted" || status === "under_review" || status === "needs_changes") && (
        <>
          <Button variant="success" size="sm" disabled={pending} onClick={() => set("approved")}>
            <Check className="h-4 w-4" /> Tasdiqlash
          </Button>
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setCommentModal("needs_changes")}>
            <RotateCcw className="h-4 w-4" /> Tuzatishga qaytarish
          </Button>
          <Button variant="danger" size="sm" disabled={pending} onClick={() => setCommentModal("rejected")}>
            <X className="h-4 w-4" /> Rad etish
          </Button>
        </>
      )}
      {status === "approved" && canMerge && (
        <Button variant="ai" size="sm" disabled={pending} onClick={() => setConfirmMerge(true)}>
          <GitMerge className="h-4 w-4" /> Biografiyaga birlashtirish
        </Button>
      )}
      {status === "rejected" && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => set("under_review")}>
          Qayta ko‘rib chiqish
        </Button>
      )}

      <Modal
        open={commentModal !== null}
        onClose={() => setCommentModal(null)}
        title={commentModal === "rejected" ? "Rad etish sababi" : "Tuzatish izohi"}
      >
        <div className="space-y-4">
          <FormField
            label="Nomzodga izoh"
            htmlFor="review-comment"
            hint="Bu izoh nomzodga ko‘rsatiladi"
          >
            <Textarea
              id="review-comment"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Nimani tuzatish yoki aniqlashtirish kerak…"
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCommentModal(null)}>
              Bekor qilish
            </Button>
            <Button
              variant={commentModal === "rejected" ? "danger" : "primary"}
              disabled={pending || comment.trim().length < 3}
              onClick={() => commentModal && set(commentModal, comment)}
            >
              {commentModal === "rejected" ? "Rad etish" : "Qaytarish"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmMerge}
        onClose={() => setConfirmMerge(false)}
        onConfirm={() => {
          setConfirmMerge(false);
          startTransition(async () => {
            const res = await mergeUpdateAction(updateId);
            if (res.ok) {
              toast("success", "Biografiyaga birlashtirildi", `${res.mergedItems ?? 0} ta yozuv profil jadvallariga qo‘shildi`);
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          });
        }}
        title="Biografiyaga birlashtirish"
        description="Tasdiqlangan yozuvlar (kitoblar, yutuqlar, tadbirlar…) nomzod profiliga ko‘chiriladi va 30 kunlik sikl qayta boshlanadi."
        confirmLabel="Birlashtirish"
      />
    </div>
  );
}

export function UpdateAIPanel({
  updateId,
  original,
  aiText,
  candidateName,
}: {
  updateId: string;
  original: string;
  aiText: string | null;
  candidateName: string;
}) {
  const router = useRouter();
  return (
    <AIImprovePanel
      original={original}
      candidateName={candidateName}
      entityType="monthly_update"
      entityId={updateId}
      initialSuggestion={aiText}
      acceptLabel="Yakuniy matn sifatida saqlash"
      onAccept={async (text) => {
        const res = await saveUpdateTextsAction(updateId, {
          ai_text: text,
          final_text: text,
        });
        if (!res.ok) throw new Error(res.error);
        router.refresh();
      }}
    />
  );
}

export function FinalTextEditor({
  updateId,
  finalText,
}: {
  updateId: string;
  finalText: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(finalText ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <Textarea
        rows={8}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Profilga qo‘shiladigan yakuniy matn…"
        aria-label="Yakuniy matn"
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={pending || value.trim() === (finalText ?? "").trim()}
          onClick={() =>
            startTransition(async () => {
              const res = await saveUpdateTextsAction(updateId, { final_text: value });
              if (res.ok) {
                toast("success", "Yakuniy matn saqlandi");
                router.refresh();
              } else toast("error", "Xatolik", res.error);
            })
          }
        >
          {pending ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      </div>
    </div>
  );
}
