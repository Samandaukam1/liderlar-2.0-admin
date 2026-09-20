"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, MessageSquareWarning, X } from "lucide-react";
import { Badge } from "@/components/admin/badges";
import {
  approveMehrActivityAction,
  reviewMehrActivityAction,
  type MehrActionResult,
} from "@/lib/actions/mehr";
import type { ReviewQueueItem } from "@/lib/mehr/dashboard";

const ROLE_LABEL: Record<string, string> = {
  participant: "ishtirokchi",
  co_organizer: "hamkor",
  organizer: "tashkilotchi",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "long", year: "numeric" })
    : "—";
}

export function ReviewQueue({
  items,
  canReview,
}: {
  items: ReviewQueueItem[];
  canReview: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Record<string, MehrActionResult>>({});
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonAction, setReasonAction] = useState<"reject" | "request_changes">("request_changes");

  function run(id: string, fn: () => Promise<MehrActionResult>) {
    startTransition(async () => {
      const result = await fn();
      setFeedback((prev) => ({ ...prev, [id]: result }));
      if (result.ok) {
        setReasonFor(null);
        setReason("");
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border-soft bg-paper p-8 text-center">
        <p className="text-sm font-semibold text-ink">Tekshiriladigan tadbir yo&apos;q</p>
        <p className="mt-1 text-xs text-ink-soft">
          Tashkilotchilar tadbir yuborganda ular shu yerda paydo bo&apos;ladi.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const result = feedback[item.id];
        const open = reasonFor === item.id;

        return (
          <li key={item.id} className="rounded-lg border border-border-soft bg-paper p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-ink">{item.title}</p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {item.organizerName}
                  {item.regionName ? ` · ${item.regionName}` : ""}
                  {item.categoryName ? ` · ${item.categoryName}` : ""}
                </p>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge accent="neutral">{item.participantCount} ishtirokchi</Badge>
                  <Badge accent={item.mediaCount > 0 ? "neutral" : "coral"}>
                    {item.mediaCount} dalil
                  </Badge>
                  {item.beneficiaryCount !== null && (
                    <Badge accent="neutral">{item.beneficiaryCount} nafar oldi</Badge>
                  )}
                  <Badge accent="neutral">{formatDate(item.startsAt)}</Badge>

                  {/*
                    QR DALILI.

                    Seans umuman ochilmagan bo'lsa, ishtirok
                    ro'yxati QR orqali emas, boshqa yo'l bilan
                    paydo bo'lgan — bu tekshirishga arziydigan
                    holat, xato emas.
                  */}
                  <Badge accent={item.hadSession ? "neutral" : "amber"}>
                    {item.hadSession ? `${item.checkinCount} QR qayd` : "QR ishlatilmagan"}
                  </Badge>

                  {item.requiresLocation && (
                    <Badge accent={item.locationVerifiedCount > 0 ? "neutral" : "amber"}>
                      {item.locationVerifiedCount} joyi tasdiqlangan
                    </Badge>
                  )}

                  {/*
                    TASHKILOTCHI TARIXI.

                    Avval rad etilganlar soni ko'rinib tursin —
                    takroriy soxta yuborish shundan bilinadi (§34).
                  */}
                  {item.organizerRejectedCount > 0 && (
                    <Badge accent="coral">
                      avval {item.organizerRejectedCount} marta rad etilgan
                    </Badge>
                  )}
                  {item.organizerApprovedCount > 0 && (
                    <Badge accent="green">{item.organizerApprovedCount} tasdiqlangan ishi bor</Badge>
                  )}
                </div>

                {/*
                  TASDIQLANSA NIMA BO'LADI.

                  Admin ball tarqalishini BOSISHDAN OLDIN
                  ko'rishi kerak — tasdiq qaytarib bo'lmaydigan
                  amal: ball daftarga tushadi va sertifikat
                  beriladi.
                */}
                {item.proposedPoints > 0 && (
                  <p className="mt-2 text-xs text-ink-soft">
                    Tasdiqlansa: <strong className="text-ink">{item.proposedPoints} ball</strong>
                    {" — "}
                    {item.proposedBreakdown
                      .map((b) => `${b.count}×${ROLE_LABEL[b.role] ?? b.role} (${b.points})`)
                      .join(", ")}
                  </p>
                )}

                {item.riskFlags.length > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[#c43d3d]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Ko&apos;rib chiqish belgisi: {item.riskFlags.join(", ")}
                  </p>
                )}
              </div>

              {canReview && (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(item.id, () => approveMehrActivityAction(item.id))}
                    className="inline-flex items-center gap-1.5 rounded-badge border border-green/50 bg-green/15 px-3 py-1.5 text-xs font-bold text-[#2e7d44] transition hover:bg-green/25 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Tasdiqlash
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setReasonFor(open ? null : item.id);
                      setReasonAction("request_changes");
                      setReason("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-badge border border-border-soft px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:bg-ice disabled:opacity-50"
                  >
                    <MessageSquareWarning className="h-3.5 w-3.5" />
                    Tuzatish / rad
                  </button>
                </div>
              )}
            </div>

            {open && (
              <div className="mt-3 rounded-lg border border-border-soft bg-ice/50 p-3">
                <div className="mb-2 flex gap-2">
                  {(["request_changes", "reject"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setReasonAction(a)}
                      className={`rounded-badge border px-2.5 py-1 text-[11px] font-bold transition ${
                        reasonAction === a
                          ? "border-brand bg-brand/15 text-brand"
                          : "border-border-soft text-ink-soft hover:bg-paper"
                      }`}
                    >
                      {a === "request_changes" ? "Tuzatish so'rash" : "Rad etish"}
                    </button>
                  ))}
                </div>

                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Sabab — tashkilotchi aynan nimani tuzatishini bilishi kerak."
                  className="w-full rounded-lg border border-border-soft bg-paper p-2 text-sm text-ink placeholder:text-ink-soft/60 focus:border-brand focus:outline-none"
                />

                {/*
                  SABAB MAJBURIY. "Rad etildi" deb sababsiz
                  yuborish odamni nima qilishini bilmay qoldiradi.
                */}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-ink-soft">
                    {reason.trim().length < 5 ? "Kamida 5 belgi" : " "}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setReasonFor(null)}
                      className="rounded-badge border border-border-soft px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:bg-paper"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={pending || reason.trim().length < 5}
                      onClick={() =>
                        run(item.id, () =>
                          reviewMehrActivityAction({
                            activityId: item.id,
                            action: reasonAction,
                            reason,
                          }),
                        )
                      }
                      className="rounded-badge border border-coral/50 bg-coral/15 px-3 py-1.5 text-xs font-bold text-[#c43d3d] transition hover:bg-coral/25 disabled:opacity-40"
                    >
                      Yuborish
                    </button>
                  </div>
                </div>
              </div>
            )}

            {result && (
              <p
                className={`mt-2 text-xs font-semibold ${
                  result.ok ? "text-[#2e7d44]" : "text-[#c43d3d]"
                }`}
              >
                {result.ok ? result.message : result.error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
