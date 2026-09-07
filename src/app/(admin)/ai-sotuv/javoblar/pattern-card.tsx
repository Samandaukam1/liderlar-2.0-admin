"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/admin/badges";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { reviewResponsePatternAction } from "@/lib/actions/sales";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatus } from "@/lib/sales/types";

export interface PatternCardProps {
  id: string;
  label: string;
  responseExample: string;
  frequency: number;
  successCount: number;
  unknownCount: number;
  successRate: number | null;
  status: KnowledgeStatus;
  conversationIds: string[];
  canManage: boolean;
  /** Variantning shu niyat ichidagi harfi: A, B, C… */
  variant: string;
}

const STATUS_ACCENT: Record<KnowledgeStatus, "peach" | "mint" | "coral"> = {
  draft: "peach",
  approved: "mint",
  rejected: "coral",
};

/**
 * Bitta javob varianti.
 *
 * `successRate === null` — barcha natija noma'lum. Bu holda "0%"
 * KO'RSATILMAYDI: nol "bu javob ishlamadi" degani, noma'lum esa
 * "hali bilmaymiz" degani va ikkisini aralashtirish reytingni buzardi.
 */
export function PatternCard(props: PatternCardProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<KnowledgeStatus>(props.status);

  function review(next: KnowledgeStatus) {
    const formData = new FormData();
    formData.set("id", props.id);
    formData.set("status", next);
    startTransition(async () => {
      const result = await reviewResponsePatternAction(formData);
      if (result.ok) {
        setStatus(next);
        toast("success", `Holat: ${KNOWLEDGE_STATUS_LABELS[next]}`);
      } else {
        toast("error", "Saqlanmadi", result.error);
      }
    });
  }

  return (
    <article className="rounded-[12px] border border-line bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-badge bg-brand/12 px-2 py-0.5 text-[11px] font-bold text-brand">
          Variant {props.variant}
        </span>
        <Badge accent={STATUS_ACCENT[status]}>{KNOWLEDGE_STATUS_LABELS[status]}</Badge>
        <span className="text-xs font-semibold text-ink-soft">{props.frequency} marta</span>
        <span className="text-xs text-ink-soft">
          {props.successRate == null ? (
            "natija noma’lum"
          ) : (
            <>
              {props.successCount} ta muvaffaqiyat · {props.successRate.toFixed(1)}%
            </>
          )}
          {props.unknownCount > 0 && props.successRate != null
            ? ` · ${props.unknownCount} ta noma’lum`
            : null}
        </span>
      </div>

      <p className="whitespace-pre-wrap text-sm text-ink">{props.responseExample}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Manba suhbatlarga bosib kirish — talab 10. */}
        {props.conversationIds.slice(0, 5).map((id, i) => (
          <Link
            key={id}
            href={`/ai-sotuv/suhbatlar/${id}`}
            className="inline-flex items-center gap-1 rounded-badge border border-line bg-card px-2 py-0.5 text-[11px] font-semibold text-brand hover:underline"
          >
            Manba {i + 1} <ExternalLink className="h-3 w-3" />
          </Link>
        ))}
        {props.conversationIds.length > 5 ? (
          <span className="text-[11px] text-ink-soft">
            +{props.conversationIds.length - 5} ta suhbat
          </span>
        ) : null}

        {props.canManage ? (
          <span className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="success"
              onClick={() => review("approved")}
              disabled={pending || status === "approved"}
            >
              <Check className="h-3.5 w-3.5" /> Tasdiqlash
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => review("rejected")}
              disabled={pending || status === "rejected"}
            >
              <X className="h-3.5 w-3.5" /> Rad etish
            </Button>
          </span>
        ) : null}
      </div>
    </article>
  );
}
