import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  /** Hidden below md — table collapses into card view on mobile. */
  desktopOnly?: boolean;
  render: (row: T) => ReactNode;
}

/**
 * Server-rendered data table with sticky header, hover states and a built-in
 * mobile card view. Pagination is server-side via ?page= searchParam.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  rowHref,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowHref?: (row: T) => string;
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-table border border-line bg-card shadow-card md:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-line bg-surface/90 backdrop-blur">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="group border-b border-line/60 transition-colors last:border-0 hover:bg-brand/[0.04]"
              >
                {columns.map((col, i) => (
                  <td key={col.key} className={cn("px-4 py-3 align-middle", col.className)}>
                    {rowHref && i === 0 ? (
                      <Link href={rowHref(row)} className="block">
                        {col.render(row)}
                      </Link>
                    ) : (
                      col.render(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="space-y-3 md:hidden">
        {rows.map((row) => {
          const inner = (
            <div className="rounded-card border border-line bg-card p-4 shadow-card">
              {columns
                .filter((c) => !c.desktopOnly)
                .map((col) => (
                  <div
                    key={col.key}
                    className="flex items-start justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
                  >
                    <span className="pt-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                      {col.header}
                    </span>
                    <span className="min-w-0 text-right text-sm">{col.render(row)}</span>
                  </div>
                ))}
            </div>
          );
          return rowHref ? (
            <Link key={row.id} href={rowHref(row)} className="block">
              {inner}
            </Link>
          ) : (
            <div key={row.id}>{inner}</div>
          );
        })}
      </div>
    </>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v) sp.set(k, v);
    }
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };

  return (
    <nav
      className="mt-4 flex items-center justify-between gap-3"
      aria-label="Sahifalash"
    >
      <p className="text-xs text-ink-soft">
        Jami <b className="text-ink">{total}</b> ta yozuv · {page}/{totalPages}-sahifa
      </p>
      <div className="flex items-center gap-1.5">
        <PaginationLink href={href(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="h-4 w-4" />
        </PaginationLink>
        <PaginationLink href={href(page + 1)} disabled={page >= totalPages}>
          <ChevronRight className="h-4 w-4" />
        </PaginationLink>
      </div>
    </nav>
  );
}

function PaginationLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-ink-soft/40">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-card text-ink transition hover:border-brand/50 hover:bg-surface"
    >
      {children}
    </Link>
  );
}
