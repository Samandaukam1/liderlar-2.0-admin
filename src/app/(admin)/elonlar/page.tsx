import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { loadAdsPageData } from "@/lib/elonlar/service";
import { MIGRATION_NOTICE } from "@/lib/elonlar/rules";
import { AdsManager } from "./ads-manager";

export const metadata = { title: "Reklamalarni boshqarish" };
export const dynamic = "force-dynamic";

export default async function AdsPage() {
  await requirePermission("ads.manage");
  const data = await loadAdsPageData();
  // Holat (yoqilgan / rejalashtirilgan / tugagan) serverda hisoblangan vaqtga
  // nisbatan — render ichida soat o'qilmaydi.
  const nowIso = new Date().toISOString();

  return (
    <>
      <PageHeader
        title="Reklamalarni boshqarish"
        description="Bot yuboradigan har bir post ostiga qo‘shiladigan havola va biografik sahifalar ustidagi animatsion bar. Har joyda bir vaqtda ko‘pi bilan 3 ta reklama yoqiladi; bir nechtasi yoqilsa, ular navbat bilan chiqadi."
        breadcrumbs={[{ label: "Reklamalarni boshqarish" }]}
      />
      {data.ok ? (
        <AdsManager ads={data.ads} settings={data.settings} nowIso={nowIso} />
      ) : (
        <div className="max-w-3xl rounded-card border border-amber/50 bg-amber/10 p-5 text-sm text-ink">
          <p className="font-bold">{data.missingMigration ? MIGRATION_NOTICE : "Ma’lumotlarni o‘qib bo‘lmadi"}</p>
          {!data.missingMigration ? <p className="mt-1 text-ink-soft">{data.error}</p> : null}
        </div>
      )}
    </>
  );
}
