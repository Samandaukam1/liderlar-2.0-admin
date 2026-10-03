"use client";

import { formatTashkentDate } from "@/lib/tashkent-day";

import { useState, useTransition } from "react";
import { runVipAction, setFeatureFlag } from "./actions";
import type { AdminAction } from "@/lib/vip/subscription-rules";

export interface VipRow {
  id: string;
  profileId: string;
  fullName: string;
  username: string | null;
  planCode: string;
  state:
    | "pending"
    | "active"
    | "grace_period"
    | "expired"
    | "cancelled"
    | "suspended";
  startedAt: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  /** Hozir huquq beryaptimi (serverda hisoblangan). */
  granting: boolean;
  /** Holat hali `active`, lekin sana o'tgan — fon vazifasi kechikkan. */
  stale: boolean;
}

export interface FlagRow {
  key: string;
  enabled: boolean;
  description: string | null;
}

const STATE_LABEL: Record<VipRow["state"], string> = {
  pending: "To‘lov kutilyapti",
  active: "Faol",
  grace_period: "Imtiyoz muddatida",
  expired: "Tugagan",
  cancelled: "Bekor qilingan",
  suspended: "To‘xtatilgan",
};

const STATE_CLASS: Record<VipRow["state"], string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  grace_period: "bg-sky-50 text-sky-800 border-sky-200",
  expired: "bg-surface text-ink-soft border-line",
  cancelled: "bg-surface text-ink-soft border-line",
  suspended: "bg-rose-50 text-rose-800 border-rose-200",
};

/**
 * Qaysi amal qaysi holatda ko'rsatiladi.
 *
 * `subscription-rules.ts` dagi `ALLOWED_FROM` bilan bir xil. Takror
 * ataylab: u modul server tomonida va uni mijoz komponentiga import
 * qilish `server-only` chegarasini buzmaydi, lekin ro'yxatni eksport
 * qilish kerak bo'lardi. Muhimi — bu yerdagi ro'yxat FAQAT tugmani
 * ko'rsatish uchun; haqiqiy rad etish serverda bo'ladi va u
 * tushunarli matn qaytaradi.
 */
const ACTIONS: Record<AdminAction, { label: string; from: VipRow["state"][] }> = {
  activate: { label: "Faollashtirish", from: ["pending", "suspended"] },
  extend: { label: "Uzaytirish", from: ["active", "grace_period"] },
  suspend: { label: "To‘xtatish", from: ["active", "grace_period", "pending"] },
  cancel: { label: "Bekor qilish", from: ["pending", "active", "grace_period", "suspended"] },
  restore: { label: "Tiklash", from: ["suspended", "cancelled", "expired"] },
};

const formatDate = formatTashkentDate;

export function VipManager({
  rows,
  flags,
  canManage,
  canManageFlags,
}: {
  rows: VipRow[];
  flags: FlagRow[];
  canManage: boolean;
  canManageFlags: boolean;
}) {
  return (
    <div className="space-y-6">
      <FlagPanel flags={flags} canManage={canManageFlags} />
      <SubscriptionTable rows={rows} canManage={canManage} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * FLAGLAR
 * ------------------------------------------------------------------ */

function FlagPanel({ flags, canManage }: { flags: FlagRow[]; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="mb-1 text-sm font-bold text-ink">Chiqarish flaglari</h2>
      <p className="mb-3 text-xs leading-relaxed text-ink-soft">
        Flaglar <b>server tomonda</b> majburlanadi. <code>vip.enabled</code>{" "}
        o‘chirilsa, qolgan flaglar yoniq bo‘lsa ham hech bir VIP huquqi
        ishlamaydi.
        {!canManage && " Flaglarni o‘zgartirish uchun sozlamalar ruxsati kerak."}
      </p>

      {error && <p className="mb-2 text-xs font-bold text-rose-600">{error}</p>}

      <ul className="grid gap-2 sm:grid-cols-2">
        {flags.map((flag) => (
          <li
            key={flag.key}
            className="flex items-start justify-between gap-3 rounded-md border border-line bg-white px-3 py-2"
          >
            <span className="min-w-0">
              <code className="block text-xs font-bold text-ink">{flag.key}</code>
              {flag.description && (
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">
                  {flag.description}
                </span>
              )}
            </span>

            <button
              type="button"
              disabled={!canManage || pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await setFeatureFlag(flag.key, !flag.enabled);
                  if (!result.ok) setError(result.error ?? "Saqlanmadi.");
                })
              }
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-50 ${
                flag.enabled
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-line bg-surface text-ink-soft"
              }`}
            >
              {flag.enabled ? "Yoniq" : "O‘chiq"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * OBUNALAR
 * ------------------------------------------------------------------ */

function SubscriptionTable({ rows, canManage }: { rows: VipRow[]; canManage: boolean }) {
  if (rows.length === 0) {
    return (
      <section className="rounded-card border border-line bg-surface px-4 py-10 text-center">
        <p className="text-sm font-bold text-ink">Hali VIP obuna yo‘q.</p>
        <p className="mt-1 text-xs text-ink-soft">
          Obuna foydalanuvchi sahifasidan yaratiladi va to‘lov tasdiqlangandan
          so‘ng faollashtiriladi.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="border-b border-line text-ink-soft">
          <tr>
            <th className="px-3 py-2 font-bold">Foydalanuvchi</th>
            <th className="px-3 py-2 font-bold">Tarif</th>
            <th className="px-3 py-2 font-bold">Holat</th>
            <th className="px-3 py-2 font-bold">Tugashi</th>
            <th className="px-3 py-2 font-bold">Huquq</th>
            <th className="px-3 py-2 font-bold">Amal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SubscriptionRow key={row.id} row={row} canManage={canManage} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SubscriptionRow({ row, canManage }: { row: VipRow; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<AdminAction | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("30");
  const [error, setError] = useState<string | null>(null);

  const available = (Object.keys(ACTIONS) as AdminAction[]).filter((action) =>
    ACTIONS[action].from.includes(row.state),
  );

  function submit(action: AdminAction) {
    startTransition(async () => {
      setError(null);
      const result = await runVipAction({
        action,
        profileId: row.profileId,
        reason,
        days: action === "extend" ? Number(days) : undefined,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Muvaffaqiyat: forma yopiladi, sahifa server tomonda yangilanadi.
      setOpen(null);
      setReason("");
    });
  }

  return (
    <>
      <tr className="border-b border-line/60 align-top">
        <td className="px-3 py-2">
          <span className="block font-bold text-ink">{row.fullName}</span>
          {row.username && (
            <span className="block text-[11px] text-ink-soft">@{row.username}</span>
          )}
        </td>

        <td className="px-3 py-2 text-ink-soft">{row.planCode}</td>

        <td className="px-3 py-2">
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATE_CLASS[row.state]}`}
          >
            {STATE_LABEL[row.state]}
          </span>
          {row.stale && (
            /*
             * Fon vazifasi kechikkani: holat hali `active`, sana o'tgan.
             * Huquq allaqachon berilmayapti — admin buni ko'rishi kerak.
             */
            <span className="mt-1 block text-[11px] font-bold text-amber-700">
              Sana o‘tgan — huquq berilmayapti
            </span>
          )}
        </td>

        <td className="px-3 py-2 text-ink-soft">
          {formatDate(row.currentPeriodEnd)}
          {row.graceUntil && (
            <span className="block text-[11px]">
              imtiyoz: {formatDate(row.graceUntil)}
            </span>
          )}
        </td>

        <td className="px-3 py-2">
          <span
            className={`text-[11px] font-bold ${row.granting ? "text-emerald-700" : "text-ink-soft"}`}
          >
            {row.granting ? "Beryapti" : "Bermayapti"}
          </span>
        </td>

        <td className="px-3 py-2">
          {!canManage ? (
            <span className="text-[11px] text-ink-soft">—</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {available.map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setOpen(open === action ? null : action);
                    setError(null);
                  }}
                  className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-bold text-ink transition hover:bg-surface disabled:opacity-50"
                >
                  {ACTIONS[action].label}
                </button>
              ))}
            </span>
          )}
        </td>
      </tr>

      {open && canManage && (
        <tr className="border-b border-line/60 bg-white">
          <td colSpan={6} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-2">
              {open === "extend" && (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold text-ink">
                    Necha kun
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className="w-24 rounded-md border border-line px-2 py-1.5 text-xs"
                  />
                </label>
              )}

              <label className="block min-w-[240px] flex-1">
                <span className="mb-1 block text-[11px] font-bold text-ink">
                  Sabab <span className="text-rose-600">*</span>
                </span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Masalan: to‘lov tasdiqlandi"
                  className="w-full rounded-md border border-line px-2 py-1.5 text-xs"
                />
              </label>

              <button
                type="button"
                disabled={pending}
                onClick={() => submit(open)}
                className="rounded-md bg-ink px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
              >
                {pending ? "Bajarilmoqda…" : ACTIONS[open].label}
              </button>

              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(null);
                  setError(null);
                }}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-bold text-ink-soft"
              >
                Bekor qilish
              </button>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
              Sabab <b>auditga yoziladi</b> va keyin o‘zgartirilmaydi. Amalni kim
              va qachon bajargani ham saqlanadi.
            </p>

            {error && (
              <p className="mt-2 text-xs font-bold text-rose-600">{error}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
