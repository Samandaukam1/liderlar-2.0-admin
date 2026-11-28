"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarClock, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";

export function CreatedDateFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const from = params.get("created_from") ?? "";
  const to = params.get("created_to") ?? "";

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <section aria-label="Yaratilgan sana bo‘yicha filtr" className="mb-4 rounded-card border border-line bg-card p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-bold text-ink"><CalendarClock className="h-4 w-4 text-brand" aria-hidden="true" /> Yaratilgan sana bo‘yicha</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <Label htmlFor="intake-created-from">Sanadan</Label>
          <Input id="intake-created-from" type="date" value={from} max={to || undefined} disabled={pending} onChange={(event) => apply({ created_from: event.target.value })} />
        </div>
        <div className="min-w-[180px]">
          <Label htmlFor="intake-created-to">Sanagacha</Label>
          <Input id="intake-created-to" type="date" value={to} min={from || undefined} disabled={pending} onChange={(event) => apply({ created_to: event.target.value })} />
        </div>
        {(from || to) && <Button type="button" variant="secondary" disabled={pending} onClick={() => apply({ created_from: "", created_to: "" })}><X className="h-4 w-4" aria-hidden="true" /> Sana filtrini tozalash</Button>}
      </div>
      <p className="mt-2 text-xs text-ink-soft">Toshkent vaqti bo‘yicha. Sanagacha tanlangan kun ham hisobga olinadi.</p>
    </section>
  );
}
