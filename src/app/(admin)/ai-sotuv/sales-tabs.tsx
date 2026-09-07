import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * "AI Sotuv" bo'limining tab navigatsiyasi.
 *
 * Sidebar'da bitta yozuv turadi, ichki sahifalar esa tab sifatida
 * ko'rsatiladi — texnik topshiriqdagi tuzilma shunday.
 */

export const SALES_TABS = [
  { key: "dashboard", label: "Dashboard", href: "/ai-sotuv" },
  { key: "conversations", label: "Suhbatlar", href: "/ai-sotuv/suhbatlar" },
  { key: "learning", label: "O‘rganish", href: "/ai-sotuv/organish" },
  { key: "knowledge", label: "Knowledge Base", href: "/ai-sotuv/knowledge" },
  { key: "style", label: "Uslub", href: "/ai-sotuv/uslub" },
  { key: "settings", label: "Sozlamalar", href: "/ai-sotuv/sozlamalar" },
] as const;

export type SalesTabKey = (typeof SALES_TABS)[number]["key"];

export function SalesTabs({ active }: { active: SalesTabKey }) {
  return (
    <div className="mb-6 flex gap-1.5 overflow-x-auto pb-1">
      {SALES_TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition",
            tab.key === active
              ? "border-brand bg-brand text-white"
              : "border-line bg-card text-ink-soft hover:border-brand/40 hover:text-ink",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * 0.1 doirasini har sahifada bir xil aytadigan chiziq.
 * Bot javob yozmasligini foydalanuvchi taxmin qilib qolmasin.
 */
export function NoAutoReplyNotice() {
  return (
    <p className="mb-6 rounded-card border border-line bg-surface px-4 py-3 text-xs text-ink-soft">
      <strong className="font-bold text-ink">0.1 rejimi:</strong> bot mijozlarga
      avtomatik javob yozmaydi. U faqat suhbatlarni o‘qiydi, saqlaydi va
      tahlil qiladi. Avto-javob keyingi (0.2) bosqichda qo‘shiladi.
    </p>
  );
}
