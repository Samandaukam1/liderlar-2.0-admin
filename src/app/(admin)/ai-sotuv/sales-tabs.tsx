import Link from "next/link";
import { cn } from "@/lib/utils";
import { getSalesSettings } from "@/lib/sales/settings";
import { ROLLOUT_MODE_LABELS } from "@/lib/sales/flow/rollout";

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
  { key: "responses", label: "Javoblar", href: "/ai-sotuv/javoblar" },
  { key: "knowledge", label: "Knowledge Base", href: "/ai-sotuv/knowledge" },
  { key: "gaps", label: "Javobsiz savollar", href: "/ai-sotuv/savollar" },
  { key: "style", label: "Uslub", href: "/ai-sotuv/uslub" },
  { key: "sandbox", label: "🧪 Sinov", href: "/ai-sotuv/sinov" },
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
/**
 * AI SOTUV HOLATI — har sahifaning tepasida (23-band).
 *
 * ILGARI BU YERDA QOTIB QOLGAN MATN TURARDI: "0.1 rejimi: bot
 * mijozlarga avtomatik javob yozmaydi". Bot javob bera boshlagach
 * bu yozuv YOLG'ONGA aylandi — va aynan shu yozuvga qarab odam
 * "bot jim" deb o'ylab, sozlamani tekshirmasligi mumkin edi.
 *
 * Endi holat JONLI o'qiladi. Ikkala kalit ham ko'rsatiladi, chunki
 * ular boshqa-boshqa savolga javob beradi: "avto-javob yoqilganmi"
 * va "kimga".
 */
export async function NoAutoReplyNotice() {
  const settings = await getSalesSettings();
  const on = settings.flow.autoReplyEnabled;
  const mode = settings.rollout.mode;

  // Ikkovi ham kerak: sozlama yoqiq, lekin rejim "off" bo'lsa —
  // hech kimga yozilmaydi va buni aniq aytish kerak.
  const live = on && mode !== "off" && mode !== "test_only";

  return (
    <div
      className={cn(
        "mb-6 rounded-card border px-4 py-3 text-xs",
        live ? "border-mint/50 bg-mint/5 text-ink" : "border-line bg-surface text-ink-soft",
      )}
    >
      <span className="font-bold text-ink">
        {live ? "🟢 Avto-javob YOQIQ" : "🔴 Avto-javob o‘chiq"}
      </span>
      <span className="ml-2">
        Chiqarish: <b>{ROLLOUT_MODE_LABELS[mode]}</b>
        {mode === "percentage" ? ` (${settings.rollout.percentage}%)` : null}
        {mode === "allowlist"
          ? ` (${settings.rollout.allowlistChatIds.length} ta chat)`
          : null}
      </span>
      {on && !live ? (
        <span className="ml-2 text-ink-soft">
          — sozlama yoqiq, lekin chiqarish bosqichi hech kimni qamramaydi.
        </span>
      ) : null}
    </div>
  );
}

