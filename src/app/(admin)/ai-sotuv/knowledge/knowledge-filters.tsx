"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/primitives";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_STATUS_LABELS,
} from "@/lib/sales/types";

const DEBOUNCE_MS = 350;

export function KnowledgeFilters({
  status,
  category,
  query,
}: {
  status: string;
  category: string;
  query: string;
}) {
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
      startTransition(() => router.replace(`/ai-sotuv/knowledge?${params.toString()}`));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, query, router, searchParams]);

  function setParam(key: string, next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set(key, next);
    else params.delete(key);
    params.delete("page");
    router.replace(`/ai-sotuv/knowledge?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Savol yoki javob bo‘yicha qidirish…"
          className="pl-9"
          aria-label="Qidirish"
        />
      </div>
      <Select
        value={status}
        onChange={(e) => setParam("status", e.target.value)}
        className="w-auto min-w-[170px]"
        aria-label="Holat"
      >
        <option value="">Barcha holatlar</option>
        {KNOWLEDGE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {KNOWLEDGE_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      <Select
        value={category}
        onChange={(e) => setParam("category", e.target.value)}
        className="w-auto min-w-[180px]"
        aria-label="Turkum"
      >
        <option value="">Barcha turkumlar</option>
        {KNOWLEDGE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {KNOWLEDGE_CATEGORY_LABELS[c]}
          </option>
        ))}
      </Select>
    </div>
  );
}
