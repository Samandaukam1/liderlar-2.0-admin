import { Brain } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { getActiveStyleProfile } from "@/lib/sales/repository";
import { getSalesSettings } from "@/lib/sales/settings";
import { bucketLabel } from "@/lib/sales/recency";
import type { StyleProfile } from "@/lib/sales/style";
import { formatDate } from "@/lib/utils";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { RecomputeStyleForm } from "./recompute-style-form";

export const metadata = { title: "AI Sotuv — Uslub" };
export const dynamic = "force-dynamic";

const pct = (value: number) => `${Math.round(value * 100)}%`;

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
}

export default async function SalesStylePage() {
  const ctx = await requirePermission("sales.view");
  const canLearn = hasPermission(ctx.roles, "sales.learn");

  const [row, settings] = await Promise.all([getActiveStyleProfile(), getSalesSettings()]);
  const profile = row ? (row.profile as unknown as StyleProfile) : null;

  return (
    <div>
      <PageHeader
        title="Uslub"
        description="Sotuvchining yozish uslubi — faktlardan alohida o‘lchanadi."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Uslub" }]}
        actions={canLearn ? <RecomputeStyleForm /> : null}
      />
      <SalesTabs active="style" />
      <NoAutoReplyNotice />

      {/* Talab 6: fakt va uslub ajratilgani ochiq aytiladi. */}
      <p className="mb-6 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
        <strong className="font-bold text-ink">Fakt bu yerda saqlanmaydi.</strong> Uslub
        profiliga tushadigan har bir matnda sonlar <code>{"{SON}"}</code> ga
        almashtiriladi, salomlashish va CTA iboralari esa qat’iy lug‘atdan
        olinadi. Shuning uchun bu sahifada haqiqiy narx, sana yoki mijoz ismi
        bo‘lishi mumkin emas — ular Knowledge Base tomonida.
      </p>

      <section className="mb-6 rounded-card border border-line bg-card p-5">
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Yangilik og‘irliklari
        </h2>
        <div className="flex flex-wrap gap-2">
          {settings.recencyBuckets.map((bucket) => (
            <Badge key={`${bucket.maxAgeDays}-${bucket.weight}`} accent="sky">
              {bucketLabel(bucket, settings.recencyBuckets)} → {bucket.weight.toFixed(2)}
            </Badge>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-soft">
          Yaqinda yozilgan xabar uslubga kuchliroq ta’sir qiladi. Qiymatlar
          Sozlamalar sahifasidan o‘zgartiriladi.
        </p>
      </section>

      {!row || !profile ? (
        <EmptyState
          icon={<Brain className="h-7 w-7" />}
          title="Uslub profili hali yo‘q"
          description="Chiquvchi xabarlar yig‘ilgach, “Uslubni qayta hisoblash” tugmasi orqali birinchi profilni yarating."
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-soft">
            {row.sampleMessageCount} ta chiquvchi xabar ({row.sampleConversationCount} ta
            suhbat) asosida, og‘irlangan hajm {row.weightedSample}. Hisoblangan:{" "}
            {formatDate(row.computedAt, true)}.
          </p>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Murojaat shakli"
              value={profile.address.form}
              hint={`siz ${pct(profile.address.sizShare)} · sen ${pct(profile.address.senShare)}`}
            />
            <Metric
              label="Ohang"
              value={profile.tone.label}
              hint={`rasmiylik ${profile.tone.formalityScore}`}
            />
            <Metric
              label="Gap uzunligi"
              value={`${profile.sentence.averageWords} so‘z`}
              hint={`xabarda ${profile.sentence.averageSentencesPerMessage} gap · ${profile.sentence.averageChars} belgi`}
            />
            <Metric
              label="Yozuv"
              value={profile.script.dominant}
              hint={`lotin ${pct(profile.script.latinShare)} · kirill ${pct(profile.script.cyrillicShare)}`}
            />
            <Metric
              label="Salomlashish"
              value={pct(profile.greeting.usageRate)}
              hint={profile.greeting.top.map((p) => p.phrase).join(", ") || "—"}
            />
            <Metric
              label="Emoji"
              value={pct(profile.emoji.usageRate)}
              hint={`xabarda ${profile.emoji.perMessage} ta · ${profile.emoji.top.map((e) => e.phrase).join(" ") || "—"}`}
            />
            <Metric
              label="CTA"
              value={pct(profile.cta.usageRate)}
              hint={profile.cta.top.map((p) => p.phrase).join(", ") || "—"}
            />
            <Metric
              label="Tinish belgilari"
              value={`${profile.punctuation.averageMarksPerMessage} ta`}
              hint={`savol ${pct(profile.punctuation.questionRate)} · undov ${pct(profile.punctuation.exclamationRate)}`}
            />
          </section>

          <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-card border border-line bg-card p-5">
              <h3 className="mb-1 font-display text-base font-semibold text-ink">
                Narxni aytish usuli
              </h3>
              <p className="mb-3 text-xs text-ink-soft">
                Xabarlarning {pct(profile.price.mentionRate)} qismida narx tilga olinadi.
                Sonlar maskalangan.
              </p>
              {profile.price.templates.length === 0 ? (
                <p className="text-sm text-ink-soft">Shablon topilmadi.</p>
              ) : (
                <ul className="space-y-1.5">
                  {profile.price.templates.map((template) => (
                    <li
                      key={template}
                      className="rounded-[10px] bg-surface px-3 py-2 text-sm text-ink"
                    >
                      {template}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-card border border-line bg-card p-5">
              <h3 className="mb-1 font-display text-base font-semibold text-ink">
                E’tirozga javob
              </h3>
              <p className="mb-3 text-xs text-ink-soft">
                Xabarlarning {pct(profile.objection.responseRate)} qismida yumshatuvchi
                ochqich ishlatiladi.
              </p>
              {profile.objection.openers.length === 0 ? (
                <p className="text-sm text-ink-soft">Ochqich topilmadi.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {profile.objection.openers.map((opener) => (
                    <Badge key={opener.phrase} accent="peach">
                      {opener.phrase} · {pct(opener.share)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
