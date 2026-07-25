import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { LegalEditor, type LegalPage } from "./legal-editor";

export const metadata = { title: "Huquqiy sahifalar" };
export const dynamic = "force-dynamic";

const DEFAULTS: LegalPage[] = [
  { slug: "oferta", title: "Ommaviy oferta", content: "", updated_at: null },
  { slug: "privacy", title: "Maxfiylik siyosati", content: "", updated_at: null },
  { slug: "terms", title: "Foydalanish shartlari", content: "", updated_at: null },
];

export default async function LegalPagesPage() {
  await requirePermission("legal.manage");
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("legal_pages").select("slug, title, content, updated_at");

  const pages = DEFAULTS.map((d) => {
    const found = ((data ?? []) as LegalPage[]).find((p) => p.slug === d.slug);
    return found ?? d;
  });

  return (
    <>
      <PageHeader
        title="Huquqiy sahifalar"
        description="Ommaviy oferta, maxfiylik siyosati va foydalanish shartlari"
        breadcrumbs={[{ label: "Huquqiy sahifalar" }]}
      />
      <div className="max-w-3xl">
        <LegalEditor pages={pages} />
      </div>
    </>
  );
}
