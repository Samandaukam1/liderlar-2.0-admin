"use client";

import { formatTashkentDate } from "@/lib/tashkent-day";

import { useState, useTransition } from "react";
import { approveEntryAction, rejectEntryAction } from "./actions";
import type { PendingEntry } from "@/lib/profile-editor/entry-review-service";

/**
 * TUZILGAN YOZUVLAR NAVBATI.
 *
 * `candidates` ustunlari navbatidan farqi: bu yerda "eski -> yangi"
 * yo'q, chunki yozuv YANGI. Shuning uchun uning to'liq mazmuni
 * ko'rsatiladi — admin tasdiqlashdan oldin nimani nashr qilayotganini
 * ko'rishi kerak.
 */
export function EntryReviewList({
  rows,
  canReview,
}: {
  rows: PendingEntry[];
  canReview: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-card border border-line bg-surface px-4 py-8 text-center">
        <p className="text-sm font-bold text-ink">Tasdiq kutayotgan yozuv yo‘q.</p>
        <p className="mt-1 text-xs text-ink-soft">
          Foydalanuvchilar profil muharririda qo‘shgan ta‘lim, ish tajribasi va
          yutuqlar shu yerda paydo bo‘ladi.
        </p>
      </section>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <EntryCard key={`${row.kind}:${row.id}`} row={row} canReview={canReview} />
      ))}
    </ul>
  );
}

function EntryCard({ row, canReview }: { row: PendingEntry; canReview: boolean }) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(action: "approve" | "reject") {
    startTransition(async () => {
      setError(null);
      const result =
        action === "approve"
          ? await approveEntryAction(row.kind, row.id, note)
          : await rejectEntryAction(row.kind, row.id, note);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMode(null);
    });
  }

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-ink">{row.candidateName}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {row.kindLabel} · {formatTashkentDate(row.createdAt)}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
          Tekshiruvda
        </span>
      </div>

      {/* YOZUVNING TO'LIQ MAZMUNI — admin nimani nashr qilayotganini ko'rsin. */}
      <div className="mt-3 rounded-md border border-line bg-white px-3 py-2">
        <p className="font-bold text-ink">{row.title}</p>
        {row.subtitle && <p className="mt-0.5 text-xs text-ink-soft">{row.subtitle}</p>}

        {(row.dateFrom || row.dateTo) && (
          <p className="mt-1 text-xs text-ink-soft">
            {row.dateFrom ?? "?"} — {row.dateTo ?? "hozirgacha"}
          </p>
        )}

        {row.description && (
          <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">
            {row.description}
          </p>
        )}

        {row.url && (
          /*
           * HAVOLA YANGI OYNADA VA `noreferrer` BILAN.
           *
           * Bu foydalanuvchi yuborgan havola. `noreferrer` admin
           * panelining manzilini uzatmasligi uchun, `noopener` esa
           * ochilgan sahifa panel oynasiga tegmasligi uchun.
           */
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-1.5 block break-all text-xs font-bold text-ink-soft underline"
          >
            {row.url}
          </a>
        )}
      </div>

      {!canReview ? null : mode === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setMode("approve");
              setError(null);
            }}
            className="rounded-md bg-ink px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
          >
            Tasdiqlash
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setMode("reject");
              setError(null);
            }}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-white disabled:opacity-50"
          >
            Qaytarish
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-ink">
              {mode === "reject" ? (
                <>
                  Qaytarish sababi <span className="text-rose-600">*</span>
                </>
              ) : (
                "Izoh (ixtiyoriy)"
              )}
            </span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                mode === "reject"
                  ? "Masalan: tashkilot nomi tasdiqlanmadi"
                  : "Kerak bo‘lsa izoh yozing"
              }
              className="w-full rounded-md border border-line px-2 py-1.5 text-xs"
            />
          </label>

          {mode === "reject" && (
            <p className="mt-1 text-[11px] text-ink-soft">
              Sabab foydalanuvchining muharririda ko‘rinadi — nima tuzatish
              kerakligini tushunarli yozing. Yozuv o‘chirilmaydi.
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(mode)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50 ${
                mode === "approve" ? "bg-emerald-700" : "bg-rose-700"
              }`}
            >
              {pending
                ? "Bajarilmoqda…"
                : mode === "approve"
                  ? "Tasdiqlash"
                  : "Qaytarish"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setMode(null);
                setError(null);
              }}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-bold text-ink-soft"
            >
              Bekor qilish
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-bold text-rose-600">{error}</p>}
    </li>
  );
}
