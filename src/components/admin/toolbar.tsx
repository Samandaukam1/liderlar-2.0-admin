"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * DataTableToolbar — search + select filters synced to URL searchParams so
 * list pages stay fully server-rendered (server-side pagination/filtering).
 */
export function DataTableToolbar({
  searchPlaceholder = "Qidirish…",
  filters = [],
}: {
  searchPlaceholder?: string;
  filters?: Array<{ key: string; label: string; options: FilterOption[] }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const paramQ = params.get("q") ?? "";
  const [q, setQ] = useState(paramQ);
  const [seenParamQ, setSeenParamQ] = useState(paramQ);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local input with external URL changes (back/forward, cleared filters)
  // via the render-time "adjust state on prop change" pattern — no effect.
  if (paramQ !== seenParamQ) {
    setSeenParamQ(paramQ);
    setQ(paramQ);
  }

  const apply = (key: string, value: string) => {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (debounce.current) clearTimeout(debounce.current);
            const v = e.target.value;
            debounce.current = setTimeout(() => apply("q", v), 350);
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-10 w-full rounded-[14px] border border-line bg-card pl-9 pr-3.5 text-sm text-ink placeholder:text-ink-soft/60 transition focus:border-brand/60 focus:outline-2 focus:outline-brand/25"
        />
      </div>
      {filters.map((f) => (
        <select
          key={f.key}
          value={params.get(f.key) ?? ""}
          onChange={(e) => apply(f.key, e.target.value)}
          aria-label={f.label}
          className={cn(
            "h-10 rounded-[14px] border border-line bg-card px-3 text-sm text-ink transition focus:border-brand/60 focus:outline-2 focus:outline-brand/25",
            params.get(f.key) && "border-brand/50 bg-brand/5 font-semibold",
          )}
        >
          <option value="">{f.label}: barchasi</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
