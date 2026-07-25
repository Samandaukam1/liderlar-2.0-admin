"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleGroups, type NavItem } from "./nav-data";

export function CommandPalette({
  permissions,
  open,
  onClose,
}: {
  permissions: string[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const all: NavItem[] = visibleGroups(permissions).flatMap((g) => g.items);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.keywords ?? "").toLowerCase().includes(q),
    );
  }, [permissions, query]);

  // Focus only — no setState in the effect. Query/activeIndex start fresh
  // because the parent remounts the palette (key) each time it opens.
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(id);
    }
  }, [open]);

  const go = (item: NavItem | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[80] bg-navy-deep/45 p-4 pt-[12vh] backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Buyruqlar paneli"
            className="mx-auto max-w-xl overflow-hidden rounded-panel border border-line bg-card shadow-pop"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4.5 w-4.5 text-ink-soft" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((i) => Math.min(i + 1, items.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    go(items[activeIndex]);
                  }
                }}
                placeholder="Bo‘lim yoki amal qidiring…"
                className="h-13 w-full bg-transparent py-4 text-sm text-ink outline-none placeholder:text-ink-soft/50"
              />
              <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">
                ESC
              </kbd>
            </div>
            <ul className="max-h-[46vh] overflow-y-auto p-2" role="listbox">
              {items.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-ink-soft">
                  Hech narsa topilmadi
                </li>
              )}
              {items.map((item, i) => (
                <li key={item.href} role="option" aria-selected={i === activeIndex}>
                  <button
                    onClick={() => go(item)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[13px] px-3 py-2.5 text-left text-sm font-semibold transition-colors",
                      i === activeIndex
                        ? "bg-brand/10 text-brand"
                        : "text-ink hover:bg-surface",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0 text-ink-soft" />
                    <span className="flex-1">{item.label}</span>
                    {i === activeIndex && (
                      <CornerDownLeft className="h-3.5 w-3.5 text-ink-soft" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
