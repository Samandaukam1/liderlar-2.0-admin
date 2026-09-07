"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { runLearningAction } from "@/lib/actions/sales";

/**
 * Uslubni qayta hisoblash. AI chaqirilmaydi — o'lchov determinatsiyalangan,
 * shuning uchun bir xil ma'lumotda natija ham bir xil chiqadi.
 */
export function RecomputeStyleForm() {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    formData.set("kind", "style");
    startTransition(async () => {
      const result = await runLearningAction(formData);
      if (result.ok) toast("success", "Uslub qayta hisoblandi", result.message);
      else toast("error", "Hisoblanmadi", result.error);
    });
  }

  return (
    <form action={onSubmit}>
      <Button type="submit" variant="secondary" disabled={pending}>
        <RefreshCw className="h-4 w-4" />
        {pending ? "Hisoblanmoqda…" : "Uslubni qayta hisoblash"}
      </Button>
    </form>
  );
}
