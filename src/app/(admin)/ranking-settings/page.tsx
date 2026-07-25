import { SlidersHorizontal } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/primitives";
import { StatusBadge, Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/utils";
import { ClosePeriodButton, PeriodForm, WeightsForm } from "./settings-forms";

export const metadata = { title: "Reyting sozlamalari" };
export const dynamic = "force-dynamic";

export default async function RankingSettingsPage() {
  const ctx = await requirePermission("rankings.manage");
  const canEditWeights = hasPermission(ctx.roles, "rankings.weights");
  const admin = createSupabaseAdminClient();

  const [{ data: periods }, { data: currentWeights }, { data: adjustments }] = await Promise.all([
    admin
      .from("ranking_periods")
      .select("id, name, starts_on, ends_on, status, is_current, published_at, closed_at")
      .order("starts_on", { ascending: false })
      .limit(12),
    admin
      .from("ranking_weights")
      .select("period_id, achievements, monthly_activity, active_leadership")
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("ranking_adjustments")
      .select("id, delta, category, reason, created_at, candidates(full_name), profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const current = (periods ?? []).find((p) => p.is_current);
  const weightsFor = (periodId: string) =>
    (currentWeights ?? []).find((w) => w.period_id === periodId) ?? {
      achievements: 40,
      monthly_activity: 25,
      active_leadership: 35,
    };

  return (
    <>
      <PageHeader
        title="Reyting sozlamalari"
        description="Davrlar, og‘irliklar va qo‘lda tuzatishlar tarixi"
        breadcrumbs={[{ label: "Reyting", href: "/rankings" }, { label: "Sozlamalar" }]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-sm font-bold text-ink">Joriy davr og‘irliklari</h2>
          {current ? (
            <WeightsForm
              periodId={current.id}
              weights={weightsFor(current.id)}
              canEdit={canEditWeights}
            />
          ) : (
            <EmptyState
              icon={<SlidersHorizontal className="h-7 w-7" />}
              title="Faol davr yo‘q"
              description="Quyida yangi reyting davri oching."
            />
          )}
          <div className="mt-5 rounded-[16px] bg-surface p-4 text-xs leading-relaxed text-ink-soft">
            <b className="text-ink">Formula:</b> Umumiy ball = Yutuqlar×W₁ + Oylik faollik×W₂ +
            Faol liderlik×W₃ (har bir kategoriya 0–100 shkalada) + qo‘lda tuzatishlar.
            Faol liderlikka tasdiqlangan profil ko‘rishlari, podcast qatnashuvi, jurnal
            maqolalari va tahririyat tasdiqlagan tashabbuslar ta’sir qiladi.
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-bold text-ink">Yangi reyting davri</h2>
          <PeriodForm />
        </Card>
      </div>

      <Card className="mt-5">
        <h2 className="mb-4 text-sm font-bold text-ink">Davrlar tarixi</h2>
        {(periods ?? []).length === 0 ? (
          <p className="py-4 text-sm text-ink-soft">Davrlar hali yaratilmagan</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {(periods ?? []).map((p) => {
              const w = weightsFor(p.id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-bold text-ink">
                      {p.name}
                      {p.is_current && <Badge accent="cyan">Joriy</Badge>}
                      {p.published_at && <Badge accent="mint">E’lon qilingan</Badge>}
                    </span>
                    <span className="block text-xs text-ink-soft">
                      {formatDate(p.starts_on)} — {formatDate(p.ends_on)} · og‘irliklar{" "}
                      {w.achievements}/{w.monthly_activity}/{w.active_leadership}
                    </span>
                  </span>
                  <StatusBadge status={p.status === "open" ? "active" : "archived"} />
                  {p.is_current && p.status === "open" && (
                    <ClosePeriodButton periodId={p.id} periodName={p.name} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-5">
        <h2 className="mb-4 text-sm font-bold text-ink">Qo‘lda tuzatishlar auditi</h2>
        {(adjustments ?? []).length === 0 ? (
          <p className="py-4 text-sm text-ink-soft">Tuzatishlar yo‘q</p>
        ) : (
          <ul className="space-y-2.5">
            {((adjustments ?? []) as unknown as Array<{
              id: string;
              delta: number;
              category: string;
              reason: string;
              created_at: string;
              candidates: { full_name: string } | null;
              profiles: { full_name: string } | null;
            }>).map((a) => (
              <li key={a.id} className="rounded-[14px] border border-amber/40 bg-amber/8 p-3.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-ink">{a.candidates?.full_name ?? "—"}</b>
                  <Badge accent="amber">
                    {a.delta > 0 ? "+" : ""}
                    {a.delta} ball · {a.category}
                  </Badge>
                  <span className="ml-auto text-[11px] text-ink-soft">
                    {a.profiles?.full_name ?? "—"} · {formatDate(a.created_at, true)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">Sabab: {a.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
