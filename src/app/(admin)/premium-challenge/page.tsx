import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { challengeEnded, loadFinalizedChallenges, loadLiveStandings } from "@/lib/challenge/daily-service";
import { formatTashkent, tashkentToday } from "@/lib/tashkent-day";

export const metadata = { title: "Premium Challenge va VIP tarixi" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; accent: "green" | "amber" | "neutral" | "sky" }> = {
  granted: { text: "VIP berildi", accent: "green" },
  duplicate: { text: "Avval berilgan", accent: "sky" },
  no_account: { text: "Akkaunt yo‘q", accent: "amber" },
  none: { text: "—", accent: "neutral" },
};

const SOURCE_LABEL: Record<string, string> = {
  admin: "Admin",
  daily_challenge: "Kunlik challenge",
  referral: "Referal",
};

/**
 * KUNLIK PREMIUM CHALLENGE + VIP KUNLARI TARIXI.
 *
 * SQL Editor'siz kuzatish: bugungi joriy natija, yakunlangan kunlar
 * (muzlatilgan natija va mukofot holati) va barcha manbalardan berilgan
 * VIP kunlari.
 */
export default async function PremiumChallengePage() {
  await requirePermission("vip.view");

  const today = tashkentToday();
  const db = createSupabaseAdminClient();

  const [live, finalized, grantsRes] = await Promise.all([
    loadLiveStandings(today, 10),
    loadFinalizedChallenges(30),
    db
      .from("vip_grants")
      .select("id, profile_id, days, source, reason, period_end_after, created_at, profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const grants = (grantsRes.data ?? []) as unknown as {
    id: string;
    days: number;
    source: string;
    reason: string | null;
    period_end_after: string | null;
    created_at: string;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  }[];

  const todayClosed = challengeEnded(today, new Date());

  return (
    <div className="space-y-8">
      <PageHeader
        title="Premium Challenge va VIP tarixi"
        description="Har kuni 09:00–19:00 (Toshkent). G‘oliblar: 1-o‘rin 30, 2-o‘rin 20, 3-o‘rin 10 kun VIP."
        breadcrumbs={[{ label: "Liderlar VIP" }, { label: "Premium Challenge" }]}
      />

      <section className="rounded-lg border border-border-soft bg-paper p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold text-ink">Bugun · {today}</h2>
          <Badge accent={todayClosed ? "neutral" : "green"}>
            {todayClosed ? "Yopildi — yakunlash kutilmoqda/yakunlandi" : "Joriy natija (yakuniy emas)"}
          </Badge>
        </div>
        {live.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Hozircha sanalgan ko‘rish yo‘q.</p>
        ) : (
          <ol className="mt-3 divide-y divide-border-soft text-sm">
            {live.map((row) => (
              <li key={row.candidateId} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">
                  <strong className="tabular-nums">{row.place}.</strong>{" "}
                  <Link href={`/candidates/${row.candidateId}`} className="hover:text-brand hover:underline">
                    {row.name}
                  </Link>
                </span>
                <span className="shrink-0 tabular-nums text-ink-soft">{row.views} ko‘rish</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-lg border border-border-soft bg-paper p-5">
        <h2 className="font-bold text-ink">Yakunlangan kunlar (oxirgi 30 kun)</h2>
        {finalized.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Hali yakunlangan bellashuv yo‘q.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {finalized.map((day) => (
              <div key={day.date} className="rounded-md border border-border-soft p-3">
                <p className="text-sm font-bold text-ink">
                  {day.date}{" "}
                  <span className="font-normal text-ink-soft">
                    · ishtirokchi: {day.participants} · yakunlandi: {formatTashkent(day.finalizedAt)}
                  </span>
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {day.results.slice(0, 5).map((r) => {
                    const status = STATUS_LABEL[r.rewardStatus] ?? STATUS_LABEL.none;
                    return (
                      <li key={r.position} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <strong className="tabular-nums">{r.position}.</strong> {r.name}
                          <span className="text-ink-soft"> · {r.views} ko‘rish</span>
                        </span>
                        <span className="flex items-center gap-2">
                          {r.rewardDays > 0 && <span className="text-xs text-ink-soft">+{r.rewardDays} kun</span>}
                          <Badge accent={r.deferredGranted ? "green" : status.accent}>
                            {r.deferredGranted ? "Akkaunt ochilgach berildi" : status.text}
                          </Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border-soft bg-paper p-5">
        <h2 className="font-bold text-ink">VIP kunlari tarixi (oxirgi 50)</h2>
        {grants.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Hali berilmagan.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border-soft text-sm">
            {grants.map((g) => {
              const profile = Array.isArray(g.profiles) ? g.profiles[0] : g.profiles;
              return (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <strong>{profile?.full_name ?? "—"}</strong>{" "}
                    <span className="text-ink-soft">· {SOURCE_LABEL[g.source] ?? g.source}</span>
                    {g.reason && <span className="block text-xs text-ink-soft">{g.reason}</span>}
                  </span>
                  <span className="text-right text-xs text-ink-soft">
                    <strong className="text-ink">+{g.days} kun</strong> · {formatTashkent(g.created_at)}
                    {g.period_end_after && <span className="block">tugaydi: {formatTashkent(g.period_end_after)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
