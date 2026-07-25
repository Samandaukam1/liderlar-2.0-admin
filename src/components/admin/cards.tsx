import { cn, formatNumber } from "@/lib/utils";
import type { Accent } from "@/lib/statuses";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Pastel gradient washes per accent — inspired by Liderlar.uz post cards. */
const CARD_WASHES: Record<Accent, string> = {
  cyan: "from-cyan/12 to-electric/8",
  brand: "from-brand/10 to-cyan/10",
  mint: "from-mint/16 to-green/8",
  green: "from-green/14 to-mint/10",
  lavender: "from-lavender/16 to-rose/8",
  rose: "from-rose/14 to-lavender/10",
  peach: "from-peach/18 to-amber/8",
  amber: "from-amber/14 to-peach/10",
  coral: "from-coral/12 to-rose/8",
  sky: "from-sky/16 to-cyan/8",
  lime: "from-lime/25 to-mint/10",
  neutral: "from-surface to-card",
};

const ICON_TINTS: Record<Accent, string> = {
  cyan: "bg-cyan/15 text-[#0287a0]",
  brand: "bg-brand/12 text-brand",
  mint: "bg-mint/20 text-[#1d8a6b]",
  green: "bg-green/15 text-[#2e7d44]",
  lavender: "bg-lavender/18 text-[#6a52c7]",
  rose: "bg-rose/18 text-[#b2408a]",
  peach: "bg-peach/22 text-[#b3611f]",
  amber: "bg-amber/18 text-[#946a10]",
  coral: "bg-coral/15 text-[#c43d3d]",
  sky: "bg-sky/18 text-[#1873a8]",
  lime: "bg-lime/30 text-[#6d7d16]",
  neutral: "bg-ink-soft/10 text-ink-soft",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = "cyan",
  change,
  changeLabel,
  href,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accent?: Accent;
  /** Percent or absolute change vs previous period. */
  change?: number | null;
  changeLabel?: string;
  href?: string;
}) {
  const body = (
    <div
      className={cn(
        "rise-in relative overflow-hidden rounded-card border border-line bg-gradient-to-br p-5 shadow-card",
        CARD_WASHES[accent],
        href && "transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
          {label}
        </p>
        <span className={cn("rounded-xl p-2", ICON_TINTS[accent])}>
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
      </div>
      <p className="mt-2 font-display text-[34px] font-semibold leading-none text-ink">
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      {change != null ? (
        <p className="mt-2.5 flex items-center gap-1 text-xs font-semibold">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-badge px-1.5 py-0.5",
              change >= 0 ? "bg-mint/25 text-[#1d8a6b]" : "bg-coral/15 text-[#c43d3d]",
            )}
          >
            {change >= 0 ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {Math.abs(change)}
          </span>
          {changeLabel ? <span className="text-ink-soft">{changeLabel}</span> : null}
        </p>
      ) : null}
    </div>
  );
  return href ? <a href={href}>{body}</a> : body;
}

export function TrendCard({
  title,
  children,
  accent = "cyan",
  action,
}: {
  title: string;
  children: ReactNode;
  accent?: Accent;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
          <span
            className={cn("h-2.5 w-2.5 rounded-full", {
              cyan: "bg-cyan",
              brand: "bg-brand",
              mint: "bg-mint",
              green: "bg-green",
              lavender: "bg-lavender",
              rose: "bg-rose",
              peach: "bg-peach",
              amber: "bg-amber",
              coral: "bg-coral",
              sky: "bg-sky",
              lime: "bg-lime",
              neutral: "bg-ink-soft/40",
            }[accent])}
          />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-card p-5 shadow-card">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {subtitle ? <p className="text-xs text-ink-soft">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
