import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { getTestChatReadiness } from "@/lib/sales/repository";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { TestChat } from "./test-chat";

export const metadata = { title: "AI Sotuv — Sinov" };
export const dynamic = "force-dynamic";

/**
 * AI sotuvchini real mijozga ulashdan OLDINGI sinov maydoni.
 *
 * Sahifa `sales.view` bilan ochiladi (natijani ko'rish uchun), lekin
 * xabar yuborish `sales.learn` talab qiladi: har xabar pullik AI
 * chaqiruvi. Server action ham xuddi shu ruxsatni qayta tekshiradi —
 * UI dagi yashirish o'zi himoya emas.
 */
export default async function SalesSandboxPage() {
  const ctx = await requirePermission("sales.view");
  const canRun = hasPermission(ctx.roles, "sales.learn");

  const readiness = await getTestChatReadiness();
  const ready = readiness.approvedKnowledge > 0 || readiness.approvedPatterns > 0;

  return (
    <div>
      <PageHeader
        title="🧪 Sinov"
        description="AI sotuvchini panel ichida sinang — Telegram’ga hech narsa yuborilmaydi."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Sinov" }]}
      />
      <SalesTabs active="sandbox" />
      <NoAutoReplyNotice />

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          {
            label: "Tasdiqlangan bilim",
            value: readiness.approvedKnowledge,
            href: "/ai-sotuv/knowledge?status=approved",
          },
          {
            label: "Tasdiqlangan javob shabloni",
            value: readiness.approvedPatterns,
            href: "/ai-sotuv/javoblar",
          },
          {
            label: "Uslub profili",
            value: readiness.hasStyleProfile ? "aktiv" : "yo‘q",
            href: "/ai-sotuv/uslub",
          },
        ].map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-card border border-line bg-card p-4 transition hover:border-brand/40"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
              {card.label}
            </p>
            <p className="mt-1 text-xl font-bold text-ink">{card.value}</p>
          </Link>
        ))}
      </section>

      {/* Sinov FAQAT tasdiqlangan materialdan foydalanadi — qoralama emas. */}
      <p className="mb-5 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
        AI faqat <strong className="font-bold text-ink">tasdiqlangan</strong> bilim,
        tasdiqlangan javob shablonlari va aktiv uslub profilidan foydalanadi.
        Qoralama yozuvlar bu yerga kirmaydi. Har javob ostidagi diagnostika —
        haqiqiy retrieval natijasi: “3 ta knowledge” degani baza qaytargan uch
        yozuv, modelning o‘zi haqidagi bahosi emas.
      </p>

      {!ready ? (
        <p className="mb-5 flex flex-wrap items-center gap-2 rounded-card border border-peach/50 bg-peach/12 px-4 py-3 text-sm text-ink">
          <Badge accent="peach">Diqqat</Badge>
          Hali birorta bilim yoki javob shabloni tasdiqlanmagan. Sinov ishlaydi,
          lekin AI deyarli har savolda{" "}
          <b className="font-bold">MISSING_KNOWLEDGE</b> beradi — bu to‘g‘ri
          xatti-harakat, fakt o‘ylab topilmaydi.{" "}
          <Link href="/ai-sotuv/knowledge" className="font-semibold text-brand hover:underline">
            Bilimni tasdiqlash →
          </Link>
        </p>
      ) : null}

      <TestChat canRun={canRun} />

      <p className="mt-4 flex items-start gap-2 text-xs text-ink-soft">
        <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Bu sahifa Telegram’ga ulanmagan: sinov moduli Telegram transportini
          import ham qilmaydi va <code>sendMessage</code> himoyasi (oq ro‘yxat)
          o‘z joyida qoladi.
        </span>
      </p>
    </div>
  );
}
