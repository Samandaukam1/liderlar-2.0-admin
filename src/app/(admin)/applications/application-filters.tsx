"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarClock, TicketSlash, X } from "lucide-react";
import { Input, Label } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * VAQT ORALIG'I VA "PROMO KODSIZLAR TEPADA".
 *
 * VAQT TOSHKENT BO'YICHA. Brauzerning `datetime-local` maydoni
 * zonasiz qiymat beradi va uni server zonasiz o'qiydi; agar
 * ikkovi har xil zonada bo'lsa, oyna besh soatga siljib ketardi
 * va buni hech kim sezmasdi — ro'yxat baribir to'lgan ko'rinadi.
 * Shuning uchun tayyor oraliqlar ham AYNAN Toshkent devor soati
 * bo'yicha hisoblanadi, brauzer qayerda bo'lishidan qat'i nazar.
 */

const TZ = "Asia/Tashkent";

/** Lahzani Toshkent devor soatidagi `YYYY-MM-DDTHH:mm` ga aylantiradi. */
function toTashkentInput(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

interface Preset {
  label: string;
  /** Boshlanish lahzasi. Tugash — "hozirgacha", ya'ni bo'sh. */
  from: () => Date;
}

const PRESETS: readonly Preset[] = [
  { label: "Oxirgi 6 soat", from: () => new Date(Date.now() - 6 * 3600_000) },
  { label: "Oxirgi 24 soat", from: () => new Date(Date.now() - 24 * 3600_000) },
  { label: "Oxirgi 3 kun", from: () => new Date(Date.now() - 3 * 24 * 3600_000) },
];

export function ApplicationFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const noPromoFirst = params.get("promo") === "kodsiz";

  function apply(changes: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    // Filtr o'zgarganda birinchi sahifaga qaytamiz: aks holda
    // admin bo'sh sahifani ko'rib "hech narsa yo'q" deb o'ylardi.
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  const hasRange = from !== "" || to !== "";

  return (
    <section className="mb-4 rounded-card border border-line bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[190px]">
          <Label htmlFor="from">
            <CalendarClock className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Vaqtdan
          </Label>
          <Input
            id="from"
            type="datetime-local"
            value={from}
            onChange={(event) => apply({ from: event.target.value })}
          />
        </div>

        <div className="min-w-[190px]">
          <Label htmlFor="to">Vaqtgacha</Label>
          <Input
            id="to"
            type="datetime-local"
            value={to}
            onChange={(event) => apply({ to: event.target.value })}
          />
          <p className="mt-1 text-[11px] text-ink-soft">Bo‘sh — hozirgacha</p>
        </div>

        {/*
          TUGMA SARALAYDI, YASHIRMAYDI.
          Nomi ham shunga mos: "promo kodsiz arizalar" degan yozuv
          ular YAGONA ko'rinadi degan taassurot berardi.
        */}
        <button
          type="button"
          onClick={() => apply({ promo: noPromoFirst ? null : "kodsiz" })}
          disabled={pending}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-[14px] border px-4 text-sm font-bold transition",
            noPromoFirst
              ? "border-brand bg-brand text-white"
              : "border-line bg-card text-ink-soft hover:border-brand/50 hover:text-brand",
          )}
        >
          <TicketSlash className="h-4 w-4" aria-hidden />
          Promo kodsizlar tepada
        </button>

        {(hasRange || noPromoFirst) && (
          <button
            type="button"
            onClick={() => apply({ from: null, to: null, promo: null })}
            disabled={pending}
            className="inline-flex h-10 items-center gap-1.5 rounded-[14px] border border-line bg-card px-3 text-xs font-bold text-ink-soft transition hover:border-coral/50 hover:text-coral"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Tozalash
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
          Tez tanlash
        </span>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => apply({ from: toTashkentInput(preset.from()), to: null })}
            disabled={pending}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand"
          >
            {preset.label}
          </button>
        ))}
        <span className="text-[11px] text-ink-soft">
          Vaqt <b>Toshkent</b> bo‘yicha
        </span>
      </div>
    </section>
  );
}
