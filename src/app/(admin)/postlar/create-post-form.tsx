"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  createPostForCandidateAction,
  preparePortraitAction,
  rerenderPostAction,
  searchCandidatesForPostAction,
} from "@/lib/actions/post-studio";

/**
 * Manual entry point. Posts are normally created by the two-hour pipeline, but
 * an admin still needs a way to build one for an older candidate whose intake
 * predates the automation.
 *
 * Creation runs in three real steps — row, cut-out, render — and the bar moves
 * as each one actually returns, rather than animating on a timer. Background
 * removal is around a second on its own, so a button that simply went quiet
 * read as a hang.
 */

const STEPS = [
  { at: 10, label: "Ma’lumotlar tayyorlanmoqda…" },
  { at: 35, label: "Portret tayyorlanmoqda…" },
  { at: 75, label: "Dizayn joylashtirilmoqda…" },
  { at: 100, label: "Post tayyor" },
] as const;

export function CreatePostForm() {
  const router = useRouter();
  const [candidateId, setCandidateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();

  function onCreate() {
    if (!candidateId) return;
    setError(null);
    setNotice(null);

    startTransition(async () => {
      setStep(0);
      const created = await createPostForCandidateAction(candidateId);
      if (!created.ok || !created.postId) {
        setStep(0);
        setError(created.error ?? "Post yaratilmadi");
        return;
      }
      const postId = created.postId;

      // The cut-out is reused when the candidate's photo has not changed, so
      // this is fast on a repeat and ~1s the first time.
      setStep(1);
      const portrait = await preparePortraitAction(postId, { force: false });

      setStep(2);
      const rendered = await rerenderPostAction(postId);

      setStep(3);
      const problems = [portrait.error, rendered.error].filter(Boolean) as string[];
      if (problems.length > 0) {
        // The post exists and is flagged for review; the admin still goes to
        // the studio, but with the reason in front of them.
        setNotice(problems.join(" · "));
      }
      router.push(`/postlar/${postId}`);
    });
  }

  const current = STEPS[step];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <CandidatePicker onChange={setCandidateId} disabled={pending} />
        <Button type="button" size="sm" disabled={pending || !candidateId} onClick={onCreate}>
          {pending ? null : <Plus className="h-3.5 w-3.5" />}
          {pending ? `${current.at}% — ${current.label}` : "Post yaratish"}
        </Button>
        {error ? <span className="text-xs text-[#c43d3d]">{error}</span> : null}
      </div>

      {pending ? (
        <div
          className="h-1.5 w-full max-w-[420px] overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={current.at}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={current.label}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${current.at}%` }}
          />
        </div>
      ) : null}

      {!pending && step === STEPS.length - 1 && !error ? (
        <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
          <Check className="h-3.5 w-3.5" />
          {notice ?? "Post tayyor — portret, iqtibos va dizayn joylashtirildi."}
        </span>
      ) : null}
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

type CandidateOption = { id: string; fullName: string };

/**
 * Type-to-search picker. The search runs on the server: there are thousands
 * of candidates, far more than a `<select>` can carry or an admin can scroll.
 */
function CandidatePicker({
  onChange,
  disabled,
}: {
  onChange: (candidateId: string) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CandidateOption | null>(null);
  const [results, setResults] = useState<CandidateOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the latest request may write results — an earlier, slower one must
  // not overwrite what the admin is now looking at.
  const latest = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function search(value: string) {
    setQuery(value);
    setOpen(true);
    setActive(0);
    setFailed(false);
    if (selected) {
      setSelected(null);
      onChange("");
    }
    if (timer.current) clearTimeout(timer.current);

    const term = value.trim();
    const request = ++latest.current;
    if (term.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const found = await searchCandidatesForPostAction(term);
        if (request === latest.current) setResults(found);
      } catch {
        if (request === latest.current) {
          setResults([]);
          setFailed(true);
        }
      } finally {
        if (request === latest.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function pick(candidate: CandidateOption) {
    setSelected(candidate);
    setQuery(candidate.fullName);
    setOpen(false);
    onChange(candidate.id);
  }

  function clear() {
    search("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (results.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        pick(results[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const term = query.trim();
  let hint: string | null = null;
  if (term.length < MIN_QUERY_LENGTH) hint = "Ism yoki familiyadan kamida 2 harf yozing";
  else if (failed) hint = "Qidiruvda xatolik — qayta urinib ko‘ring";
  else if (searching && results.length === 0) hint = "Qidirilmoqda…";
  else if (results.length === 0) hint = "Bunday nomzod topilmadi";

  const showList = open && !selected && !disabled;

  return (
    <div className="relative w-full sm:w-[340px]">
      {selected ? (
        <Check className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand" />
      ) : searching ? (
        <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-soft" />
      ) : (
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
      )}
      <Input
        type="text"
        role="combobox"
        aria-label="Nomzodni qidiring"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Nomzodni qidiring…"
        value={query}
        disabled={disabled}
        onChange={(e) => search(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={cn("pl-9", query ? "pr-9" : null)}
      />
      {query && !disabled ? (
        <button
          type="button"
          aria-label="Tozalash"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-soft transition hover:bg-line hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-[14px] border border-line bg-card p-1 shadow-[0_12px_32px_rgba(15,35,60,0.12)]"
        >
          {hint ? (
            <li className="px-3 py-2.5 text-xs text-ink-soft">{hint}</li>
          ) : (
            results.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "cursor-pointer truncate rounded-[10px] px-3 py-2 text-sm text-ink",
                  i === active && "bg-brand/10 text-brand",
                )}
              >
                {c.fullName}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
