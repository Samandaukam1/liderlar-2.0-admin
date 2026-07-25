import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Sayt sozlamalari" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePermission("settings.manage");
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("site_settings").select("key, value");
  const values = Object.fromEntries(
    ((data ?? []) as Array<{ key: string; value: string }>).map((s) => [s.key, s.value]),
  );

  return (
    <>
      <PageHeader
        title="Sayt sozlamalari"
        description="liderlar.uz uchun umumiy sozlamalar — faqat super admin"
        breadcrumbs={[{ label: "Sozlamalar" }]}
      />
      <div className="max-w-3xl">
        <SettingsForm values={values} />
      </div>
    </>
  );
}
