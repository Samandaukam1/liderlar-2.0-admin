import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/primitives";
import { CandidateForm } from "../candidate-form";

export const metadata = { title: "Yangi nomzod" };
export const dynamic = "force-dynamic";

export default async function NewCandidatePage() {
  await requirePermission("candidates.create");
  const admin = createSupabaseAdminClient();
  const [{ data: regions }, { data: categories }] = await Promise.all([
    admin.from("regions").select("id, name").order("sort_order"),
    admin.from("categories").select("id, name").order("sort_order"),
  ]);

  return (
    <>
      <PageHeader
        title="Yangi nomzod"
        breadcrumbs={[{ label: "Nomzodlar", href: "/candidates" }, { label: "Yangi" }]}
      />
      <div className="max-w-3xl">
        <Card>
          <CandidateForm
            candidate={null}
            regions={regions ?? []}
            categories={categories ?? []}
          />
        </Card>
      </div>
    </>
  );
}
