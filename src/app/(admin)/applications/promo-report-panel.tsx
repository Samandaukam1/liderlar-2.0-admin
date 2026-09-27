"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Input, Label } from "@/components/ui/primitives";

/**
 * PROMO KODLAR HISOBOTI — PDF.
 *
 * NEGA ALOHIDA PANEL: yuqoridagi qidiruv jadvalni filtrlaydi, bu
 * esa HUJJAT yaratadi. Ikkalasini bitta maydonga birlashtirsak,
 * "qidirdim — nega jadval o'zgarmadi?" degan savol tug'ilardi.
 *
 * Yuklab olish oddiy havola orqali: brauzerning o'zi faylni
 * oladi, sahifa qayta yuklanmaydi va katta PDF xotirada
 * ushlanmaydi.
 */
export function PromoReportPanel() {
  const [query, setQuery] = useState("");

  const href = `/api/export/promo-report${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`;

  return (
    <section className="mb-4 rounded-card border border-line bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Label htmlFor="promoQuery">Promo kod bo‘yicha hisobot</Label>
          <Input
            id="promoQuery"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Harflarni kiriting — masalan ALI"
            autoCapitalize="characters"
          />
        </div>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-[14px] bg-brand px-4 text-sm font-bold text-white transition hover:opacity-90"
        >
          <FileText className="h-4 w-4" aria-hidden />
          PDF yuklab olish
        </a>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
        Kiritilgan harflar bilan boshlanadigan promo kodlar va ularga{" "}
        <b>yozuvda o‘xshash</b> kodlar (0/O, 1/I, 5/S kabi chalkashishlar
        hisobga olinadi) bitta guruhga yig‘iladi. O‘xshash yozuvlar alohida
        ko‘rsatiladi — ularni birlashtirish qarori sizniki. Bo‘sh qoldirsangiz
        barcha kodlar chiqadi.
      </p>
    </section>
  );
}
