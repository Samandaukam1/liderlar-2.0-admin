"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { runGapCleanupAction, undoGapCleanupAction } from "@/lib/actions/sales";

/**
 * NAVBATNI TOZALASH — QAYTARILADIGAN (23- va 38-band).
 *
 * "O'chirish" tugmasi ATAYLAB yo'q. Yozuvlar arxivga o'tadi va
 * "Qaytarish" ularni navbatga qaytaradi: noto'g'ri tasniflangan
 * haqiqiy savol yo'qolib ketmasligi kerak.
 */
export function CleanupControls() {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await runGapCleanupAction();
      if (result.ok) toast("success", "Tozalandi", result.message);
      else toast("error", "Bajarilmadi", result.error);
    });
  }

  function undo() {
    startTransition(async () => {
      const result = await undoGapCleanupAction();
      if (result.ok) toast("success", "Qaytarildi", result.message);
      else toast("error", "Bajarilmadi", result.error);
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={run} disabled={pending}>
        {pending ? "Bajarilmoqda…" : "Navbatni tasniflash"}
      </Button>
      <Button type="button" variant="secondary" onClick={undo} disabled={pending}>
        Qaytarish
      </Button>
    </span>
  );
}
