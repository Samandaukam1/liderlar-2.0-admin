"use client";

import { useTransition } from "react";
import { Button, Label, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { resolveEscalationAction } from "@/lib/actions/sales";

/**
 * Topshiriqni yopish.
 *
 * "Bilim bazasiga qo'shish" tugmasi ATAYLAB YO'Q (8-band):
 * bu javob aynan shu mijozga tegishli va global bilimga
 * aylansa, keyingi mijoz ham xuddi shu javobni olardi.
 */
export function ResolveForm({ escalationId }: { escalationId: string }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function onResolve(formData: FormData) {
    startTransition(async () => {
      const result = await resolveEscalationAction(formData);
      if (result.ok) toast("success", "Yopildi", result.message);
      else toast("error", "Bajarilmadi", result.error);
    });
  }

  function onDismiss() {
    startTransition(async () => {
      const data = new FormData();
      data.set("escalationId", escalationId);
      data.set("dismiss", "1");
      const result = await resolveEscalationAction(data);
      if (result.ok) toast("success", "Yopildi", result.message);
      else toast("error", "Bajarilmadi", result.error);
    });
  }

  return (
    <form action={onResolve} className="mt-3">
      <input type="hidden" name="escalationId" value={escalationId} />
      <Label htmlFor={`res-${escalationId}`}>Nima qilindi (ixtiyoriy)</Label>
      <Textarea
        id={`res-${escalationId}`}
        name="resolution"
        rows={2}
        placeholder="Masalan: to‘lov tekshirildi, tasdiqlandi."
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saqlanmoqda…" : "Hal qilindi"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDismiss} disabled={pending}>
          Kerak emas
        </Button>
      </div>
    </form>
  );
}
