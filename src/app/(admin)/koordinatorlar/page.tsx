import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { loadCoordinatorDashboard } from "@/lib/coordinators/dashboard";
import { getCoordinatorBotStatus, isCoordinatorBotConfigured } from "@/lib/coordinators/bot-api";
import { formatSom } from "@/lib/coordinators/bot-messages";
import { RegionMapPanel } from "./region-map-panel";

export const metadata = { title: "Koordinatorlar" };
export const dynamic = "force-dynamic";

/**
 * KOORDINATORLAR — hududiy sotuv boshqaruvi.
 *
 * Savolga soniyalarda javob berishi kerak: bugun nechta lid, nechta
 * sotuv, qaysi hudud talabni bajardi, qayerda aralashuv kerak.
 */
export default async function CoordinatorsPage() {
  const ctx = await requirePermission("coordinators.view");
  const canManage = hasPermission(ctx.roles, "coordinators.manage");

  const [dashboard, botStatus] = await Promise.all([
    loadCoordinatorDashboard(),
    isCoordinatorBotConfigured() ? getCoordinatorBotStatus() : Promise.resolve(null),
  ]);

  const { national, nominations } = dashboard;

  return (
    <div>
      <PageHeader
        title="Koordinatorlar"
        description="Hududiy sotuv va koordinatorlar boshqaruvi."
        breadcrumbs={[{ label: "Koordinatorlar" }]}
      />

      {/* Marshrutlash holati — birinchi ko'rinadigan narsa. */}
      <div
        className={`mb-5 rounded-card border px-4 py-3 text-xs ${
          dashboard.routingEnabled
            ? "border-mint/50 bg-mint/5 text-ink"
            : "border-line bg-surface text-ink-soft"
        }`}
      >
        <span className="font-bold text-ink">
          {dashboard.routingEnabled ? "🟢 Marshrutlash yoqiq" : "🔴 Marshrutlash o‘chiq"}
        </span>
        <span className="ml-2">
          {dashboard.routingEnabled
            ? "Yangi lidlar koordinatorlarga yuborilmoqda."
            : "Lidlar saqlanmoqda, lekin koordinatorlarga yuborilmayapti."}
        </span>
        <span className="ml-3">
          Bot:{" "}
          {!isCoordinatorBotConfigured() ? (
            <b className="text-coral">sozlanmagan</b>
          ) : botStatus?.webhookUrl ? (
            <b>@{botStatus.username} — webhook ulangan</b>
          ) : (
            <b className="text-amber">@{botStatus?.username ?? "?"} — webhook o‘rnatilmagan</b>
          )}
        </span>
      </div>

      {/* --- KPI --- */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Bugungi lidlar" value={national.leadsToday} />
        <Kpi label="Band qilingan" value={national.claimedToday} />
        <Kpi label="Tasdiqlangan sotuv" value={national.confirmedToday} />
        <Kpi
          label="Milliy talab"
          value={national.target == null ? "—" : `${national.confirmedToday} / ${national.target}`}
          hint={national.progress == null ? undefined : `${national.progress}%`}
        />
        <Kpi
          label="Talabni bajargan hududlar"
          value={`${national.regionsMetTarget} / ${dashboard.regions.length}`}
        />
        <Kpi label="Bugungi komissiya" value={formatSom(national.commissionToday)} />
      </div>

      <RegionMapPanel regions={dashboard.regions} />

      {/* --- Nominatsiyalar --- */}
      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <NominationCard
          icon="🏁"
          title="Eng birinchi talabni bajargan"
          winners={nominations.firstToTarget.winners.map((w) => w.coordinatorName)}
          explanation={nominations.firstToTarget.explanation}
          tied={nominations.firstToTarget.tied}
        />
        <NominationCard
          icon="🏆"
          title="Eng ko‘p sotuv qilgan"
          winners={nominations.mostSales.winners.map((w) => w.coordinatorName)}
          explanation={nominations.mostSales.explanation}
          tied={nominations.mostSales.tied}
        />
        <NominationCard
          icon="⚡"
          title="Eng samarali ishlagan"
          winners={nominations.mostEfficient.winners.map((w) => w.coordinatorName)}
          explanation={nominations.mostEfficient.explanation}
          tied={nominations.mostEfficient.tied}
        />
      </div>

      {/* --- Koordinatorlar jadvali --- */}
      <section className="mt-6 rounded-card border border-line bg-card p-5 shadow-card">
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Koordinatorlar natijasi — bugun
        </h2>
        {dashboard.coordinatorStats.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Hali koordinator kiritilmagan.{" "}
            {canManage ? "Ularni qo‘shguncha marshrutlash yoqilmaydi." : null}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-ink-soft">
                  <th className="pb-2">Koordinator</th>
                  <th className="pb-2">Band qilgan</th>
                  <th className="pb-2">Sotuv</th>
                  <th className="pb-2">Konversiya</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.coordinatorStats.map((stat) => (
                  <tr key={stat.coordinatorId} className="border-t border-line">
                    <td className="py-2 font-semibold text-ink">{stat.coordinatorName}</td>
                    <td className="py-2 text-ink-soft">{stat.claimedLeads}</td>
                    <td className="py-2 text-ink-soft">{stat.confirmedSales}</td>
                    <td className="py-2 text-ink-soft">
                      {/* Maxraj ko'rsatiladi — foizning o'zi chalg'itadi. */}
                      {stat.claimedLeads > 0
                        ? `${stat.confirmedSales} / ${stat.claimedLeads}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- E'tibor talab qiladi --- */}
      {dashboard.attention.length > 0 ? (
        <section className="mt-6 rounded-card border border-amber/40 bg-amber/5 p-5">
          <h2 className="mb-2 font-display text-base font-semibold text-ink">
            🔔 E’tibor talab qiladi
          </h2>
          <ul className="space-y-1">
            {dashboard.attention.map((item) => (
              <li key={item} className="text-sm text-ink-soft">
                • {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-3 shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-ink">{value}</p>
      {hint ? <p className="text-[11px] text-ink-soft">{hint}</p> : null}
    </div>
  );
}

function NominationCard({
  icon,
  title,
  winners,
  explanation,
  tied,
}: {
  icon: string;
  title: string;
  winners: string[];
  explanation: string;
  tied: boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-card p-4 shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
        {icon} {title}
      </p>
      {winners.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">Bugun g‘olib yo‘q.</p>
      ) : (
        <p className="mt-2 font-display text-lg font-bold text-ink">
          {winners.join(", ")}
          {/* Teng natijada HAMMASI ko'rsatiladi — tasodifan bittasini
              tanlash qolganlarining ishini ko'rinmas qilardi. */}
          {tied ? <Badge accent="neutral"> teng natija</Badge> : null}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-soft">{explanation}</p>
    </div>
  );
}
