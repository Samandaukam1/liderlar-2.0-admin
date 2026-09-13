"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { resolveKnowledgeConflictAction } from "@/lib/actions/sales";
import type { ConflictRow } from "@/lib/sales/mining/intelligence-repo";

/**
 * ZIDDIYATNI ODAM HAL QILADI (10-band).
 *
 * Tanlash MAJBURIY: tizim o'zi "qaysi biri to'g'ri" deb qaror
 * qila olmaydi — ikkalasi ham tasdiqlangan. Tanlanmaganigacha
 * IKKALASI ham mijozga aytilmaydi.
 */
export function ConflictResolver({
  conflicts,
  canManage,
}: {
  conflicts: ConflictRow[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Record<string, string>>({});

  const resolve = (conflictId: string) => {
    const winnerId = selected[conflictId];
    if (!winnerId) {
      toast("warning", "Tanlov kerak", "Qaysi javob to‘g‘ri ekanini belgilang.");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("conflictId", conflictId);
      formData.set("winnerId", winnerId);
      const result = await resolveKnowledgeConflictAction(formData);
      if (result.ok) toast("success", "Hal qilindi", result.message);
      else toast("error", "Xato", result.error);
    });
  };

  return (
    <ul className="space-y-3">
      {conflicts.map((conflict) => (
        <li key={conflict.id} className="rounded-card border border-coral/40 bg-card p-4">
          <p className="mb-1 text-sm font-bold text-ink">{conflict.topicLabel}</p>
          <p className="mb-3 text-xs text-ink-soft">{conflict.detectionReason}</p>

          <ul className="space-y-2">
            {conflict.members.map((member) => (
              <li key={member.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-card border border-line bg-surface p-2 text-xs">
                  <input
                    type="radio"
                    name={`conflict-${conflict.id}`}
                    className="mt-0.5"
                    disabled={!canManage || pending}
                    checked={selected[conflict.id] === member.id}
                    onChange={() =>
                      setSelected((prev) => ({ ...prev, [conflict.id]: member.id }))
                    }
                  />
                  <span>
                    <b className="text-ink">
                      {member.stance === "affirm" ? "TASDIQ" : "INKOR"}
                    </b>{" "}
                    <span className="text-ink-soft">{member.excerpt}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {canManage ? (
            <Button
              type="button"
              className="mt-3"
              disabled={pending}
              onClick={() => resolve(conflict.id)}
            >
              To‘g‘ri javobni tasdiqlash
            </Button>
          ) : (
            <p className="mt-3 text-xs text-ink-soft">
              Hal qilish uchun <b>sales.manage</b> ruxsati kerak.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
