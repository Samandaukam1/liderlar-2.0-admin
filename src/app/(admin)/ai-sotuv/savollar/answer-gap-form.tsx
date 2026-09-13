"use client";

import { useTransition } from "react";
import { Button, Label, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { answerKnowledgeGapAction, ignoreKnowledgeGapAction } from "@/lib/actions/sales";

/**
 * Javobsiz savolga javob yozish.
 *
 * Javob YOZILGANDA u bilim bazasiga TASDIQLANGAN yozuv sifatida
 * tushadi — ya'ni retrieval uni darhol ishlata boshlaydi. Shuning
 * uchun bu forma `sales.manage` ruxsati bilan cheklangan.
 */
export function AnswerGapForm({ gapId }: { gapId: string }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function onAnswer(formData: FormData) {
    startTransition(async () => {
      const result = await answerKnowledgeGapAction(formData);
      if (result.ok) toast("success", "Qo‘shildi", result.message);
      else toast("error", "Saqlanmadi", result.error);
    });
  }

  function onIgnore() {
    startTransition(async () => {
      const data = new FormData();
      data.set("gapId", gapId);
      const result = await ignoreKnowledgeGapAction(data);
      if (result.ok) toast("success", "Yopildi", result.message);
      else toast("error", "Bajarilmadi", result.error);
    });
  }

  return (
    <form action={onAnswer} className="mt-3">
      <input type="hidden" name="gapId" value={gapId} />
      <Label htmlFor={`answer-${gapId}`}>Javob</Label>
      <Textarea
        id={`answer-${gapId}`}
        name="answer"
        rows={3}
        placeholder="Faqat tasdiqlangan ma’lumot yozing — bu matn mijozlarga javob berishda ishlatiladi."
      />
      <div className="mt-2 flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saqlanmoqda…" : "Bilim bazasiga qo‘shish"}
        </Button>
        <Button type="button" variant="ghost" onClick={onIgnore} disabled={pending}>
          E’tiborsiz qoldirish
        </Button>
      </div>
    </form>
  );
}
