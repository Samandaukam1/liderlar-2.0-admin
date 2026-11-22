"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/primitives";

export interface ArticleCandidate {
  id: string;
  full_name: string;
  slug?: string;
}

export function ArticleCandidatePicker({
  selected,
  disabled,
  onChange,
}: {
  selected: ArticleCandidate | null;
  disabled: boolean;
  onChange: (candidate: ArticleCandidate | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    query: string;
    candidates: ArticleCandidate[];
    error?: string;
  }>({ query: "", candidates: [] });
  const search = query.trim();
  const loading = !!search && result.query !== search;

  useEffect(() => {
    if (!search || disabled) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/articles/candidates?q=${encodeURIComponent(search)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Qidiruvda xatolik. Qayta urinib ko‘ring.");
        const data = await response.json();
        if (!controller.signal.aborted) {
          setResult({ query: search, candidates: data.candidates });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({ query: search, candidates: [], error: "Qidiruvda xatolik. Qayta urinib ko‘ring." });
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, disabled]);

  return (
    <div>
      <Input
        id="a-candidate"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
        placeholder="Ism yoki slug bo‘yicha qidirish…"
        autoComplete="off"
        aria-controls="article-candidate-results"
      />
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 break-words text-ink">{selected?.full_name ?? "Bog‘lanmagan"}</span>
        {selected && !disabled && (
          <button type="button" className="shrink-0 px-2 py-2 text-xs font-bold text-coral" onClick={() => onChange(null)}>
            Bog‘lanishni uzish
          </button>
        )}
      </div>
      <div id="article-candidate-results" aria-live="polite" aria-busy={loading}>
        {search && !disabled && (
          loading ? <p className="mt-2 text-xs text-ink-soft">Qidirilmoqda…</p> : result.error ? (
            <p className="mt-2 text-xs text-coral" role="alert">{result.error}</p>
          ) : result.candidates.length === 0 ? (
            <p className="mt-2 text-xs text-ink-soft">Nomzod topilmadi.</p>
          ) : (
            <ul className="mt-2 overflow-hidden rounded-xl border border-line">
              {result.candidates.slice(0, 5).map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="min-h-11 w-full px-3 py-2 text-left text-sm text-ink hover:bg-brand/8 focus-visible:outline-2 focus-visible:outline-brand"
                    onClick={() => {
                      onChange(candidate);
                      setQuery("");
                    }}
                  >
                    <span className="block break-words font-semibold">{candidate.full_name}</span>
                    {candidate.slug && <span className="block break-all text-xs text-ink-soft">/{candidate.slug}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
