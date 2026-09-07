"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/primitives";
import { LEARNING_STATUSES, LEARNING_STATUS_LABELS } from "@/lib/sales/types";

const DEBOUNCE_MS = 350;

/** Qidiruv debounce bilan — har harfga bitta server so'rovi ketmasin. */
export function ConversationFilters({ status, query }: { status: string; query: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(query);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (value === query) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set("q", value.trim());
      else params.delete("q");
      params.delete("page");
      startTransition(() => router.replace(`/ai-sotuv/suhbatlar?${params.toString()}`));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, query, router, searchParams]);

  function onStatusChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("status", next);
    else params.delete("status");
    params.delete("page");
    router.replace(`/ai-sotuv/suhbatlar?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Mijoz ismi yoki username bo‘yicha qidirish…"
          className="pl-9"
          aria-label="Qidirish"
        />
      </div>
      <Select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="w-auto min-w-[190px]"
        aria-label="O‘rganish holati"
      >
        <option value="">Barcha holatlar</option>
        {LEARNING_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LEARNING_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
    </div>
  );
}
