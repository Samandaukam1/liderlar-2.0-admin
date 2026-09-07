"use client";

import { useState, useTransition } from "react";
import { GraduationCap } from "lucide-react";
import { Button, Select, Label } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { runLearningAction } from "@/lib/actions/sales";
import { LEARNING_JOB_KINDS, LEARNING_JOB_KIND_LABELS } from "@/lib/sales/types";

/**
 * O'rganishni qo'lda ishga tushirish.
 *
 * Qo'lda — ataylab: yugurish pullik AI chaqiruvlari qiladi va 0.1 da
 * uni kim, qachon boshlaganini admin bilib turishi kerak. Avtomatik
 * jadval (cron) 0.2 da qo'shiladi.
 */
export function RunLearningForm({ batchSize }: { batchSize: number }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<string>("both");
  const [limit, setLimit] = useState<string>(String(batchSize));

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await runLearningAction(formData);
      if (result.ok) toast("success", "O‘rganish yakunlandi", result.message);
      else toast("error", "O‘rganish amalga oshmadi", result.error);
    });
  }

  return (
    <form
      action={onSubmit}
      className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-card p-5 shadow-card"
    >
      <div className="min-w-[200px]">
        <Label htmlFor="kind">Nimani o‘rganish</Label>
        <Select
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {LEARNING_JOB_KINDS.map((k) => (
            <option key={k} value={k}>
              {LEARNING_JOB_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>

      <div className="min-w-[160px]">
        <Label htmlFor="limit">Suhbat soni</Label>
        <Select
          id="limit"
          name="limit"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        >
          {[5, 10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} ta
            </option>
          ))}
        </Select>
      </div>

      <Button type="submit" variant="ai" disabled={pending}>
        <GraduationCap className="h-4 w-4" />
        {pending ? "O‘rganilmoqda…" : "O‘rganishni boshlash"}
      </Button>

      <p className="w-full text-xs text-ink-soft">
        Faqat o‘rganilmagan (yoki o‘zgargan) suhbatlar olinadi. Uslub tahlili
        AI’siz, o‘lchov asosida hisoblanadi.
      </p>
    </form>
  );
}
