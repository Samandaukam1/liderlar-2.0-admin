import { Download } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/primitives";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import va eksport" };
export const dynamic = "force-dynamic";

const EXPORTS = [
  { href: "/api/export/candidates", label: "Nomzodlar", desc: "Barcha nomzod profillari (CSV)" },
  { href: "/api/export/rankings", label: "Reyting", desc: "Joriy davr umumiy reytingi (CSV)" },
  { href: "/api/export/applications", label: "Arizalar", desc: "Barcha arizalar (CSV)" },
  { href: "/api/export/journals", label: "Jurnal ma’lumotlari", desc: "Liderlar Online sonlari (CSV)" },
];

export default async function ImportExportPage() {
  const ctx = await requirePermission("import.run");
  const canExport = hasPermission(ctx.roles, "export.run");

  return (
    <>
      <PageHeader
        title="Import va eksport"
        description="Eski liderlar bazasini ko‘chirish va ma’lumotlarni yuklab olish"
        breadcrumbs={[{ label: "Import va eksport" }]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <h2 className="mb-3 text-sm font-bold text-ink">CSV import — nomzodlar</h2>
          <ImportWizard />
        </div>

        {canExport && (
          <div>
            <h2 className="mb-3 text-sm font-bold text-ink">Eksport</h2>
            <div className="space-y-3">
              {EXPORTS.map((e) => (
                <Card key={e.href} className="p-4" interactive>
                  <a href={e.href} className="flex items-center gap-3">
                    <span className="rounded-xl bg-cyan/12 p-2.5 text-brand">
                      <Download className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-ink">{e.label}</span>
                      <span className="block text-xs text-ink-soft">{e.desc}</span>
                    </span>
                  </a>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
