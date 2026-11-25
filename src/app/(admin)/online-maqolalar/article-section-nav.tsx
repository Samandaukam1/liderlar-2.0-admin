import Link from "next/link";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "submitted", label: "Yuborilgan", path: "/online-maqolalar" },
  { id: "published", label: "Nashrda", path: "/online-maqolalar/nashrda" },
  { id: "draft", label: "Qoralamada", path: "/online-maqolalar/qoralamada" },
] as const;

type Section = (typeof SECTIONS)[number]["id"];

/** Uchta maqola bo‘limini bog‘laydi. Ro‘yxatlar bosilganda yuklanadi. */
export function ArticleSectionNav({ active, counts }: {
  active: Section;
  counts?: Partial<Record<Section, number>>;
}) {
  return (
    <nav aria-label="Maqola bo‘limlari" className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-[16px] border border-line bg-card p-1 shadow-card">
      {SECTIONS.map(({ id, label, path }) => (
        <Link
          key={id}
          href={path}
          prefetch={false}
          aria-current={active === id ? "page" : undefined}
          className={cn(
            "inline-flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-[12px] px-2.5 text-xs font-bold transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-w-32 sm:px-4 sm:text-sm",
            active === id
              ? "bg-brand/15 text-brand"
              : "text-ink-soft hover:bg-surface hover:text-ink",
          )}
        >
          <span className="inline-flex items-baseline gap-1.5">
            <span>{label}</span>
            {counts?.[id] !== undefined && <span className="font-semibold tabular-nums opacity-80">{counts[id]}</span>}
          </span>
        </Link>
      ))}
    </nav>
  );
}
