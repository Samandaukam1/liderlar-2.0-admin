import { cn, truncate } from "@/lib/utils";
import { statusMeta, type Accent } from "@/lib/statuses";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

/** Static class map so Tailwind can see every accent variant. */
export const ACCENT_CLASSES: Record<Accent, string> = {
  mint: "bg-mint/18 text-[#1d8a6b] border-mint/50",
  green: "bg-green/15 text-[#2e7d44] border-green/50",
  peach: "bg-peach/20 text-[#b3611f] border-peach/60",
  amber: "bg-amber/18 text-[#946a10] border-amber/50",
  coral: "bg-coral/15 text-[#c43d3d] border-coral/50",
  rose: "bg-rose/18 text-[#b2408a] border-rose/50",
  lavender: "bg-lavender/18 text-[#6a52c7] border-lavender/50",
  sky: "bg-sky/18 text-[#1873a8] border-sky/50",
  lime: "bg-lime/25 text-[#6d7d16] border-lime/70",
  cyan: "bg-cyan/14 text-[#0287a0] border-cyan/45",
  brand: "bg-brand/12 text-brand border-brand/40",
  neutral: "bg-ink-soft/10 text-ink-soft border-ink-soft/25",
};

export function Badge({
  accent = "neutral",
  children,
  className,
}: {
  accent?: Accent;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-badge border px-2 py-0.5 text-[11px] font-bold",
        ACCENT_CLASSES[accent],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const meta = statusMeta(status);
  return <Badge accent={meta.accent}>{meta.label}</Badge>;
}

const ROLE_ACCENTS: Record<Role, Accent> = {
  super_admin: "coral",
  admin: "cyan",
  editor: "lavender",
  moderator: "sky",
  analyst: "amber",
  viewer: "neutral",
};

export function RoleBadge({ role }: { role: string }) {
  const r = role as Role;
  return (
    <Badge accent={ROLE_ACCENTS[r] ?? "neutral"}>
      {ROLE_LABELS[r] ?? role}
    </Badge>
  );
}

export function RankingBadge({
  position,
  change,
}: {
  position: number;
  change?: number | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-display text-lg font-semibold text-ink">
        #{position}
      </span>
      {change != null && change !== 0 ? (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-badge px-1.5 py-0.5 text-[11px] font-bold",
            change > 0 ? "bg-mint/20 text-[#1d8a6b]" : "bg-coral/15 text-[#c43d3d]",
          )}
        >
          {change > 0 ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : (
            <ArrowDownRight className="h-3 w-3" />
          )}
          {Math.abs(change)}
        </span>
      ) : change === 0 ? (
        <span className="inline-flex items-center rounded-badge bg-ink-soft/10 px-1.5 py-0.5 text-[11px] font-bold text-ink-soft">
          <Minus className="h-3 w-3" />
        </span>
      ) : null}
    </span>
  );
}

const AVATAR_GRADIENTS = [
  "from-cyan to-electric",
  "from-lavender to-rose",
  "from-mint to-sky",
  "from-peach to-coral",
  "from-sky to-lavender",
];

export function Avatar({
  name,
  src,
  size = 36,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const gradient =
    AVATAR_GRADIENTS[
      Math.abs([...name].reduce((a, c) => a + c.charCodeAt(0), 0)) %
        AVATAR_GRADIENTS.length
    ];
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- storage URLs are dynamic/signed
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-line object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white",
        gradient,
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials || "?"}
    </span>
  );
}

export function CandidateMiniCard({
  name,
  avatarUrl,
  meta,
  href,
}: {
  name: string;
  avatarUrl?: string | null;
  meta?: string | null;
  href?: string;
}) {
  const body = (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name} src={avatarUrl} size={34} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-ink">
          {truncate(name, 40)}
        </span>
        {meta ? (
          <span className="block truncate text-xs text-ink-soft">{meta}</span>
        ) : null}
      </span>
    </span>
  );
  if (href) {
    return (
      <a href={href} className="group inline-flex max-w-full rounded-lg transition hover:opacity-80">
        {body}
      </a>
    );
  }
  return body;
}
