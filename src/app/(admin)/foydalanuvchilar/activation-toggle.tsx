"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power } from "lucide-react";
import { setMehrFlagAction } from "@/lib/actions/mehr";

/**
 * Faollashtirish kalitini AYNAN SHU YERDA ko'rsatamiz.
 *
 * Bayroq `/mehr` sozlamalarida ham bor, lekin admin muammoga
 * aynan shu sahifada duch keladi: "havola yaratib bo'lmaydi"
 * deb yozilgan-u, kalit boshqa bo'limda turgan bo'lsa, uni
 * izlab yurish kerak bo'lardi.
 */
export function ActivationToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setMehrFlagAction({
              key: "member.account_activation_enabled",
              enabled: !enabled,
            });
            if (!result.ok) setError(result.error);
            else router.refresh();
          })
        }
        className={`inline-flex items-center gap-1.5 rounded-badge border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
          enabled
            ? "border-border-soft text-ink-soft hover:bg-ice"
            : "border-green/50 bg-green/15 text-[#2e7d44] hover:bg-green/25"
        }`}
      >
        <Power className="h-3.5 w-3.5" aria-hidden />
        {pending
          ? "Saqlanmoqda…"
          : enabled
            ? "Faollashtirishni o'chirish"
            : "Faollashtirishni yoqish"}
      </button>

      {error && <p className="mt-2 text-xs font-semibold text-[#c43d3d]">{error}</p>}
    </div>
  );
}
