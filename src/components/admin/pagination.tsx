"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * SAHIFALASH — JORIY FILTRLARNI O'ZI SAQLAB QOLADI.
 *
 * ILGARI har sahifa saqlanadigan parametrlarni QO'LDA sanab
 * berardi (`params={{ q, ...filters }}`). Yangi filtr qo'shilganda
 * uni o'sha ro'yxatga qo'shish unutilardi va nosozlik shunday
 * ko'rinardi: admin vaqt oralig'ini belgilaydi, "promo kodsizlar
 * tepada" ni bosadi, ikkinchi sahifaga o'tadi — va hammasi
 * o'chib, oddiy ro'yxat qaytadi. Hech qanday xato chiqmaydi.
 *
 * Endi manzil qatoridagi BARCHA parametrlar o'zi ko'chiriladi:
 * unutish mumkin bo'lgan ro'yxat umuman qolmadi. Shu sababli
 * `basePath` va `params` proplari ham olib tashlandi — ikkovi
 * ham shu bilimni takrorlardi.
 */
export function Pagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const href = (target: number) => {
    const next = new URLSearchParams(params.toString());
    if (target <= 1) next.delete("page");
    else next.set("page", String(target));
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Sahifalash">
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
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-card text-ink transition hover:border-brand/50 hover:text-brand"
    >
      {children}
    </Link>
  );
}
