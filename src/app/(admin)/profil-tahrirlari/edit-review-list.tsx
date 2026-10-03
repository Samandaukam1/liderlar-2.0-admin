"use client";

import { formatTashkentDate } from "@/lib/tashkent-day";

import { useState, useTransition } from "react";
import { approveProfileEdit, rejectProfileEdit } from "./actions";
import type { PendingEditRow } from "@/lib/profile-editor/review-service";

/**
 * KO'RIK NAVBATI.
 *
 * Har bir yozuvda ESKI va YANGI qiymat yonma-yon ko'rsatiladi (§6, §22):
 * admin nima o'zgarganini ko'rmasa, tasdiqlash ma'noga ega bo'lmaydi —
 * u faqat "bir narsa o'zgardi" degan tugmani bosardi.
 */
export function EditReviewList({
  rows,
  canReview,
}: {
  rows: PendingEditRow[];
  canReview: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-card border border-line bg-surface px-4 py-10 text-center">
        <p className="text-sm font-bold text-ink">Tasdiq kutayotgan o‘zgarish yo‘q.</p>
        <p className="mt-1 text-xs text-ink-soft">
          Foydalanuvchilar yuborgan tekshiruvli o‘zgarishlar shu yerda paydo bo‘ladi.
        </p>
      </section>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <EditCard key={row.id} row={row} canReview={canReview} />
      ))}
    </ul>
  );
}

function EditCard({ row, canReview }: { row: PendingEditRow; canReview: boolean }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);

  function run(action: "approve" | "reject") {
    startTransition(async () => {
      setError(null);
      const result =
        action === "approve"
          ? await approveProfileEdit(row.id, note)
          : await rejectProfileEdit(row.id, note);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      /*
       * Muvaffaqiyatda holatni tozalamaymiz: sahifa server tomonda
       * yangilanadi va bu yozuv ro'yxatdan butunlay chiqib ketadi.
       */
      setMode(null);
    });
  }

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-ink">{row.candidateName}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {row.fieldLabel} · {row.submittedBy} yubordi ·{" "}
            {formatTashkentDate(row.createdAt)}
          </p>
        </div>

        {row.candidateSlug && (
          <a
            href={`/candidates?q=${encodeURIComponent(row.candidateSlug)}`}
            className="shrink-0 text-xs font-bold text-ink-soft underline"
          >
            Nomzodni ochish
          </a>
        )}
      </div>

      {/* ESKI -> YANGI. Yonma-yon, chunki solishtirish asosiy ish. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Value label="Hozirgi" value={row.beforeValue} muted />
        <Value label="Yangi" value={row.afterValue} />
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
                  ? "Masalan: sana hujjatga mos kelmadi"
                  : "Kerak bo‘lsa izoh yozing"
              }
              className="w-full rounded-md border border-line px-2 py-1.5 text-xs"
            />
          </label>

          {mode === "reject" && (
            <p className="mt-1 text-[11px] text-ink-soft">
              Sabab foydalanuvchiga ko‘rinadi — nima tuzatish kerakligini
              tushunarli yozing.
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

function Value({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string | null;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        muted ? "border-line bg-white" : "border-emerald-200 bg-emerald-50"
      }`}
    >
      <p className="text-[11px] text-ink-soft">{label}</p>
      {/*
        BO'SH QIYMAT "—" EMAS, "ko'rsatilmagan" deb yoziladi.
        "—" ni admin "chiziqcha yozilgan" deb o'qishi mumkin.
      */}
      <p className="mt-0.5 break-words text-sm font-bold text-ink">
        {value ?? <span className="font-normal italic text-ink-soft">ko‘rsatilmagan</span>}
      </p>
    </div>
  );
}
