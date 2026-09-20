import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { loadMehrDashboard } from "@/lib/mehr/dashboard";
import { getMehrFlags } from "@/lib/mehr/flags";
import { ReviewQueue } from "./review-queue";
import { BotSettings, type BotStatusView } from "./bot-settings";
import { getMemberBotStatus, isMemberBotConfigured } from "@/lib/member-bot/bot-api";

export const metadata = { title: "MEHR 365+" };
export const dynamic = "force-dynamic";

/**
 * MEHR 365+ — moderatsiya markazi.
 *
 * Bu sahifa bitta savolga javob beradi: BUGUN NIMANI TEKSHIRISH
 * KERAK. Statistika pastda, chunki u kundalik ish emas.
 */
export default async function MehrAdminPage() {
  const ctx = await requirePermission("mehr.view");
  const canReview = hasPermission(ctx.roles, "mehr.review");
  const canManageSettings = hasPermission(ctx.roles, "settings.manage");

  const [{ stats, queue }, flags, botStatus] = await Promise.all([
    loadMehrDashboard(),
    getMehrFlags(),
    // Telegram'ga so'rov — faqat token bor bo'lsa.
    isMemberBotConfigured() ? getMemberBotStatus() : Promise.resolve(null),
  ]);

  /*
   * QAYSI SOZLAMA YETISHMAYDI — FAQAT NOMLARI.
   *
   * Qiymatlar hech qachon brauzerga yuborilmaydi. Bu tekshiruv
   * serverda bajariladi va natijada faqat "bor / yo'q" qoladi.
   */
  const missingEnv = [
    ["MEMBER_TELEGRAM_BOT_TOKEN", process.env.MEMBER_TELEGRAM_BOT_TOKEN],
    ["MEMBER_TELEGRAM_WEBHOOK_SECRET", process.env.MEMBER_TELEGRAM_WEBHOOK_SECRET],
    /*
     * Bu ikkisi ADMIN PANEL MANZILIDAN kelib chiqadi, shuning
     * uchun `NEXT_PUBLIC_ADMIN_URL` bo'lsa yetarli. Alohida
     * o'zgaruvchilar faqat boshqa domen kerak bo'lgan holat
     * uchun qoldirilgan.
     */
    [
      "MEMBER_MINI_APP_URL yoki NEXT_PUBLIC_ADMIN_URL",
      process.env.MEMBER_MINI_APP_URL || process.env.NEXT_PUBLIC_ADMIN_URL,
    ],
    [
      "MEMBER_WEBHOOK_BASE_URL yoki NEXT_PUBLIC_ADMIN_URL",
      process.env.MEMBER_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_ADMIN_URL,
    ],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);

  const botView: BotStatusView = {
    configured: isMemberBotConfigured(),
    username: botStatus?.username ?? null,
    webhookUrl: botStatus?.webhookUrl ?? null,
    pendingUpdates: botStatus?.pendingUpdates ?? null,
    lastError: botStatus?.lastError ?? null,
    missingEnv,
  };

  const cards = [
    { label: "Volontyorlar", value: stats.volunteers, hint: "tasdiqlangan ishtiroki bor" },
    { label: "Ezgulik ishlari", value: stats.approvedActivities, hint: "tasdiqlangan" },
    { label: "Sertifikatlar", value: stats.certificates, hint: "amaldagi" },
    { label: "Taqdim etilgan ballar", value: stats.totalPoints, hint: "daftardan" },
  ];

  return (
    <div>
      <PageHeader
        title="MEHR 365+"
        description="Ezgulik ishlarini tekshirish, ball va sertifikatlarni boshqarish."
        breadcrumbs={[{ label: "MEHR 365+" }]}
        actions={
          stats.pendingReview > 0 ? (
            <Badge accent="amber">{stats.pendingReview} ta tekshiruv kutmoqda</Badge>
          ) : (
            <Badge accent="green">Navbat bo&apos;sh</Badge>
          )
        }
      />

      {/*
        BAYROQLAR HOLATI — ENG TEPADA.

        Tizim o'chiq turganda navbat bo'sh ko'rinadi va buni
        "ish yo'q" deb tushunish oson. Sabab ko'rinib tursin.
      */}
      {!flags.publicEnabled || !flags.pointsEnabled ? (
        <div className="mb-6 rounded-lg border border-amber/40 bg-amber/10 p-4 text-sm">
          <p className="font-bold text-[#946a10]">MEHR 365+ hali to&apos;liq yoqilmagan</p>
          <ul className="mt-2 space-y-1 text-ink-soft">
            {!flags.publicEnabled && <li>• Ommaviy sahifalar yopiq (mehr.public_enabled)</li>}
            {!flags.activityCreationEnabled && <li>• Tadbir yaratish yopiq (mehr.activity_creation_enabled)</li>}
            {!flags.qrCheckinEnabled && <li>• QR check-in yopiq (mehr.qr_checkin_enabled)</li>}
            {!flags.pointsEnabled && <li>• Ball berish yopiq (mehr.points_enabled)</li>}
            {!flags.certificatesEnabled && <li>• Sertifikatlar yopiq (mehr.certificates_enabled)</li>}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">
            Bayroqlar <strong>Sayt sozlamalari</strong> bo&apos;limidan yoqiladi.
          </p>
        </div>
      ) : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border-soft bg-paper p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{c.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {c.value.toLocaleString("uz-UZ")}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-soft">{c.hint}</p>
          </div>
        ))}
      </div>

      {canManageSettings && <BotSettings status={botView} flags={flags} />}

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-soft">
        Tekshiruv navbati
      </h2>
      <ReviewQueue items={queue} canReview={canReview} />
    </div>
  );
}
