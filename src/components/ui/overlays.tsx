"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, AlertTriangle } from "lucide-react";
import { Button } from "./primitives";
import { cn } from "@/lib/utils";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEscape(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-navy-deep/45 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              "max-h-[90vh] w-full overflow-y-auto rounded-panel border border-line bg-card p-6 shadow-pop",
              wide ? "max-w-3xl" : "max-w-lg",
            )}
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-ink">
                {title}
              </h2>
              <button
                onClick={onClose}
                aria-label="Yopish"
                className="rounded-lg p-1.5 text-ink-soft transition hover:bg-surface"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEscape(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[70] bg-navy-deep/40 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="absolute right-0 top-0 h-full w-[min(480px,100vw)] overflow-y-auto rounded-l-panel border-l border-line bg-card p-6 shadow-pop"
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="font-display text-lg font-semibold uppercase tracking-wide text-ink">
                {title}
              </h2>
              <button
                onClick={onClose}
                aria-label="Yopish"
                className="rounded-lg p-1.5 text-ink-soft transition hover:bg-surface"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {children}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Tasdiqlash",
  danger = false,
  loading = false,
  requireText,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  /** For dangerous actions: user must type this text to enable confirm. */
  requireText?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex items-start gap-3">
        {danger && (
          <span className="mt-0.5 rounded-xl bg-coral/15 p-2 text-coral">
            <AlertTriangle className="h-5 w-5" />
          </span>
        )}
        <p className="text-sm leading-relaxed text-ink-soft">{description}</p>
      </div>
      {requireText ? (
        <div className="mt-4">
          <p className="mb-1.5 text-xs text-ink-soft">
            Davom etish uchun <b className="text-ink">{requireText}</b> deb
            yozing:
          </p>
          <input
            ref={inputRef}
            className="h-10 w-full rounded-[14px] border border-line px-3.5 text-sm"
            onChange={() => {
              // re-render via state not needed; validate on confirm
            }}
          />
        </div>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Bekor qilish
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          disabled={loading}
          onClick={() => {
            if (
              requireText &&
              inputRef.current &&
              inputRef.current.value.trim() !== requireText
            ) {
              inputRef.current.focus();
              return;
            }
            onConfirm();
          }}
        >
          {loading ? "Bajarilmoqda…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
