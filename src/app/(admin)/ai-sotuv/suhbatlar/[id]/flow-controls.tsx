"use client";

import { useState, useTransition } from "react";
import { Bot, CheckCircle2, UserCog } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { confirmPaymentAction, setHumanTakeoverAction } from "@/lib/actions/sales";

/**
 * Suhbat boshqaruvi: inson nazorati va to'lov tasdig'i.
 *
 * TO'LOVNI ODAM TASDIQLAYDI. AI skrinshotga qarab "to'landi" demaydi —
 * bu pul masalasi va qaror odamda qoladi.
 */
export function FlowControls({
  conversationId,
  aiEnabled,
  paymentStatus,
  hasEvidence,
}: {
  conversationId: string;
  aiEnabled: boolean;
  paymentStatus: string;
  hasEvidence: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [ai, setAi] = useState(aiEnabled);
  const [status, setStatus] = useState(paymentStatus);

  function toggleTakeover() {
    const formData = new FormData();
    formData.set("conversationId", conversationId);
    // `enabled` = inson qo'lga oladimi.
    formData.set("enabled", String(ai));
    startTransition(async () => {
      const result = await setHumanTakeoverAction(formData);
      if (result.ok) {
        setAi((prev) => !prev);
        toast("success", result.message ?? "Saqlandi");
      } else {
        toast("error", "Saqlanmadi", result.error);
      }
    });
  }

  function confirmPayment() {
    const formData = new FormData();
    formData.set("conversationId", conversationId);
    startTransition(async () => {
      const result = await confirmPaymentAction(formData);
      if (result.ok) {
        setStatus("paid");
        toast("success", result.message ?? "Tasdiqlandi");
      } else {
        toast("error", "Saqlanmadi", result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={ai ? "secondary" : "primary"}
        onClick={toggleTakeover}
        disabled={pending}
      >
        {ai ? (
          <>
            <UserCog className="h-3.5 w-3.5" /> Suhbatni qo‘lga olish
          </>
        ) : (
          <>
            <Bot className="h-3.5 w-3.5" /> AI’ni qayta yoqish
          </>
        )}
      </Button>

      {status !== "paid" ? (
        <Button
          size="sm"
          variant="success"
          onClick={confirmPayment}
          disabled={pending || !hasEvidence}
          title={hasEvidence ? undefined : "Avval chek kelishi kerak"}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Ha, to‘lov qildi
        </Button>
      ) : null}
    </div>
  );
}
