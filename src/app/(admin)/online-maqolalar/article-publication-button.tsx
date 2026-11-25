"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Send } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { runEditorialAction } from "./actions";

/** Nashr holatini almashtirishdan oldin tasdiqlash oynasini ko‘rsatadi. */
export function ArticlePublicationButton({ id, title, action }: {
  id: string; title: string; action: "publish" | "unpublish";
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const publishing = action === "publish";
  const label = publishing ? "Qayta nashr qilish" : "Qoralamaga qaytarish";
  const Icon = publishing ? Send : RotateCcw;
  const success = publishing ? "Maqola qayta nashr qilindi" : "Maqola qoralamaga qaytarildi";
  const failure = publishing ? "Maqolani qayta nashr qilib bo‘lmadi" : "Maqolani qoralamaga qaytarib bo‘lmadi";

  /** Amal tugaguncha oynani ochiq tutadi va natijani bildirishnomada ko‘rsatadi. */
  function confirm() {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await runEditorialAction(id, action, "");
        if (!result.ok) {
          toast("error", failure, result.error);
          return;
        }
        setOpen(false);
        toast("success", success);
      } catch {
        toast("error", failure);
      }
    });
  }

  return (
    <>
      <Button type="button" variant={publishing ? "primary" : "secondary"} size="sm" disabled={pending} onClick={() => setOpen(true)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </Button>
      <ConfirmDialog
        title={publishing ? "Maqolani qayta nashr qilish" : "Maqolani qoralamaga qaytarish"}
        description={publishing
          ? `“${title}” Liderlar Online’da avvalgi manzili bilan qayta chiqadi.`
          : `“${title}” saytdagi nashrdan olinadi. Maqola matni qoralamada saqlanadi.`}
        confirmLabel={label}
        open={open}
        onClose={() => { if (!pending) setOpen(false); }}
        onConfirm={confirm}
        loading={pending}
        danger={!publishing}
      />
    </>
  );
}
