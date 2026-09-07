"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Pencil, X, ExternalLink } from "lucide-react";
import { Badge } from "@/components/admin/badges";
import { Button, Select, Textarea, Input, Label } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { reviewKnowledgeAction, updateKnowledgeAction } from "@/lib/actions/sales";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_STATUS_LABELS,
  type KnowledgeCategory,
  type KnowledgeStatus,
} from "@/lib/sales/types";

export interface KnowledgeItemProps {
  id: string;
  category: KnowledgeCategory;
  question: string | null;
  answer: string;
  status: KnowledgeStatus;
  confidence: number;
  tags: string[];
  sourceConversationId: string;
  createdAt: string;
  canManage: boolean;
}

const STATUS_ACCENT: Record<KnowledgeStatus, "peach" | "mint" | "coral"> = {
  draft: "peach",
  approved: "mint",
  rejected: "coral",
};

/**
 * Bitta bilim yozuvi: ko'rish, tahrirlash, tasdiqlash/rad etish.
 *
 * Har kartada manba suhbatga havola bor — izlanuvchanlik talabi shuni
 * aytadi: bilim qayerdan kelganini bir bosishda tekshirib bo'lishi kerak.
 */
export function KnowledgeItem(props: KnowledgeItemProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<KnowledgeStatus>(props.status);

  function review(next: KnowledgeStatus) {
    const formData = new FormData();
    formData.set("id", props.id);
    formData.set("status", next);
    startTransition(async () => {
      const result = await reviewKnowledgeAction(formData);
      if (result.ok) {
        setStatus(next);
        toast("success", `Holat: ${KNOWLEDGE_STATUS_LABELS[next]}`);
      } else {
        toast("error", "Saqlanmadi", result.error);
      }
    });
  }

  function save(formData: FormData) {
    formData.set("id", props.id);
    startTransition(async () => {
      const result = await updateKnowledgeAction(formData);
      if (result.ok) {
        setEditing(false);
        toast("success", "Saqlandi");
      } else {
        toast("error", "Saqlanmadi", result.error);
      }
    });
  }

  return (
    <article className="rounded-card border border-line bg-card p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge accent="lavender">{KNOWLEDGE_CATEGORY_LABELS[props.category]}</Badge>
        <Badge accent={STATUS_ACCENT[status]}>{KNOWLEDGE_STATUS_LABELS[status]}</Badge>
        <span className="text-xs text-ink-soft">
          Ishonch: {Math.round(props.confidence * 100)}%
        </span>
        <Link
          href={`/ai-sotuv/suhbatlar/${props.sourceConversationId}`}
          className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
        >
          Manba suhbat <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {editing ? (
        <form action={save} className="space-y-3">
          <div>
            <Label htmlFor={`category-${props.id}`}>Turkum</Label>
            <Select id={`category-${props.id}`} name="category" defaultValue={props.category}>
              {KNOWLEDGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {KNOWLEDGE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`question-${props.id}`}>Savol (ixtiyoriy)</Label>
            <Input
              id={`question-${props.id}`}
              name="question"
              defaultValue={props.question ?? ""}
              maxLength={500}
            />
          </div>
          <div>
            <Label htmlFor={`answer-${props.id}`}>Javob</Label>
            <Textarea
              id={`answer-${props.id}`}
              name="answer"
              defaultValue={props.answer}
              rows={5}
              maxLength={2000}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Saqlash
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Bekor qilish
            </Button>
          </div>
        </form>
      ) : (
        <>
          {props.question ? (
            <p className="mb-1.5 text-sm font-bold text-ink">{props.question}</p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm text-ink-soft">{props.answer}</p>

          {props.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {props.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-badge bg-surface px-2 py-0.5 text-[11px] text-ink-soft"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          {props.canManage ? (
            <div className="mt-4 flex flex-wrap gap-2">
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
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Tahrirlash
              </Button>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
