"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, CalendarPlus, PowerOff } from "lucide-react";
import { Badge } from "@/components/admin/badges";
import {
  disableVipAction,
  extendVipAction,
  grantVipAction,
  type VipAccountResult,
} from "@/lib/actions/vip-accounts";
import { VIP_STATUS_LABEL, type AccountVip } from "@/lib/accounts/account-types";
import { tashkentToday } from "@/lib/tashkent-day";

/*
 * Formadagi tayyor muddatlar. `admin-grant.ts` dagi `VIP_PRESET_DAYS`
 * bilan bir xil — u modul sana hisobini ham o'z ichiga oladi, mijozga
 * esa faqat shu raqamlar kerak.
 */
const PRESETS = [30, 90, 180, 365] as const;

const STATUS_ACCENT = {
  active: "green",
  expired: "amber",
  disabled: "coral",
  pending: "sky",
  none: "neutral",
} as const;

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("uz-UZ", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Tashkent",
      })
    : "—";
}

/**
 * Tugash sanasi ko'rsatilishi.
 *
 * Bazada tugash — "keyingi kun 00:00" (eksklyuziv chegara). Uni
 * shundayligicha ko'rsatsak, "10-noyabrgacha" berilgan VIP
 * "11-noyabr" bo'lib ko'rinardi. Bir lahza orqaga surib, oxirgi
 * FAOL kunni ko'rsatamiz.
 */
function formatLastDay(iso: string | null): string {
  if (!iso) return "muddatsiz";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? formatDay(new Date(d.getTime() - 1000).toISOString()) : "—";
}

type Mode = null | "grant" | "extend" | "disable";

export function VipControl({
  profileId,
  vip,
  canManage,
}: {
  profileId: string;
  vip: AccountVip | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(null);
  const [result, setResult] = useState<VipAccountResult | null>(null);

  const today = tashkentToday();
  const [startDate, setStartDate] = useState(today);
  const [preset, setPreset] = useState<number | "custom">(30);
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  if (!vip) {
    return <p className="text-xs text-[#c43d3d]">VIP holatini o‘qib bo‘lmadi — sahifani yangilang.</p>;
  }

  const active = vip.status === "active";

  function open(next: Mode) {
    setMode(next);
    setResult(null);
    setPreset(30);
    setEndDate("");
    setReason("");
    setStartDate(today);
  }

  function submit() {
    const term = preset === "custom" ? { days: null, endDate } : { days: preset, endDate: null };
    startTransition(async () => {
      const outcome =
        mode === "grant"
          ? await grantVipAction({ profileId, startDate, reason, ...term })
          : mode === "extend"
            ? await extendVipAction({ profileId, reason, ...term })
            : await disableVipAction({ profileId, reason });
      setResult(outcome);
      if (outcome.ok) {
        setMode(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-border-soft bg-ice/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Crown className="h-3.5 w-3.5 text-[#946a10]" aria-hidden />
        <Badge accent={STATUS_ACCENT[vip.status]}>{VIP_STATUS_LABEL[vip.status]}</Badge>

        {vip.status !== "none" && (
          <span className="text-xs text-ink-soft">
            Boshlangan: <strong className="text-ink">{formatDay(vip.startedAt)}</strong>
            {" · "}Tugash: <strong className="text-ink">{formatLastDay(vip.periodEnd)}</strong>
            {active && vip.daysLeft !== null && (
              <>
                {" · "}Qolgan: <strong className="text-ink">{vip.daysLeft} kun</strong>
              </>
            )}
          </span>
        )}

        {canManage && mode === null && (
          <div className="ml-auto flex flex-wrap gap-2">
            {active ? (
              <>
                <button
                  type="button"
                  onClick={() => open("extend")}
                  className="inline-flex items-center gap-1.5 rounded-badge border border-brand/50 bg-brand/10 px-3 py-1 text-xs font-bold text-brand transition hover:bg-brand/20"
                >
                  <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                  Uzaytirish
                </button>
                <button
                  type="button"
                  onClick={() => open("disable")}
                  className="inline-flex items-center gap-1.5 rounded-badge border border-coral/50 px-3 py-1 text-xs font-bold text-[#c43d3d] transition hover:bg-coral/10"
                >
                  <PowerOff className="h-3.5 w-3.5" aria-hidden />
                  VIPni o‘chirish
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => open("grant")}
                className="inline-flex items-center gap-1.5 rounded-badge border border-green/50 bg-green/15 px-3 py-1 text-xs font-bold text-[#2e7d44] transition hover:bg-green/25"
              >
                <Crown className="h-3.5 w-3.5" aria-hidden />
                VIP yoqish
              </button>
            )}
          </div>
        )}
      </div>

      {canManage && mode !== null && (
        <div className="mt-3 space-y-2 text-xs">
          {mode === "grant" && (
            <label className="flex items-center gap-2">
              <span className="w-28 text-ink-soft">Boshlanish sanasi</span>
              <input
                type="date"
                value={startDate}
                max={today}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 rounded-badge border border-border-soft bg-paper px-2 text-ink"
              />
            </label>
          )}

          {mode !== "disable" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28 text-ink-soft">{mode === "grant" ? "Muddat" : "Qo‘shiladi"}</span>
              {PRESETS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setPreset(days)}
                  className={`rounded-badge border px-2.5 py-1 font-bold ${
                    preset === days ? "border-brand bg-brand/15 text-brand" : "border-border-soft text-ink-soft"
                  }`}
                >
                  {days} kun
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreset("custom")}
                className={`rounded-badge border px-2.5 py-1 font-bold ${
                  preset === "custom" ? "border-brand bg-brand/15 text-brand" : "border-border-soft text-ink-soft"
                }`}
              >
                Aniq sana
              </button>
              {preset === "custom" && (
                <input
                  type="date"
                  value={endDate}
                  min={today}
                  onChange={(e) => setEndDate(e.target.value)}
                  aria-label="Tugash sanasi (shu kun oxirigacha)"
                  className="h-8 rounded-badge border border-border-soft bg-paper px-2 text-ink"
                />
              )}
            </div>
          )}

          {mode === "disable" && (
            <p className="text-ink-soft">
              Faqat VIP imkoniyatlari yopiladi. Profil, maqolalar, sertifikatlar, ball va tavsiya tarixi
              saqlanadi; akkaunt bloklanmaydi.
            </p>
          )}

          <label className="flex items-center gap-2">
            <span className="w-28 text-ink-soft">Izoh</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={mode === "disable" ? "Nega o‘chirilyapti" : "Masalan: to‘lov 03.10, Payme"}
              className="h-8 w-72 max-w-full rounded-badge border border-border-soft bg-paper px-2 text-ink"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length < 3 || (preset === "custom" && mode !== "disable" && !endDate)}
              onClick={submit}
              className={`rounded-badge border px-3 py-1.5 font-bold disabled:opacity-40 ${
                mode === "disable"
                  ? "border-coral/50 bg-coral/15 text-[#c43d3d]"
                  : "border-brand/50 bg-brand/15 text-brand"
              }`}
            >
              {mode === "grant" ? "VIPni yoqish" : mode === "extend" ? "Uzaytirish" : "VIPni o‘chirish"}
            </button>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-badge border border-border-soft px-3 py-1.5 text-ink-soft"
            >
              Bekor
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className={`mt-2 text-xs font-semibold ${result.ok ? "text-[#2e7d44]" : "text-[#c43d3d]"}`}>
          {result.ok ? result.message : result.error}
        </p>
      )}
    </div>
  );
}
