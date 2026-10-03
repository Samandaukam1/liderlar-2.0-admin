import { Card } from "@/components/ui/primitives";
import { formatTashkent } from "@/lib/tashkent-day";
import type { EditHistoryResult } from "@/lib/profile-editor/review-service";

/**
 * NOMZODNING PROFIL TAHRIRLARI (§6 revision history).
 *
 * Ko'rik talab qilgan maydonlar: kim yubordi, nima edi, nima bo'ldi va
 * kim qanday qaror qildi. Darhol nashr bo'ladigan maydonlar bu yerda
 * emas — ular audit jurnalida ("O'zgarishlar tarixi") turadi.
 *
 * Sana `formatTashkent` bilan: u locale ma'lumotiga bog'liq emas va
 * server qaysi zonada ishlashidan qat'i nazar Toshkent vaqtini beradi.
 */

const STATE_LABEL: Readonly<Record<string, string>> = {
  pending_review: "Tekshiruvda",
  applied: "Qo‘llangan",
  rejected: "Qaytarilgan",
};

const STATE_CLASS: Readonly<Record<string, string>> = {
  pending_review: "bg-amber/15 text-[#8a5a00]",
  applied: "bg-mint/15 text-[#14563f]",
  rejected: "bg-coral/10 text-[#a33232]",
};

export function EditHistoryPanel({ history, limit }: { history: EditHistoryResult; limit: number }) {
  return (
    <Card className="mb-4">
      <h3 className="mb-3 text-sm font-bold text-ink">Profil tahrirlari (ko‘rik navbati)</h3>

      {!history.ok ? (
        <p className="rounded-[12px] border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-ink">
          {history.error} Sahifani yangilang.
        </p>
      ) : history.rows.length === 0 ? (
        <p className="text-sm text-ink-soft">Ko‘rikka yuborilgan tahrirlar yo‘q.</p>
      ) : (
        <ol className="space-y-4">
          {history.rows.map((row) => (
            <li key={row.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                {row.fieldLabel}
                <span
                  className={`rounded-badge px-2 py-0.5 text-[11px] font-bold ${STATE_CLASS[row.state] ?? "bg-surface text-ink-soft"}`}
                >
                  {STATE_LABEL[row.state] ?? row.state}
                </span>
              </p>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-ink-soft">Oldingi qiymat</dt>
                  <dd className="whitespace-pre-wrap break-words">{row.beforeValue ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-soft">Yangi qiymat</dt>
                  <dd className="whitespace-pre-wrap break-words">{row.afterValue ?? "—"}</dd>
                </div>
              </dl>
              {row.reviewNote && <p className="mt-2 text-sm">Izoh: {row.reviewNote}</p>}
              <p className="mt-2 text-xs text-ink-soft">
                Yubordi: {row.submittedBy} · {formatTashkent(row.createdAt)}
                {row.reviewedAt && (
                  <>
                    {" "}
                    · Ko‘rdi: {row.reviewedBy ?? "—"} · {formatTashkent(row.reviewedAt)}
                  </>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}

      {history.ok && history.rows.length >= limit && (
        <p className="mt-3 text-xs text-ink-soft">Oxirgi {limit} ta tahrir ko‘rsatilgan.</p>
      )}
    </Card>
  );
}
