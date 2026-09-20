import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { loadMehrDashboard } from "@/lib/mehr/dashboard";
import { getMehrFlags } from "@/lib/mehr/flags";
import { ReviewQueue } from "./review-queue";

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

  const [{ stats, queue }, flags] = await Promise.all([loadMehrDashboard(), getMehrFlags()]);

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

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-soft">
        Tekshiruv navbati
      </h2>
      <ReviewQueue items={queue} canReview={canReview} />
    </div>
  );
}
