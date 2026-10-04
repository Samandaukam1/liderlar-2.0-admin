"use client";

import { useState, useTransition } from "react";
import { formatTashkentDate } from "@/lib/tashkent-day";
import { approveSectionAction, rejectSectionAction } from "./actions";
import type { PendingSection } from "@/lib/profile-editor/section-review-service";

/**
 * BIOGRAFIYA BO'LIMLARI NAVBATI.
 *
 * Boshqa navbatlardan farqi: ko'rilayotgan narsa UZUN MATN. Shuning
 * uchun matn to'liq ko'rsatiladi (yig'ilgan holda, ochiladigan) —
 * admin tasdiqlashdan oldin ensiklopediyaga nima tushayotganini
 * oxirigacha o'qishi kerak.
 */
export function SectionReviewList({
  rows,
  canReview,
}: {
  rows: PendingSection[];
  canReview: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-card border border-line bg-surface px-4 py-8 text-center">
        <p className="text-sm font-bold text-ink">Tasdiq kutayotgan biografiya matni yo‘q.</p>
        <p className="mt-1 text-xs text-ink-soft">
          A‘zolar profil muharririda yozgan biografiya bo‘limlari shu yerda
          paydo bo‘ladi.
        </p>
      </section>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <SectionCard key={row.id} row={row} canReview={canReview} />
      ))}
    </ul>
  );
}

function SectionCard({ row, canReview }: { row: PendingSection; canReview: boolean }) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  /*
   * MATN YIG'ILGAN HOLDA BOSHLANADI.
   *
   * Bo'lim 50 000 belgigacha bo'lishi mumkin: navbatdagi o'nta
   * yozuvni to'liq chizish sahifani boshqarib bo'lmas qilardi.
   * Qisqa matn esa darhol to'liq ko'rinadi.
   */
  const long = row.content.length > 700;
  const [expanded, setExpanded] = useState(!long);

  function run(action: "approve" | "reject") {
    startTransition(async () => {
      setError(null);
      const result =
        action === "approve"
          ? await approveSectionAction(row.id, note)
          : await rejectSectionAction(row.id, note);

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
            Biografiya matni · {formatTashkentDate(row.createdAt)}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
          Tekshiruvda
        </span>
      </div>

      <div className="mt-3 rounded-md border border-line bg-white px-3 py-2">
        <p className="font-bold text-ink">{row.title || "(sarlavhasiz)"}</p>

        {row.content && (
          <p
            className={`mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink${
              expanded ? "" : " line-clamp-6"
            }`}
          >
            {row.content}
          </p>
        )}

        <p className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
          <span>{row.content.length.toLocaleString("uz-UZ")} belgi</span>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="font-bold text-ink underline"
            >
              {expanded ? "Yig‘ish" : "To‘liq o‘qish"}
            </button>
          )}
        </p>
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
                  ? "Masalan: tasdiqlanmagan da‘vo bor"
                  : "Kerak bo‘lsa izoh yozing"
              }
              className="w-full rounded-md border border-line px-2 py-1.5 text-xs"
            />
          </label>

          {mode === "reject" && (
            <p className="mt-1 text-[11px] text-ink-soft">
              Sabab a‘zoning muharririda ko‘rinadi — nima tuzatish kerakligini
              tushunarli yozing. Matn o‘chirilmaydi.
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
              {pending ? "Bajarilmoqda…" : mode === "approve" ? "Tasdiqlash" : "Qaytarish"}
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
