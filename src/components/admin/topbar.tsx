"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Plus, Search } from "lucide-react";
import { CommandPalette } from "./command-palette";
import { Avatar } from "./badges";
import { AnimatePresence, motion } from "framer-motion";

export function AdminTopbar({
  fullName,
  avatarUrl,
  permissions,
  unreadCount,
}: {
  fullName: string;
  avatarUrl: string | null;
  permissions: string[];
  unreadCount: number;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const permSet = new Set(permissions);
  const createLinks = [
    permSet.has("candidates.create") && { href: "/candidates/new", label: "Yangi nomzod" },
    permSet.has("articles.create") && { href: "/articles/new", label: "Yangi maqola" },
    permSet.has("podcasts.manage") && { href: "/podcasts?new=1", label: "Yangi podcast" },
    permSet.has("tokens.manage") && { href: "/monthly-links?new=1", label: "Oylik havola" },
  ].filter(Boolean) as Array<{ href: string; label: string }>;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-card/75 px-4 backdrop-blur-md md:px-6">
      <button
        onClick={() => setPaletteOpen(true)}
        className="flex h-10 flex-1 items-center gap-2.5 rounded-[14px] border border-line bg-surface/70 px-3.5 text-sm text-ink-soft transition hover:border-brand/40 sm:max-w-sm"
        aria-label="Global qidiruv"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Qidirish…</span>
        <kbd className="hidden rounded-md border border-line bg-card px-1.5 py-0.5 text-[10px] font-bold sm:block">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {createLinks.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setCreateOpen((v) => !v)}
              onBlur={() => setTimeout(() => setCreateOpen(false), 150)}
              className="flex h-10 items-center gap-1.5 rounded-[14px] bg-gradient-to-r from-brand to-electric px-3.5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(22,119,255,0.28)] transition hover:brightness-110"
              aria-haspopup="menu"
              aria-expanded={createOpen}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Yaratish</span>
            </button>
            <AnimatePresence>
              {createOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.16 }}
                  role="menu"
                  className="absolute right-0 top-12 w-52 overflow-hidden rounded-[18px] border border-line bg-card p-1.5 shadow-pop"
                >
                  {createLinks.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      role="menuitem"
                      className="block rounded-[12px] px-3 py-2 text-sm font-semibold text-ink transition hover:bg-brand/8 hover:text-brand"
                    >
                      {l.label}
                    </Link>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <Link
          href="/notifications"
          className="relative flex h-10 w-10 items-center justify-center rounded-[14px] border border-line bg-card text-ink-soft transition hover:border-brand/40 hover:text-brand"
          aria-label={`Bildirishnomalar${unreadCount ? ` (${unreadCount} ta yangi)` : ""}`}
        >
          <Bell className="h-4.5 w-4.5" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>

        <Avatar name={fullName} src={avatarUrl} size={36} />
      </div>

      <CommandPalette
        key={paletteOpen ? "palette-open" : "palette-closed"}
        permissions={permissions}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </header>
  );
}
