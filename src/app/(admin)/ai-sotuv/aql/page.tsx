import { AlertTriangle, Database, MessageSquare, Shield, TrendingUp } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { formatDate } from "@/lib/utils";
import {
  countFaq,
  getActiveMiningRun,
  getLatestCompletedRun,
  getQueueSnapshot,
  listFaq,
  listKnowledgeConflicts,
  listMiningRuns,
  listObjections,
  listQuarantinedKnowledge,
  listStyleProfiles,
} from "@/lib/sales/mining/intelligence-repo";
import { COVERAGE_LABELS } from "@/lib/sales/mining/coverage";
import { FACT_KIND_LABELS, type FactKind } from "@/lib/sales/knowledge-validity";
import { LEAD_WEIGHT_BASIS_NOTE } from "@/lib/sales/flow/lead-score";
import { SalesTabs, NoAutoReplyNotice } from "../sales-tabs";
import { MiningRunner } from "./mining-runner";
import { ConflictResolver } from "./conflict-resolver";
import { StyleActivator } from "./style-activator";

export const metadata = { title: "AI Sotuv — Sotuv aqli" };
export const dynamic = "force-dynamic";

/**
 * SOTUV AQLI (42-band).
 *
 * BU SAHIFA HECH NARSANI QAYTA HISOBLAMAYDI. U faqat oxirgi
 * QAZISH YUGURISHI saqlagan natijani ko'rsatadi va har son
 * yonida uning MA'NOSI yoziladi.
 *
 * Ikki qoida qat'iy:
 *   · qamrov `partial` bo'lsa, bu KATTA qilib aytiladi —
 *     "eng ko'p so'ralgan savol" qisman ma'lumotdan chiqqan
 *     bo'lsa, uni to'liq deb ko'rsatish yolg'on bo'lardi;
 *   · foiz namuna hajmisiz ko'rsatilmaydi.
 */
export default async function SalesIntelligencePage() {
  const ctx = await requirePermission("sales.view");
  const canLearn = hasPermission(ctx.roles, "sales.learn");
  const canManage = hasPermission(ctx.roles, "sales.manage");

  const [
    activeRun,
    latestRun,
    runs,
    faqCounts,
    topFaq,
    unansweredFaq,
    objections,
    conflicts,
    quarantined,
    styleProfiles,
    queue,
  ] = await Promise.all([
    getActiveMiningRun(),
    getLatestCompletedRun(),
    listMiningRuns(5),
    countFaq(),
    listFaq({ limit: 20 }),
    listFaq({ onlyUnanswered: true, limit: 10 }),
    listObjections(20),
    listKnowledgeConflicts("open"),
    listQuarantinedKnowledge(30),
    listStyleProfiles(5),
    getQueueSnapshot(),
  ]);

  const activeStyle = styleProfiles.find((profile) => profile.isActive) ?? null;
  const draftStyle = styleProfiles.filter((profile) => profile.status === "draft");

  return (
    <div>
      <PageHeader
        title="Sotuv aqli"
        description="Saqlangan suhbatlardan qazib olingan real savollar, e’tirozlar va uslub."
        breadcrumbs={[{ label: "AI Sotuv", href: "/ai-sotuv" }, { label: "Sotuv aqli" }]}
      />
      <SalesTabs active="intelligence" />
      <NoAutoReplyNotice />

      {/* ---------------------- QAMROV — eng tepada ---------------------- */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
          <Database className="h-4 w-4" /> Ma’lumot qamrovi
        </h2>

        {latestRun == null ? (
          <p className="rounded-card border border-line bg-surface px-4 py-4 text-sm text-ink-soft">
            Hali birorta qazish yugurishi tugallanmagan.{" "}
            <b>Quyidagi raqamlar o‘lchanmagan</b> — ular faqat yugurishdan keyin paydo bo‘ladi.
          </p>
        ) : (
          <div className="rounded-card border border-line bg-card p-4 shadow-card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge accent={latestRun.coverageStatus === "full" ? "mint" : "coral"}>
                Qamrov: {COVERAGE_LABELS[latestRun.coverageStatus]}
              </Badge>
              <span className="text-xs text-ink-soft">
                {formatDate(latestRun.finishedAt ?? latestRun.createdAt)} da hisoblangan
              </span>
            </div>

            {latestRun.coverageStatus !== "full" ? (
              <p className="mb-3 rounded-card border border-coral/40 bg-coral/5 px-3 py-2 text-xs text-ink">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                <b>Quyidagi raqamlar to‘liq tarixdan emas.</b> {latestRun.coverageNote}
              </p>
            ) : null}

            <dl className="grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Topilgan suhbat" value={latestRun.conversationsDiscovered} />
              <Stat label="Ishlangan suhbat" value={latestRun.conversationsProcessed} />
              <Stat label="Topilgan xabar" value={latestRun.messagesDiscovered} />
              <Stat label="Ishlangan xabar" value={latestRun.messagesProcessed} />
              <Stat label="Kiruvchi" value={latestRun.incoming} />
              <Stat label="Inson javobi" value={latestRun.humanOutbound} />
              <Stat label="AI javobi" value={latestRun.aiOutbound} />
              <Stat label="Matnsiz media" value={latestRun.mediaOnly} />
              <Stat label="O‘chirilgan" value={latestRun.deleted} />
              <Stat label="O‘tkazib yuborilgan" value={latestRun.skipped} />
              <Stat
                label="Xato batch"
                value={latestRun.failedBatches.length}
                accent={latestRun.failedBatches.length > 0}
              />
              <Stat label="Batch" value={latestRun.currentBatch} />
            </dl>

            {latestRun.earliestMessageAt && latestRun.latestMessageAt ? (
              <p className="mt-3 text-xs text-ink-soft">
                Vaqt oralig‘i: <b>{formatDate(latestRun.earliestMessageAt)}</b> —{" "}
                <b>{formatDate(latestRun.latestMessageAt)}</b>. Bu <b>saqlangan</b> tarix;
                Telegram akkauntining barcha eski yozishmalari deb olinmaydi.
              </p>
            ) : null}

            {latestRun.failedBatches.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-ink-soft">
                {latestRun.failedBatches.slice(0, 5).map((batch) => (
                  <li key={batch.batchIndex}>
                    Batch #{batch.batchIndex}: {batch.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </section>

      {/* ---------------------- YUGURISHNI BOSHLASH ---------------------- */}
      {canLearn ? (
        <section className="mb-6">
          <MiningRunner activeRun={activeRun} runs={runs} />
        </section>
      ) : null}

      {/* -------------------------- ZIDDIYATLAR -------------------------- */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
          <Shield className="h-4 w-4" /> Bilim ziddiyatlari
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Bir mavzuda qarama-qarshi tasdiqlangan javoblar. <b>Ikkalasi ham</b> avtomatik
          javobda ishlatilmaydi — aks holda mijoz bugun “mumkin”, ertaga “mumkin emas”
          eshitardi.
        </p>
        {conflicts.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-4 text-sm text-ink-soft">
            Ochiq ziddiyat yo‘q.
          </p>
        ) : (
          <ConflictResolver conflicts={conflicts} canManage={canManage} />
        )}
      </section>

      {/* --------------------- KARANTINDAGI BILIM ------------------------ */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-ink">
          Tasdiqlangan, lekin javobda ishlatilmayotgan bilim
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Bu yozuvlar <b>tasdiqlangan</b>, lekin turi yoki muddati sabab mijozga
          aytilmaydi. Masalan tugash sanasi yo‘q “muddatli taklif” va bir mijozga
          berilgan “bajariladigan va’da”.
        </p>
        {quarantined.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-4 text-sm text-ink-soft">
            Karantinda yozuv yo‘q.
          </p>
        ) : (
          <ul className="space-y-2">
            {quarantined.slice(0, 12).map((row) => (
              <li key={row.id} className="rounded-card border border-line bg-card p-3 text-xs">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge accent="coral">
                    {FACT_KIND_LABELS[row.factKind as FactKind] ?? row.factKind}
                  </Badge>
                  {row.conflictStatus === "conflicted" ? (
                    <Badge accent="coral">Ziddiyatli</Badge>
                  ) : null}
                  {row.supersededAt ? <Badge accent="neutral">Almashtirilgan</Badge> : null}
                  {row.factKind === "temporary_offer" && !row.validUntil ? (
                    <span className="text-ink-soft">tugash sanasi yo‘q</span>
                  ) : null}
                </div>
                {row.question ? (
                  <p className="font-semibold text-ink">{row.question}</p>
                ) : null}
                <p className="text-ink-soft">{row.answer.slice(0, 220)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------ FAQ ------------------------------ */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
          <MessageSquare className="h-4 w-4" /> Real savollar (TOP-20)
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Jami <b>{faqCounts.total}</b> klaster: {faqCounts.draft} qoralama,{" "}
          {faqCounts.approved} tasdiqlangan, {faqCounts.unanswered} javobsiz. Tartib{" "}
          <b>suhbat soni</b> bo‘yicha — bitta mijozning o‘n takrori ro‘yxat boshiga
          chiqmasligi uchun.
        </p>

        {topFaq.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-4 text-sm text-ink-soft">
            Hali savol qazilmagan. Yuqoridagi tugma bilan qazish yugurishini boshlang.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line bg-card">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="border-b border-line bg-surface text-left text-ink-soft">
                <tr>
                  <th className="px-3 py-2 font-semibold">Savol</th>
                  <th className="px-3 py-2 font-semibold">Turi</th>
                  <th className="px-3 py-2 text-right font-semibold">Suhbat</th>
                  <th className="px-3 py-2 text-right font-semibold">Xabar</th>
                  <th className="px-3 py-2 font-semibold">Javob</th>
                </tr>
              </thead>
              <tbody>
                {topFaq.map((row) => (
                  <tr key={row.id} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-ink">{row.canonicalQuestion}</p>
                      {row.variants.length > 0 ? (
                        <p className="mt-0.5 text-ink-soft">
                          {row.variants.slice(0, 3).join(" · ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{row.category}</td>
                    <td className="px-3 py-2 text-right font-bold text-ink">
                      {row.conversationCount}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-soft">{row.messageCount}</td>
                    <td className="px-3 py-2">
                      <Badge accent={row.answerStatus === "approved_answer" ? "mint" : "coral"}>
                        {row.answerStatus === "approved_answer" ? "bor" : "yo‘q"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {unansweredFaq.length > 0 ? (
          <div className="mt-3 rounded-card border border-coral/40 bg-coral/5 p-3 text-xs">
            <p className="mb-1 font-semibold text-ink">
              Eng ko‘p so‘raladigan, lekin javobi yo‘q savollar
            </p>
            <ul className="space-y-0.5 text-ink-soft">
              {unansweredFaq.map((row) => (
                <li key={row.id}>
                  {row.canonicalQuestion} — {row.conversationCount} ta suhbat
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* --------------------------- E'TIROZLAR -------------------------- */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
          <TrendingUp className="h-4 w-4" /> E’tirozlar
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Bitta xabarda bir nechta e’tiroz bo‘lishi mumkin, shuning uchun toifalar
          yig‘indisi xabarlar sonidan ko‘p bo‘lishi normal. <b>Strategiya</b> — qanday
          javob berish; <b>fakt</b> esa har doim tasdiqlangan bilimdan olinadi.
        </p>
        {objections.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-4 text-sm text-ink-soft">
            Hali e’tiroz qazilmagan.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {objections.map((row) => (
              <li key={row.id} className="rounded-card border border-line bg-card p-3 text-xs">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{row.label}</span>
                  <span className="text-ink-soft">
                    {row.conversationCount} suhbat / {row.messageCount} xabar
                  </span>
                </div>
                {row.strategy.length > 0 ? (
                  <ol className="ml-4 list-decimal space-y-0.5 text-ink-soft">
                    {row.strategy.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------- USLUB ----------------------------- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-ink">Uslub profillari</h2>
        <p className="mb-3 text-xs text-ink-soft">
          Uslub <b>faqat inson yozgan</b> xabarlardan o‘rganiladi — AI o‘z javobini
          namuna qilib olmaydi. Yangi profil har doim <b>qoralama</b> bo‘lib tug‘iladi va
          faollashtirishni odam qiladi.
        </p>
        {styleProfiles.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-4 text-sm text-ink-soft">
            Profil yo‘q.
          </p>
        ) : (
          <ul className="space-y-2">
            {styleProfiles.map((profile) => (
              <li key={profile.id} className="rounded-card border border-line bg-card p-3 text-xs">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{profile.name}</span>
                  <Badge accent={profile.isActive ? "mint" : "neutral"}>
                    {profile.isActive ? "FAOL" : profile.status}
                  </Badge>
                  <span className="text-ink-soft">{formatDate(profile.computedAt)}</span>
                </div>
                <p className="text-ink-soft">
                  {profile.humanMessageCount} ta inson xabari ·{" "}
                  {profile.conversationCount} ta suhbat ·{" "}
                  {profile.excludedMessageCount} tasi chiqarib tashlangan
                </p>
                {Object.keys(profile.excludedReasons).length > 0 ? (
                  <p className="mt-0.5 text-ink-soft">
                    Chiqarilgan:{" "}
                    {Object.entries(profile.excludedReasons)
                      .filter(([, count]) => Number(count) > 0)
                      .map(([reason, count]) => `${reason} ${count}`)
                      .join(", ")}
                  </p>
                ) : null}
                {profile.coverageNote ? (
                  <p className="mt-0.5 text-ink-soft">{profile.coverageNote}</p>
                ) : null}
                {canManage && !profile.isActive && profile.status === "draft" ? (
                  <div className="mt-2">
                    <StyleActivator
                      profileId={profile.id}
                      humanMessageCount={profile.humanMessageCount}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {activeStyle == null && draftStyle.length > 0 ? (
          <p className="mt-2 text-xs text-ink-soft">
            Qoralama bor, lekin faol profil yo‘q — bot uslub ko‘rsatmasisiz ishlayapti.
          </p>
        ) : null}
      </section>

      {/* ----------------------------- NAVBAT ---------------------------- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-ink">Javob navbati</h2>
        <p className="mb-3 text-xs text-ink-soft">
          Suhbat qulfi band bo‘lganda kiruvchi xabar <b>yo‘qolmaydi</b> — u shu navbatga
          tushadi va cron uni bajaradi.
        </p>
        <dl className="grid gap-3 text-xs sm:grid-cols-5">
          <Stat label="Navbatda" value={queue.queued} />
          <Stat label="Olingan" value={queue.claimed} />
          <Stat label="Kutmoqda" value={queue.waiting} />
          <Stat label="Qayta urinadi" value={queue.failedRetryable} />
          <Stat label="Dead-letter" value={queue.deadLetter} accent={queue.deadLetter > 0} />
        </dl>
      </section>

      <p className="rounded-card border border-line bg-surface px-4 py-3 text-xs text-ink-soft">
        <b>Lead balli haqida:</b> {LEAD_WEIGHT_BASIS_NOTE}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={accent ? "text-base font-bold text-coral" : "text-base font-bold text-ink"}>
        {value.toLocaleString("ru-RU").replace(/ /g, " ")}
      </dd>
    </div>
  );
}
