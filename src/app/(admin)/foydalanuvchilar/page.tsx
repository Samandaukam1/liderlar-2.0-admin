import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/admin/badges";
import { loadAccountReport } from "@/lib/accounts/account-report";
import { isActivationEnabled } from "@/lib/accounts/activation-service";
import { AccountTable } from "./account-table";
import { ActivationToggle } from "./activation-toggle";
import type { AccountFilter } from "@/lib/accounts/account-types";

export const metadata = { title: "Foydalanuvchi akkauntlari" };
export const dynamic = "force-dynamic";

const FILTERS: AccountFilter[] = [
  "all",
  "unlinked",
  "pending",
  "linked",
  "telegram",
  "blocked",
  "attention",
];

/**
 * FOYDALANUVCHI AKKAUNTLARI.
 *
 * Bitta savolga javob beradi: KIM TIZIMGA KIRA OLADI.
 *
 * Ensiklopediyada ~minglab nomzod bor, lekin ularning
 * ko'pchiligida hisob yo'q — ya'ni ular MEHR'dan
 * foydalana olmaydi. Bu sahifa aynan shu farqni ko'rsatadi.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const ctx = await requirePermission("members.view");
  const canManage = hasPermission(ctx.roles, "members.manage");

  const params = await searchParams;
  const filter = (FILTERS as string[]).includes(params.filter ?? "")
    ? (params.filter as AccountFilter)
    : "all";

  const [report, activationEnabled] = await Promise.all([
    loadAccountReport({ filter, search: params.q, limit: 100 }),
    isActivationEnabled(),
  ]);

  const { counts } = report;

  const cards = [
    { label: "Jami nomzodlar", value: counts.totalCandidates, accent: "neutral" as const },
    { label: "Akkaunti mavjud", value: counts.linked, accent: "green" as const },
    { label: "Akkauntsiz", value: counts.unlinked, accent: "amber" as const },
    { label: "Aktivatsiya kutilmoqda", value: counts.activationPending, accent: "sky" as const },
    { label: "Telegram ulangan", value: counts.telegramLinked, accent: "mint" as const },
    { label: "Bloklangan", value: counts.blocked, accent: "coral" as const },
    { label: "E'tibor kerak", value: counts.needsAttention, accent: "coral" as const },
  ];

  return (
    <div>
      <PageHeader
        title="Foydalanuvchi akkauntlari"
        description="Nomzodlarning hisoblari: kimda bor, kim kutyapti, kim Telegramga ulangan."
        breadcrumbs={[{ label: "Foydalanuvchi akkauntlari" }]}
        actions={
          activationEnabled ? (
            <Badge accent="green">Faollashtirish yoqilgan</Badge>
          ) : (
            <Badge accent="amber">Faollashtirish o&apos;chiq</Badge>
          )
        }
      />

      {!activationEnabled && (
        <div className="mb-6 rounded-lg border border-amber/40 bg-amber/10 p-4 text-sm">
          <p className="font-bold text-[#946a10]">Yangi havola yaratib bo&apos;lmaydi</p>
          <p className="mt-1 text-ink-soft">
            <code className="font-mono">member.account_activation_enabled</code> o&apos;chiq.
            Mavjud hisoblar bundan ta&apos;sirlanmaydi — faqat yangi faollashtirish to&apos;silgan.
          </p>

          {/*
            Kalit MUAMMONING YONIDA turadi.

            Avval u faqat boshqa bo'limda bor edi va bu xabar
            "yoqing" deb aytardi-yu, qayerdan yoqishni
            ko'rsatmasdi.
          */}
          {canManage && (
            <div className="mt-3">
              <ActivationToggle enabled={false} />
            </div>
          )}
        </div>
      )}

      {activationEnabled && canManage && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-soft bg-paper px-4 py-3 text-sm">
          <span className="text-ink-soft">
            Faollashtirish yoqilgan — yangi havola yaratish mumkin.
          </span>
          <ActivationToggle enabled />
        </div>
      )}

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border-soft bg-paper p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{c.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {c.value.toLocaleString("uz-UZ")}
            </p>
          </div>
        ))}
      </div>

      {/*
        "E'TIBOR KERAK" — YARIM QOLGAN FAOLLASHTIRISH.

        Supabase Auth va Postgres alohida tizimlar va ular
        orasida bitta tranzaksiya yo'q. Taklifnoma ishlatilib,
        bog'lanish yiqilsa, bu holat YASHIRILMAYDI — admin uni
        ko'radi va qo'lda hal qiladi.
      */}
      {counts.needsAttention > 0 && (
        <div className="mb-6 rounded-lg border border-coral/40 bg-coral/10 p-4 text-sm">
          <p className="font-bold text-[#c43d3d]">
            {counts.needsAttention} ta faollashtirish yarim qolgan
          </p>
          <p className="mt-1 text-ink-soft">
            Havola ishlatilgan, lekin nomzod hisobga bog&apos;lanmagan. &laquo;E&apos;tibor
            kerak&raquo; filtridan ko&apos;ring.
          </p>
        </div>
      )}

      <AccountTable
        rows={report.rows}
        total={report.total}
        activeFilter={filter}
        search={params.q ?? ""}
        canManage={canManage}
        activationEnabled={activationEnabled}
      />
    </div>
  );
}
