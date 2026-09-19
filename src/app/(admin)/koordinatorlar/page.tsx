import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { loadCoordinatorDashboard } from "@/lib/coordinators/dashboard";
import { getCoordinatorBotStatus, isCoordinatorBotConfigured } from "@/lib/coordinators/bot-api";
import { formatSom } from "@/lib/coordinators/bot-messages";
import { RegionMapPanel } from "./region-map-panel";
import { CoordinatorManager } from "./coordinator-manager";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCoordinatorSettings } from "@/lib/coordinators/settings";

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

  const db = createSupabaseAdminClient();
  const [dashboard, botStatus, settings, coordinatorRows, regionRows] = await Promise.all([
    loadCoordinatorDashboard(),
    isCoordinatorBotConfigured() ? getCoordinatorBotStatus() : Promise.resolve(null),
    getCoordinatorSettings(),
    db
      .from("coordinators")
      .select(
        "id, full_name, photo_url, region_id, phone, public_phone, show_phone_publicly, " +
          "public_email, bio, telegram_user_id, telegram_username, status, backup_priority, " +
          "daily_lead_limit, is_active, regions(name)",
      )
      .eq("is_active", true)
      .order("full_name"),
    db.from("regions").select("id, name").order("sort_order"),
  ]);

  const coordinators = ((coordinatorRows.data ?? []) as unknown as Record<string, unknown>[]).map(
    (row) => ({
      id: row.id as string,
      fullName: (row.full_name as string) ?? "",
      photoUrl: (row.photo_url as string | null) ?? null,
      regionId: (row.region_id as string | null) ?? null,
      regionName: ((row.regions as { name?: string } | null)?.name) ?? null,
      phone: (row.phone as string | null) ?? null,
      publicPhone: (row.public_phone as string | null) ?? null,
      showPhonePublicly: row.show_phone_publicly === true,
      publicEmail: (row.public_email as string | null) ?? null,
      bio: (row.bio as string | null) ?? null,
      /*
       * FAQAT BOR-YO'QLIGI uzatiladi, raqamning O'ZI emas.
       *
       * Telegram id ichki identifikator: uni brauzerga yuborish
       * keraksiz va u ekran surati orqali tarqalishi mumkin.
       */
      hasTelegram: row.telegram_user_id != null,
      telegramUsername: (row.telegram_username as string | null) ?? null,
      status: (row.status as string) ?? "active",
      backupPriority: (row.backup_priority as number) ?? 100,
      dailyLeadLimit: (row.daily_lead_limit as number | null) ?? null,
      isActive: row.is_active === true,
    }),
  );

  const regions = (regionRows.data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
  }));

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

      {/* --- Tayyorlik ro'yxati --- */}
      {!dashboard.routingEnabled ? (
        <section className="mb-5 rounded-card border border-line bg-card p-5 shadow-card">
          <h2 className="mb-2 font-display text-base font-semibold text-ink">
            Marshrutlashni yoqish uchun tayyorlik
          </h2>
          <ul className="space-y-1 text-sm">
            <Check ok={isCoordinatorBotConfigured()} label="Coordinator Bot tokeni sozlangan" />
            <Check
              ok={Boolean(botStatus?.webhookUrl)}
              label="Bot webhook ulangan"
              hint={botStatus?.lastError ?? undefined}
            />
            <Check
              ok={dashboard.readiness.activeCoordinators > 0}
              label={`Faol koordinator: ${dashboard.readiness.activeCoordinators}`}
            />
            <Check
              ok={dashboard.readiness.coordinatorsWithTelegram > 0}
              label={`Telegram ID bor: ${dashboard.readiness.coordinatorsWithTelegram}`}
            />
            <Check
              ok={dashboard.readiness.coordinatorsWithRegion > 0}
              label={`Hududi bor: ${dashboard.readiness.coordinatorsWithRegion}`}
            />
            <Check
              ok={dashboard.readiness.regionsCovered > 0}
              label={`Qamralgan hudud: ${dashboard.readiness.regionsCovered} / ${dashboard.readiness.regionsTotal}`}
            />
          </ul>
          {dashboard.readiness.blockers.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-line pt-2">
              {dashboard.readiness.blockers.map((b) => (
                <li key={b} className="text-xs text-coral">• {b}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 border-t border-line pt-2 text-xs text-ink-soft">
              Hammasi tayyor. Marshrutlashni quyidan yoqishingiz mumkin.
            </p>
          )}
        </section>
      ) : null}

      <RegionMapPanel regions={dashboard.regions} />

      {canManage ? (
        <div className="mt-6">
          <CoordinatorManager
            coordinators={coordinators}
            regions={regions}
            routingEnabled={dashboard.routingEnabled}
            defaultTarget={settings.defaultDailyTarget}
          />
        </div>
      ) : null}

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

function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden>{ok ? "✓" : "✗"}</span>
      <span>
        <span className={ok ? "text-ink" : "text-ink-soft"}>{label}</span>
        {/* Holat rangdan tashqari belgi bilan ham beriladi. */}
        <span className="sr-only">{ok ? " — tayyor" : " — tayyor emas"}</span>
        {hint ? <span className="ml-2 text-[11px] text-coral">{hint}</span> : null}
      </span>
    </li>
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
