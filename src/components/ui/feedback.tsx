import { cn } from "@/lib/utils";
import { Inbox, ShieldOff, TimerOff, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-table border border-line bg-card p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-card px-6 py-14 text-center">
      <span className="mb-4 rounded-2xl bg-gradient-to-br from-cyan/15 to-lavender/20 p-4 text-brand">
        {icon ?? <Inbox className="h-7 w-7" />}
      </span>
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-ink-soft">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Xatolik yuz berdi",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-card border border-coral/40 bg-coral/5 px-6 py-12 text-center">
      <span className="mb-3 rounded-2xl bg-coral/15 p-3 text-coral">
        <TriangleAlert className="h-6 w-6" />
      </span>
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-ink-soft">{description}</p>
      ) : null}
    </div>
  );
}

export function PermissionDenied({ permission }: { permission?: string }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-peach/50 bg-peach/10 px-6 py-14 text-center">
      <span className="mb-4 rounded-2xl bg-peach/25 p-4 text-amber">
        <ShieldOff className="h-7 w-7" />
      </span>
      <h3 className="font-display text-lg font-semibold uppercase tracking-wide text-ink">
        Ruxsat yo‘q
      </h3>
      <p className="mt-1 max-w-md text-sm text-ink-soft">
        Bu bo‘limni ko‘rish uchun vakolatingiz yetarli emas.
        {permission ? ` (kerakli ruxsat: ${permission})` : ""} Administrator
        bilan bog‘laning.
      </p>
    </div>
  );
}

export function SessionExpired() {
  return (
    <div className="flex flex-col items-center rounded-card border border-line bg-card px-6 py-14 text-center">
      <span className="mb-4 rounded-2xl bg-lavender/20 p-4 text-lavender">
        <TimerOff className="h-7 w-7" />
      </span>
      <h3 className="font-display text-lg font-semibold uppercase tracking-wide text-ink">
        Sessiya muddati tugadi
      </h3>
      <p className="mt-1 text-sm text-ink-soft">
        Xavfsizlik uchun qayta kirishingiz kerak.
      </p>
      <a
        href="/login"
        className="mt-5 inline-flex h-10 items-center rounded-[14px] bg-gradient-to-r from-brand to-electric px-5 text-sm font-bold text-white"
      >
        Qayta kirish
      </a>
    </div>
  );
}
