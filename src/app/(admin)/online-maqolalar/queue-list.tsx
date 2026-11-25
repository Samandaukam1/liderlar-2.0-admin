"use client";

import { formatTashkentDate } from "@/lib/tashkent-day";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Archive, Check, CircleX, Eye, MessageSquareText, PenLine, RotateCcw, Send } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/primitives";
import { runEditorialAction } from "./actions";
import { STATE_TEXT, editorCan, requiresNote, type EditorAction } from "@/lib/articles/state";
import type { QueueArticle } from "@/lib/articles/editorial-service";
import { cn } from "@/lib/utils";

const ACTIONS: Record<EditorAction, {
  label: string;
  Icon: typeof Eye;
  variant?: ButtonProps["variant"];
}> = {
  start_review: { label: "Ko‘rishni boshlash", Icon: Eye },
  request_changes: { label: "Tuzatishni so‘rash", Icon: MessageSquareText, variant: "warning" },
  approve: { label: "Tasdiqlash", Icon: Check, variant: "success" },
  publish: { label: "Nashr qilish", Icon: Send },
  reject: { label: "Rad etish", Icon: CircleX, variant: "danger" },
  archive: { label: "Arxivlash", Icon: Archive },
  unpublish: { label: "Nashrdan qaytarish", Icon: RotateCcw },
};

const ALL_ACTIONS: EditorAction[] = [
  "start_review",
  "approve",
  "publish",
  "request_changes",
  "reject",
  "archive",
];

/** Joriy sahifadagi maqolalar kartalarini yoki qidiruvning bo‘sh natijasini ko‘rsatadi. */
export function QueueList({
  rows,
  canReview,
  searching,
}: {
  rows: QueueArticle[];
  canReview: boolean;
  searching: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-card border border-line bg-surface px-4 py-10 text-center">
        <p className="text-sm font-bold text-ink">{searching ? "Qidiruv bo‘yicha maqola topilmadi." : "Navbatda maqola yo‘q."}</p>
        {!searching && (
          <p className="mt-1 text-xs text-ink-soft">A‘zolar yuborgan maqolalar shu yerda paydo bo‘ladi.</p>
        )}
      </section>
    );
  }

  return (
    <ul className="space-y-4">
      {rows.map((row) => (
        <ArticleCard key={row.id} row={row} canReview={canReview} />
      ))}
    </ul>
  );
}

/** Maqola matnini va uning joriy holatida ruxsat berilgan amallarni ko‘rsatadi. */
function ArticleCard({ row, canReview }: { row: QueueArticle; canReview: boolean }) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<EditorAction | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const available = ALL_ACTIONS.filter((candidate) => editorCan(candidate, row.state));
  const ActiveIcon = action ? ACTIONS[action].Icon : null;
  const activeVariant = action ? ACTIONS[action].variant : undefined;

  /** Tanlangan amalni yuboradi va xatoda kiritilgan izohni saqlab qoladi. */
  function run() {
    if (!action || pending) return;
    startTransition(async () => {
      setError(null);
      try {
        const result = await runEditorialAction(row.id, action, note);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setAction(null);
        setNote("");
      } catch {
        setError("Amalni bajarib bo‘lmadi. Qayta urinib ko‘ring.");
      }
    });
  }

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-ink">{row.title}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {row.candidateName}
            {row.submittedAt &&
              ` · ${formatTashkentDate(row.submittedAt)}`}
          </p>
          {canReview && (
            <Link href={`/online-maqolalar/${row.id}/edit`} prefetch={false} className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-brand hover:underline">
              <PenLine className="h-4 w-4" aria-hidden="true" />
              Tahrirlash
            </Link>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-bold text-ink">
          {STATE_TEXT[row.state]}
        </span>
      </div>

      {/*
        BANNER — NASHR SHARTI (§23, §24).

        Yo'qligi alohida ko'rsatiladi: bannersiz maqolani nashr
        qilishga urinish baza darajasida rad etiladi va muharrir
        buni oldindan bilishi kerak.
      */}
      {row.heroUrl ? (
        <span className="mt-3 block aspect-video w-full max-w-md overflow-hidden rounded-md border border-line">
          {/*
            `unoptimized` — admin panel tashqi hostlarni Next
            optimizatoriga ulamagan; busiz butun sahifa 500 bilan
            yiqilardi ("hostname is not configured"). Panelning
            boshqa sahifalari ham masofaviy rasmni shunday chiqaradi.
          */}
          <Image
            src={row.heroUrl}
            alt={row.heroAlt ?? ""}
            width={640}
            height={360}
            sizes="(max-width: 640px) 100vw, 448px"
            loading="lazy"
            unoptimized
            className="h-full w-full object-cover"
          />
        </span>
      ) : (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          Banner rasmi yo‘q — nashr qilib bo‘lmaydi.
        </p>
      )}

      {row.subtitle && <p className="mt-2 text-sm text-ink-soft">{row.subtitle}</p>}

      <div className="mt-3 rounded-md border border-line bg-white px-3 py-2">
        <div
          className={`whitespace-pre-wrap break-words text-xs leading-relaxed text-ink ${
            expanded ? "" : "line-clamp-6"
          }`}
        >
          {row.content}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 text-[11px] font-bold text-ink-soft underline"
        >
          {expanded ? "Yopish" : "To‘liq o‘qish"}
        </button>
      </div>

      {row.reviewNote && (
        <p className="mt-2 rounded border border-line bg-white px-2 py-1.5 text-[11px] text-ink-soft">
          Oldingi izoh: {row.reviewNote}
        </p>
      )}

      {canReview && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-1.5">
            {available.map((option) => {
              const { label, Icon, variant } = ACTIONS[option];
              return (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={variant ?? (action === option ? "primary" : "secondary")}
                  aria-pressed={action === option}
                  className={cn(
                    "aria-pressed:ring-2 aria-pressed:ring-brand aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface",
                    variant && "text-navy-deep!",
                  )}
                  disabled={pending}
                  onClick={() => {
                    setAction(option);
                    setError(null);
                  }}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                </Button>
              );
            })}
          </div>

          {action && (
            <div className="mt-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-ink">
                  {requiresNote(action) ? (
                    <>
                      Izoh <span className="text-rose-600">*</span> — muallif ko‘radi
                    </>
                  ) : (
                    "Izoh (ixtiyoriy, saqlanmaydi)"
                  )}
                </span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    requiresNote(action)
                      ? "Masalan: manbalarni ko‘rsating"
                      : ""
                  }
                  className="w-full rounded-md border border-line px-2 py-1.5 text-xs"
                />
              </label>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={activeVariant}
                  className={activeVariant ? "text-navy-deep!" : undefined}
                  disabled={pending}
                  onClick={run}
                >
                  {ActiveIcon && <ActiveIcon className="size-4 shrink-0" aria-hidden="true" />}
                  {pending ? "Bajarilmoqda…" : ACTIONS[action].label}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setAction(null);
                    setError(null);
                  }}
                >
                  Bekor qilish
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-xs font-bold text-rose-600">{error}</p>}
    </li>
  );
}
