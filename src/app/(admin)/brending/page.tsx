import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { getBranding } from "@/lib/branding/service";
import { formatDate } from "@/lib/utils";
import { BrandingForm } from "./branding-form";

export const metadata = { title: "Logo va favicon" };
export const dynamic = "force-dynamic";

/**
 * Brending paneli: logotip va undan hosil qilinadigan ikonkalar.
 *
 * Sozlamalar `site_settings` da saqlanadi — ya'ni o'zgarish qayta
 * build qilmasdan, keyingi sahifa yuklanishida kuchga kiradi.
 */
export default async function BrandingPage() {
  await requirePermission("settings.manage");
  const branding = await getBranding();

  return (
    <>
      <PageHeader
        title="Logo va favicon"
        description="Panel logotipi va brauzer ikonkalari — bitta tasvirdan barcha o‘lchamlar."
        breadcrumbs={[{ label: "Logo va favicon" }]}
      />

      <div className="max-w-4xl">
        {branding.updatedAt ? (
          <p className="mb-4 text-xs text-ink-soft">
            Oxirgi yangilanish: {formatDate(branding.updatedAt, true)}
          </p>
        ) : null}

        <BrandingForm branding={branding} />

        <p className="mt-4 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-soft">
          <strong className="font-bold text-ink">Kesh haqida:</strong> brauzer
          favicon’ni uzoq eslab qoladi. Shuning uchun har yuklashda ikonka
          manzili yangi versiya bilan chiqadi va eski belgi osilib qolmaydi.
          Yorliqdagi belgi darhol o‘zgarmasa, sahifani <code>Ctrl/Cmd + Shift + R</code>{" "}
          bilan yangilang.
        </p>
      </div>
    </>
  );
}
