import { ClipboardList } from "lucide-react";
import { PromoReportPanel } from "./promo-report-panel";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseListParams, listRange, PAGE_SIZE } from "@/lib/list";
import { parseTashkentDateTime } from "@/lib/tashkent-day";
import { ApplicationFilters } from "./application-filters";
import type { Application } from "@/lib/types";
import { APPLICATION_AGE_RANGES, APPLICATION_GENDER_LABELS, genderLabel } from "@/lib/application-fields";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, Pagination, type Column } from "@/components/admin/data-table";
import { DataTableToolbar } from "@/components/admin/toolbar";
import { StatusBadge, Avatar, Badge } from "@/components/admin/badges";
import { EmptyState } from "@/components/ui/feedback";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Arizalar" };
export const dynamic = "force-dynamic";

/**
 * So'rov quruvchisining shu sahifa ishlatadigan qismi.
 *
 * supabase-js ning to'liq tipi generiklarga to'la; bu yerda
 * faqat to'rtta usul kerak va tuzilmaviy tip ularni aniq
 * ko'rsatib turadi.
 */
interface ScopedQuery {
  eq(column: string, value: unknown): ScopedQuery;
  gte(column: string, value: string): ScopedQuery;
  lt(column: string, value: string): ScopedQuery;
  or(filter: string): ScopedQuery;
}

export default async function ApplicationsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("applications.view");
  const sp = await props.searchParams;
  const { page, q, filters } = parseListParams(sp, ["status", "gender", "age_range"]);
  const admin = createSupabaseAdminClient();

  const one = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : (value ?? "");

  /*
   * VAQT ORALIG'I — TOSHKENT DEVOR SOATI.
   *
   * Admin "kecha 17:30 dan" deb belgilaydi va Toshkent vaqtini
   * nazarda tutadi; `created_at` esa UTC da yotadi. Ikkovini
   * to'g'ridan-to'g'ri solishtirish besh soatlik xatoga olib
   * kelardi va buni sezish qiyin: ro'yxat baribir to'lgan
   * ko'rinadi, faqat kechqurungi arizalar tushib qolardi.
   *
   * Noto'g'ri qiymat "chegara yo'q" deb qaraladi: butun ro'yxatni
   * bo'sh ko'rsatishdan ko'ra filtrni e'tiborsiz qoldirish
   * yaxshiroq.
   */
  const fromIso = parseTashkentDateTime(one(sp.from));
  const toIso = parseTashkentDateTime(one(sp.to));
  const noPromoFirst = one(sp.promo) === "kodsiz";

  /*
   * Uchala so'rov (ro'yxat + ikki sanoq) BIR XIL chegarada
   * bo'lishi shart. Shartlarni uch joyga ko'chirsak, biri
   * unutilib, sanoq ro'yxatga mos kelmay qolardi.
   */
  const applyScope = <T,>(builder: T): T => {
    let next = builder as unknown as ScopedQuery;
    if (filters.status) next = next.eq("status", filters.status);
    if (filters.gender) next = next.eq("gender", filters.gender);
    if (filters.age_range) next = next.eq("age_range", filters.age_range);
    if (fromIso) next = next.gte("created_at", fromIso);
    // Yuqori chegara EKSKLYUZIV: aynan o'sha daqiqada kelgan ariza
    // ikkala oynaga ham tushib qolmasin.
    if (toIso) next = next.lt("created_at", toIso);
    if (q) {
      next = next.or(
        `full_name.ilike.%${q}%,phone.ilike.%${q}%,telegram.ilike.%${q}%,promo_code.ilike.%${q}%`,
      );
    }
    return next as unknown as T;
  };

  let query = applyScope(
    admin.from("applications").select("*, regions(name), categories(name)", { count: "exact" }),
  );

  /*
   * TARTIB: avval promo kodsizlar, keyin sana bo'yicha yangisi.
   *
   * `has_promo` — bazadagi hisoblanadigan ustun. `promo_code`
   * bo'yicha `nulls first` yetarli emas edi: "kod yo'q" ikki xil
   * yozilgan (null va bo'sh satr) va bo'sh satrlilar promo
   * kodlilar orasida qolib ketardi.
   */
  query = noPromoFirst
    ? query.order("has_promo", { ascending: true }).order("created_at", { ascending: false })
    : query.order("created_at", { ascending: false });

  const [range, withoutPromo, withPromo] = await Promise.all([
    query.range(...listRange(page)),
    applyScope(
      admin.from("applications").select("id", { count: "exact", head: true }),
    ).eq("has_promo", false),
    applyScope(
      admin.from("applications").select("id", { count: "exact", head: true }),
    ).eq("has_promo", true),
  ]);

  const { data, count, error } = range;
  const rows = (data ?? []) as unknown as Application[];

  const columns: Column<Application>[] = [
    {
      key: "name",
      header: "Arizachi",
      render: (a) => (
        <span className="flex items-center gap-3">
          <Avatar name={a.full_name} size={34} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold uppercase text-ink">{a.full_name}</span>
            <span className="block truncate text-xs text-ink-soft">{a.phone ?? a.email ?? "—"}</span>
          </span>
        </span>
      ),
    },
    {
      key: "telegram",
      header: "Telegram",
      desktopOnly: true,
      render: (a) => <span className="text-xs text-ink-soft">{a.telegram ?? "—"}</span>,
    },
    {
      key: "profile",
      header: "Jins / yosh",
      desktopOnly: true,
      render: (a) => (
        <span className="text-xs text-ink-soft">
          {[a.gender ? genderLabel(a.gender) : null, a.age_range].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      /*
       * HUDUD.
       *
       * So'rov `regions(name)` ni allaqachon olardi, lekin uni hech
       * qayerda ko'rsatmasdi: ma'lumot yig'ilib, moderatorga
       * ko'rinmay turardi. Ariza formasida hudud majburiy qilingach,
       * bu ustun kerak bo'ldi.
       *
       * Eski arizalarda hudud YO'Q va bu normal — u o'sha paytda
       * so'ralmagan. Chiziqcha aynan shuni bildiradi.
       */
      key: "region",
      header: "Hudud",
      desktopOnly: true,
      render: (a) =>
        a.regions?.name ? (
          <span className="text-xs text-ink-soft">{a.regions.name}</span>
        ) : (
          <span className="text-xs text-ink-soft">—</span>
        ),
    },
    {
      key: "promo",
      header: "Promo kod",
      desktopOnly: true,
      render: (a) =>
        a.promo_code ? <Badge accent="lime">{a.promo_code}</Badge> : <span className="text-xs text-ink-soft">—</span>,
    },
    {
      key: "duplicate",
      header: "Dublikat",
      desktopOnly: true,
      render: (a) =>
        a.duplicate_of ? (
          <span className="text-xs font-bold text-coral">Ehtimol dublikat</span>
        ) : (
          <span className="text-xs text-ink-soft">—</span>
        ),
    },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    {
      key: "created",
      header: "Kelgan sana",
      render: (a) => <span className="text-xs text-ink-soft">{formatDate(a.created_at, true)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Arizalar"
        description="Platformaga qo‘shilish arizalari — ko‘rib chiqish va nomzodga aylantirish"
        breadcrumbs={[{ label: "Arizalar" }]}
      />
      <ApplicationFilters />

      {/*
        SANOQ — TARTIB O'ZGARGANINI TASDIQLAYDI.
        Tugma bosilgach ro'yxat boshqacha ko'rinadi; bu ikki son
        "nechtasi kodsiz edi" degan savolga darhol javob beradi.
      */}
      <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span className="rounded-full bg-surface px-2.5 py-1 font-bold text-ink">
          Promo kodsiz: {withoutPromo.count ?? 0}
        </span>
        <span className="rounded-full bg-surface px-2.5 py-1">
          Promo kodli: {withPromo.count ?? 0}
        </span>
        {noPromoFirst ? (
          <span className="font-semibold text-brand">Kodsizlar tepada</span>
        ) : null}
      </p>

      <PromoReportPanel />
      <DataTableToolbar
        searchPlaceholder="Ism, telefon, Telegram yoki promo kod…"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "new", label: "Yangi" },
              { value: "in_review", label: "Ko‘rilmoqda" },
              { value: "needs_info", label: "Ma’lumot kerak" },
              { value: "accepted", label: "Qabul qilingan" },
              { value: "rejected", label: "Rad etilgan" },
              { value: "converted", label: "Nomzodga aylantirilgan" },
            ],
          },
          {
            key: "gender",
            label: "Jinsi",
            options: Object.entries(APPLICATION_GENDER_LABELS).map(([value, label]) => ({ value, label })),
          },
          {
            key: "age_range",
            label: "Yoshi",
            options: APPLICATION_AGE_RANGES.map((value) => ({ value, label: value })),
          },
        ]}
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowHref={(a) => `/applications/${a.id}`}
        empty={
          <EmptyState
            icon={<ClipboardList className="h-7 w-7" />}
            title={error ? "Jadval topilmadi" : "Arizalar yo‘q"}
            description={error ? "Supabase migrationlarni ishga tushiring." : "Saytdan kelgan arizalar shu yerda ko‘rinadi."}
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/applications" params={{ q, ...filters }} />
    </>
  );
}
