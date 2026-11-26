"use client";

import { useEffect, useId, useState, useTransition, type KeyboardEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EyeOff, FunnelX, Plus, Search, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";
import { getPromoCodeSuggestions, getSelectedPromoCounts } from "./promo-code-suggestions";
import { MAX_HIDDEN_PROMO_CODES, parseHiddenPromoCodes } from "./promo-hide-utils";

export function PromoHideFilter() {
  const params = useSearchParams();
  const stored = params.get("hidden_promo") ?? "";
  return <PromoHideControl key={stored} initialCodes={parseHiddenPromoCodes(stored)} />;
}

function PromoHideControl({ initialCodes }: { initialCodes: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = useId();
  const [codes, setCodes] = useState(initialCodes);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ code: string; count: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pending, startTransition] = useTransition();
  const enabled = params.get("hide_promo") === "1" && initialCodes.length > 0;
  const hiddenTotal = initialCodes.every((code) => typeof counts[code] === "number")
    ? initialCodes.reduce((total, code) => total + (counts[code] ?? 0), 0)
    : null;
  const hiddenCountFailed = initialCodes.some((code) => counts[code] === null);
  const options = suggestions.filter(({ code }) => !codes.includes(code));

  useEffect(() => {
    if (!codes.length) return;
    let cancelled = false;
    getSelectedPromoCounts(codes).then((results) => {
      if (!cancelled) setCounts(Object.fromEntries(results.map(({ code, count }) => [code, count])));
    }).catch(() => {
      if (!cancelled) setCounts(Object.fromEntries(codes.map((code) => [code, null])));
    });
    return () => { cancelled = true; };
  }, [codes]);

  useEffect(() => {
    let cancelled = false;
    const term = query.trim();
    if (!term) return;
    const timer = setTimeout(async () => {
      try {
        const found = await getPromoCodeSuggestions(term);
        if (!cancelled) setSuggestions(found);
      } catch {
        if (!cancelled) setError("Promokodlarni qidirib bo‘lmadi. Qayta yozib ko‘ring.");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [query]);

  function apply(nextCodes: string[], hide: boolean) {
    const sp = new URLSearchParams(params.toString());
    if (nextCodes.length) sp.set("hidden_promo", JSON.stringify(nextCodes));
    else sp.delete("hidden_promo");
    if (hide && nextCodes.length) sp.set("hide_promo", "1");
    else sp.delete("hide_promo");
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  function add(code: string) {
    if (!code || codes.includes(code) || codes.length >= MAX_HIDDEN_PROMO_CODES) return;
    setCodes([...codes, code]);
    setQuery("");
    setSuggestions([]);
    setSearching(false);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((previous) => options.length ? (previous + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      add(open && active >= 0 && options[active] ? options[active].code : query.trim());
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <div>
        <Label htmlFor={id}>Berkitiladigan promokodlar</Label>
        <div className="flex items-start gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-soft" aria-hidden="true" />
            <Input
              id={id} value={query} maxLength={120} placeholder="Promokodni yozing…" className="pl-9"
              role="combobox" aria-autocomplete="list" aria-expanded={open && Boolean(query.trim())}
              aria-controls={`${id}-options`} aria-activedescendant={open && active >= 0 && options[active] ? `${id}-option-${active}` : undefined}
              autoComplete="off" disabled={pending || codes.length >= MAX_HIDDEN_PROMO_CODES}
              onChange={(event) => {
                setQuery(event.target.value);
                setSuggestions([]);
                setSearching(Boolean(event.target.value.trim()));
                setError(null);
                setActive(-1);
                setOpen(true);
              }}
              onKeyDown={onKeyDown} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
            />
            {open && query.trim() && (
              <ul id={`${id}-options`} role="listbox" aria-label="Mos promokodlar" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-[14px] border border-line bg-card p-1 shadow-pop">
                {options.map(({ code, count }, index) => (
                  <li key={code} id={`${id}-option-${index}`} role="option" aria-selected={active === index}
                    onMouseDown={(event) => { event.preventDefault(); add(code); }} onMouseEnter={() => setActive(index)}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${active === index ? "bg-brand/10 text-brand" : "text-ink hover:bg-surface"}`}>
                    <span className="break-all font-semibold">{code}</span>
                    <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs text-ink-soft">{count} ta ariza</span>
                  </li>
                ))}
                {!options.length && <li role="presentation" className="px-3 py-2 text-xs text-ink-soft">{searching ? "Qidirilmoqda…" : error ?? "Mos promokod topilmadi. Qo‘shish tugmasi orqali kiriting."}</li>}
              </ul>
            )}
          </div>
          <Button type="button" variant="secondary" disabled={pending || !query.trim() || codes.length >= MAX_HIDDEN_PROMO_CODES} onClick={() => add(query.trim())}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Qo‘shish
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">Taklifdagi son — shu kod bilan kelgan jami arizalar soni.</p>
      </div>
      {codes.length > 0 && (
        <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto" aria-label="Tanlangan promokodlar">
          {codes.map((code) => (
            <span key={code} className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-brand/25 bg-brand/10 py-1 pl-2.5 pr-1 text-xs font-bold text-brand">
              <span className="break-all">{code}</span>
              <span className="shrink-0 rounded-full bg-card/80 px-2 py-0.5 text-[11px] font-semibold" aria-live="polite">
                {counts[code] === undefined ? "…" : counts[code] === null ? "Sanoq olinmadi" : `${counts[code]} ta ariza`}
              </span>
              <button type="button" disabled={pending} aria-label={`${code} kodini olib tashlash`} className="shrink-0 rounded-lg p-1 hover:bg-brand/15 focus-visible:outline-2 focus-visible:outline-brand"
                onClick={() => { const next = codes.filter((item) => item !== code); setCodes(next); if (enabled) apply(next, true); }}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending || !codes.length} onClick={() => apply(codes, true)}>
          <EyeOff className="h-4 w-4" aria-hidden="true" />
          {pending ? "Qo‘llanmoqda…" : "Promokodlilarni berkitish"}
        </Button>
        {enabled && <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => { setCodes([]); setQuery(""); setSuggestions([]); setOpen(false); apply([], false); }}><FunnelX className="h-4 w-4" aria-hidden="true" /> Filtrni tozalash</Button>}
      </div>
      {enabled && (
        <p role="status" className="text-xs font-semibold text-brand">
          Filtr faol: {initialCodes.length} ta promokod bo‘yicha {hiddenTotal !== null
            ? `jami ${hiddenTotal} ta ariza berkitilgan.`
            : hiddenCountFailed ? "jami arizalar sonini olib bo‘lmadi." : "jami arizalar soni hisoblanmoqda…"}
        </p>
      )}
    </div>
  );
}
