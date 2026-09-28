"use client";

import { useState, useTransition } from "react";
import { Ticket, TimerOff, RotateCcw, Trash2, Search } from "lucide-react";
import { Button, Input, Label, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  createPromoCodeAction,
  deactivatePromoCodeAction,
  expirePromoCodeAction,
  previewPromoMatchAction,
  reopenPromoCodeAction,
} from "@/lib/actions/promo-codes";
import { formatDate } from "@/lib/utils";

export interface PromoCodeRow {
  id: string;
  code: string;
  rawCode: string;
  label: string | null;
  notes: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** Server hisoblagan: muddati o'tganmi. */
  expired: boolean;
}

export function PromoManager({
  rows,
  canManage,
}: {
  rows: readonly PromoCodeRow[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast("success", "Bajarildi", result.message);
      else toast("error", "Bajarilmadi", result.error);
    });
  }

  return (
    <div className="space-y-4">
      {canManage && <CreateForm onDone={(fd) => run(() => createPromoCodeAction(fd))} pending={pending} />}

      <MatchPreview />

      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Ro‘yxatdagi kodlar ({rows.length})
        </h2>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">Hali kod qo‘shilmagan.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-3 py-2.5"
              >
                <Ticket
                  className={row.expired ? "h-4 w-4 text-coral" : "h-4 w-4 text-brand"}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">{row.rawCode}</span>
                  <span className="block text-xs text-ink-soft">
                    {row.label ?? "izohsiz"}
                    {row.expiresAt
                      ? ` · muddat: ${formatDate(row.expiresAt, true)}`
                      : " · muddatsiz"}
                  </span>
                </span>

                <span
                  className={
                    row.expired
                      ? "rounded-full bg-coral/15 px-2.5 py-1 text-[11px] font-bold text-coral"
                      : "rounded-full bg-mint/20 px-2.5 py-1 text-[11px] font-bold text-ink"
                  }
                >
                  {row.expired ? "Muddati tugagan" : "Amal qiladi"}
                </span>

                {canManage && (
                  <span className="flex gap-1.5">
                    {row.expired ? (
                      <IconAction
                        title="Muddatni olib tashlash"
                        onClick={() => run(() => reopenPromoCodeAction(idForm(row.id)))}
                        disabled={pending}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </IconAction>
                    ) : (
                      <IconAction
                        title="Muddatni hozir tugatish"
                        onClick={() => run(() => expirePromoCodeAction(idForm(row.id)))}
                        disabled={pending}
                      >
                        <TimerOff className="h-3.5 w-3.5" />
                      </IconAction>
                    )}
                    <IconAction
                      title="Ro‘yxatdan olish"
                      onClick={() => run(() => deactivatePromoCodeAction(idForm(row.id)))}
                      disabled={pending}
                      danger
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconAction>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function idForm(id: string): FormData {
  const data = new FormData();
  data.set("id", id);
  return data;
}

function IconAction({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={
        danger
          ? "flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-card text-ink-soft transition hover:border-coral/50 hover:text-coral disabled:opacity-50"
          : "flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-card text-ink-soft transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
      }
    >
      {children}
    </button>
  );
}

function CreateForm({
  onDone,
  pending,
}: {
  onDone: (data: FormData) => void;
  pending: boolean;
}) {
  return (
    <form
      action={onDone}
      className="rounded-card border border-line bg-card p-4 shadow-card"
    >
      <h2 className="mb-3 font-display text-base font-semibold text-ink">Yangi promo kod</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="rawCode">Kod</Label>
          <Input id="rawCode" name="rawCode" placeholder="masalan TSUL-TAVSIYA" required />
          <p className="mt-1 text-[11px] text-ink-soft">
            Bo‘shliq, tire va ostki chiziq hisobga olinmaydi.
          </p>
        </div>
        <div>
          <Label htmlFor="label">Nima uchun (ixtiyoriy)</Label>
          <Input id="label" name="label" placeholder="kampaniya yoki tashkilot nomi" />
        </div>
        <div>
          <Label htmlFor="expiresAt">Amal qilish muddati</Label>
          <Input id="expiresAt" name="expiresAt" type="datetime-local" />
          {/*
            Bo'sh qoldirish ATAYLAB mumkin: ko'p kodlar muddatsiz
            beriladi va keyin qo'lda yopiladi.
          */}
          <p className="mt-1 text-[11px] text-ink-soft">
            Bo‘sh — muddatsiz. Vaqt <b>Toshkent</b> bo‘yicha.
          </p>
        </div>
        <div>
          <Label htmlFor="notes">Izoh (ixtiyoriy)</Label>
          <Textarea id="notes" name="notes" rows={1} />
        </div>
      </div>

      <div className="mt-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saqlanmoqda…" : "Qo‘shish"}
        </Button>
      </div>
    </form>
  );
}

/**
 * TEKSHIRIB KO'RISH.
 *
 * Moslashtirish ataylab saxiy: "TSULTAVSIYASIYA" ham, kirillcha
 * yozuv ham bir kod deb qaraladi. Bunga ishonish uchun admin uni
 * O'Z KO'ZI bilan ko'rishi kerak — aks holda "haqiqatan to'siladimi?"
 * degan savol javobsiz qolardi.
 */
function MatchPreview() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{
    fold: string;
    matches: Array<{ code: string; expired: boolean }>;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function check() {
    const input = value.trim();
    if (input === "") {
      setResult(null);
      return;
    }
    startTransition(async () => setResult(await previewPromoMatchAction(input)));
  }

  return (
    <section className="rounded-card border border-line bg-card p-4 shadow-card">
      <h2 className="mb-3 font-display text-base font-semibold text-ink">Tekshirib ko‘rish</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Label htmlFor="probe">Nomzod shunday yozsa nima bo‘ladi?</Label>
          <Input
            id="probe"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                check();
              }
            }}
            placeholder="masalan ЦУЛТАВСИЯ yoki TSULTAVSIYASIYA"
          />
        </div>
        <Button type="button" variant="secondary" onClick={check} disabled={pending}>
          <Search className="mr-1.5 inline h-4 w-4" aria-hidden />
          Tekshirish
        </Button>
      </div>

      {result && (
        <div className="mt-3 rounded-card border border-line bg-surface p-3 text-xs">
          {result.matches.length === 0 ? (
            <p className="text-ink-soft">
              Hech qaysi kodga mos kelmadi — bunday ariza to‘silmaydi.
            </p>
          ) : (
            <ul className="space-y-1">
              {result.matches.map((match) => (
                <li key={match.code} className="text-ink">
                  <b>{match.code}</b> —{" "}
                  {match.expired ? (
                    <span className="font-bold text-coral">to‘siladi (muddati tugagan)</span>
                  ) : (
                    <span className="text-ink-soft">o‘tadi (amal qiladi)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
