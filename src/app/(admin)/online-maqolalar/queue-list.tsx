"use client";

import { formatTashkentDate } from "@/lib/tashkent-day";

import { useState, useTransition } from "react";
import Image from "next/image";
import { runEditorialAction } from "./actions";
import { STATE_TEXT, editorCan, requiresNote, type EditorAction } from "@/lib/articles/state";
import type { QueueArticle } from "@/lib/articles/editorial-service";

/**
 * TAHRIRIYAT NAVBATI.
 *
 * Maqola MAZMUNI to'liq ko'rsatiladi: muharrir nimani tasdiqlayotganini
 * ko'rmasa, tasdiqlash ma'noga ega bo'lmaydi.
 *
 * Amallar HOLATGA QARAB chiqadi — mavjud bo'lmagan amalni ko'rsatib,
 * keyin "mumkin emas" deb rad etish muharrirni chalg'itardi.
 */

const ACTION_LABEL: Record<EditorAction, string> = {
  start_review: "Ko'rishni boshlash",
  request_changes: "Tuzatish so'rash",
  approve: "Tasdiqlash",
  publish: "Nashr qilish",
  reject: "Rad etish",
  archive: "Arxivlash",
  unpublish: "Nashrdan qaytarish",
};

const ALL_ACTIONS: EditorAction[] = [
  "start_review",
  "approve",
  "publish",
  "request_changes",
  "reject",
  "archive",
];

export function QueueList({
  rows,
  canReview,
}: {
  rows: QueueArticle[];
  canReview: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-card border border-line bg-surface px-4 py-10 text-center">
        <p className="text-sm font-bold text-ink">Navbatda maqola yo‘q.</p>
        <p className="mt-1 text-xs text-ink-soft">
          A‘zolar yuborgan maqolalar shu yerda paydo bo‘ladi.
        </p>
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

function ArticleCard({ row, canReview }: { row: QueueArticle; canReview: boolean }) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<EditorAction | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const available = ALL_ACTIONS.filter((candidate) => editorCan(candidate, row.state));

  function run() {
    if (!action) return;
    startTransition(async () => {
      setError(null);
      const result = await runEditorialAction(row.id, action, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAction(null);
      setNote("");
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
            {available.map((option) => (
              <button
                key={option}
                type="button"
                disabled={pending}
                onClick={() => {
                  setAction(option);
                  setError(null);
                }}
                className={`rounded-md border px-2.5 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${
                  action === option
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-white text-ink hover:bg-surface"
                }`}
              >
                {ACTION_LABEL[option]}
              </button>
            ))}
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
                <button
                  type="button"
                  disabled={pending}
                  onClick={run}
                  className="rounded-md bg-ink px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {pending ? "Bajarilmoqda…" : ACTION_LABEL[action]}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setAction(null);
                    setError(null);
                  }}
                  className="rounded-md border border-line px-3 py-1.5 text-xs font-bold text-ink-soft"
                >
                  Bekor qilish
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs font-bold text-rose-600">{error}</p>}
    </li>
  );
}
