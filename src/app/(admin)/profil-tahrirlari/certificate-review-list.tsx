"use client";

import { formatTashkentDate } from "@/lib/tashkent-day";

import { useState, useTransition } from "react";
import Image from "next/image";
import { setCertificateTrustAction } from "./actions";
/*
  ISH VAQTI QIYMATLARI SOF MODULDAN.

  `certificate-review-service.ts` da `server-only` bor — undan
  qiymat import qilish build'ni yiqitadi. Tip esa o'chib ketadi,
  shuning uchun `type` importi xavfsiz.
*/
import {
  TRUST_CHOICES,
  TRUST_LABEL,
  type TrustChoice,
} from "@/lib/profile-editor/certificate-trust";
import type { PendingCertificate } from "@/lib/profile-editor/certificate-review-service";

/**
 * SERTIFIKAT KO'RIGI.
 *
 * Admin UCH darajadan birini tanlaydi — "tasdiqlash/qaytarish" degan
 * ikkilik yetarli emas (§8). O'rtadagi daraja ("Foydalanuvchi
 * kiritgan") kerak, chunki ko'p sertifikatni mustaqil tekshirib
 * bo'lmaydi: tashkilot kichik, havola yo'q yoki arxiv yopiq. Bunday
 * holatda rad etish ham, tasdiqlash ham to'g'ri bo'lmaydi — da'voni
 * kim aytganini halol ko'rsatish to'g'ri.
 */
export function CertificateReviewList({
  rows,
  canReview,
}: {
  rows: PendingCertificate[];
  canReview: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-card border border-line bg-surface px-4 py-8 text-center">
        <p className="text-sm font-bold text-ink">Tasdiq kutayotgan sertifikat yo‘q.</p>
      </section>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <CertificateCard key={row.id} row={row} canReview={canReview} />
      ))}
    </ul>
  );
}

function CertificateCard({
  row,
  canReview,
}: {
  row: PendingCertificate;
  canReview: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<TrustChoice | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (!choice) return;
    startTransition(async () => {
      setError(null);
      const result = await setCertificateTrustAction(row.id, choice, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChoice(null);
    });
  }

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-ink">{row.candidateName}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            Sertifikat · {formatTashkentDate(row.createdAt)}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
          Tekshiruvda
        </span>
      </div>

      <div className="mt-3 rounded-md border border-line bg-white px-3 py-2">
        <p className="font-bold text-ink">{row.title}</p>
        {row.issuer && <p className="mt-0.5 text-xs text-ink-soft">{row.issuer}</p>}

        <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
          <Pair label="Berilgan" value={row.issuedOn} />
          <Pair label="Muddati" value={row.expiresOn} />
          <Pair label="Raqami" value={row.credentialNumber} />
        </dl>

        {row.credentialUrl && (
          /*
           * TEKSHIRISH HAVOLASI — adminning asosiy quroli.
           *
           * `noreferrer` panel manzilini uzatmasligi, `nofollow` esa
           * foydalanuvchi havolasiga SEO vazni bermasligi uchun.
           */
          <a
            href={row.credentialUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-2 block break-all text-xs font-bold text-ink underline"
          >
            Tekshirish havolasi: {row.credentialUrl}
          </a>
        )}

        {row.description && (
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">
            {row.description}
          </p>
        )}

        {row.evidence ? (
          canReview ? (
            /*
             * YOPIQ DALIL — server marshruti orqali.
             *
             * Marshrut ruxsatni tekshiradi, 60 soniyalik havola beradi va
             * ochishni jurnalga yozadi. Fayl manzili sahifada yo'q.
             */
            <a
              href={`/api/profile/certificate-evidence/${row.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-ink hover:border-brand/50"
            >
              Dalilni ochish · {row.evidence.label}
            </a>
          ) : (
            <p className="mt-2 text-xs text-ink-soft">
              Dalil yuklangan ({row.evidence.label}). Ochish uchun tasdiqlash ruxsati kerak.
            </p>
          )
        ) : row.evidenceUrl ? (
          <a
            href={row.evidenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block w-fit"
          >
            {/*
              `unoptimized` — admin panelda tashqi hostlar Next
              optimizatoriga ulanmagan va busiz sahifa butunlay
              yiqilardi ("hostname is not configured"). Panelning boshqa
              joylarida ham masofaviy rasm shunday ko'rsatiladi.
            */}
            <Image
              src={row.evidenceUrl}
              alt={`${row.title} dalili`}
              width={160}
              height={110}
              sizes="160px"
              loading="lazy"
              unoptimized
              className="rounded border border-line object-cover"
            />
            <span className="mt-1 block text-[11px] text-ink-soft">
              Dalilni kattalashtirish
            </span>
          </a>
        ) : (
          <p className="mt-2 text-xs text-ink-soft">Dalil fayli yuklanmagan.</p>
        )}

        {!row.credentialUrl && !row.credentialNumber && !row.evidenceUrl && !row.evidence && (
          /*
           * DALILSIZ DA'VO — ALOHIDA OGOHLANTIRILADI.
           *
           * Bunday sertifikatni "Tasdiqlangan" qilish platformaning
           * tasdig'ini tekshirmasdan berish bo'lardi.
           */
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
            Raqam, havola va dalil rasmi yo‘q — bu da‘voni mustaqil tekshirish
            imkoni yo‘q.
          </p>
        )}
      </div>

      {!canReview ? null : (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold text-ink">Qaror</p>
          <div className="flex flex-wrap gap-1.5">
            {TRUST_CHOICES.map((option) => (
              <button
                key={option}
                type="button"
                disabled={pending}
                onClick={() => {
                  setChoice(option);
                  setError(null);
                }}
                className={`rounded-md border px-2.5 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${
                  choice === option
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-white text-ink hover:bg-surface"
                }`}
              >
                {TRUST_LABEL[option]}
              </button>
            ))}
          </div>

          {choice && (
            <div className="mt-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-ink">
                  {choice === "rejected" ? (
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
                    choice === "rejected"
                      ? "Masalan: tashkilot bunday sertifikat bermaydi"
                      : "Kerak bo‘lsa izoh yozing"
                  }
                  className="w-full rounded-md border border-line px-2 py-1.5 text-xs"
                />
              </label>

              {choice === "rejected" && (
                <p className="mt-1 text-[11px] text-ink-soft">
                  Sabab foydalanuvchining muharririda ko‘rinadi.
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={run}
                  className="rounded-md bg-ink px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
                >
                  {pending ? "Saqlanmoqda…" : "Saqlash"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setChoice(null);
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

function Pair({ label, value }: { label: string; value: string | null }) {
  return (
    <span>
      <dt className="inline text-ink-soft">{label}: </dt>
      <dd className="inline font-bold text-ink">
        {value ?? <span className="font-normal italic text-ink-soft">yo‘q</span>}
      </dd>
    </span>
  );
}
