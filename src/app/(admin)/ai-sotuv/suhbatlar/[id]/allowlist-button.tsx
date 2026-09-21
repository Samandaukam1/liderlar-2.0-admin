"use client";

import { useState, useTransition } from "react";
import { ListPlus, Check } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { addChatToAllowlistAction } from "@/lib/actions/sales";

/**
 * Suhbatni "tanlangan chatlar" ro'yxatiga qo'shadi.
 *
 * Avval chat id faqat shu sahifada ko'rinardi va uni
 * sozlamalardagi matn maydoniga QO'LDA ko'chirish kerak edi.
 * Bir raqamni ikki sahifa orasida ko'chirish — xato qilish
 * uchun ideal joy, va xato jimgina "bot javob bermaydi" ga
 * aylanardi.
 */
export function AllowlistButton({
  chatId,
  alreadyListed,
}: {
  chatId: number;
  alreadyListed: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(alreadyListed);

  if (added) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-badge border border-green/50 bg-green/15 px-3 py-1.5 text-xs font-bold text-[#2e7d44]">
        <Check className="h-3.5 w-3.5" aria-hidden />
        Ro&apos;yxatda
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await addChatToAllowlistAction(chatId);
          if (result.ok) {
            setAdded(true);
            toast("success", "Qo'shildi", result.message);
          } else {
            toast("error", "Qo'shilmadi", result.error);
          }
        })
      }
      className="inline-flex items-center gap-1.5 rounded-badge border border-border-soft px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:bg-ice disabled:opacity-40"
    >
      <ListPlus className="h-3.5 w-3.5" aria-hidden />
      {pending ? "Qo'shilmoqda…" : "Ro'yxatga qo'shish"}
    </button>
  );
}
