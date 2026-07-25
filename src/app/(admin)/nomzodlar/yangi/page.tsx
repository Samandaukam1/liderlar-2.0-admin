import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { IntakeOnboarding } from "./onboarding";

export const metadata = { title: "Yangi nomzod anketasi" };
export const dynamic = "force-dynamic";

export default async function NewIntakePage() {
  await requirePermission("intakes.create");
  return (
    <>
      <PageHeader
        title="Yangi nomzod qo‘shish"
        description="Anketani qo‘lda to‘ldiring yoki nomzodga xavfsiz havola yuboring"
        breadcrumbs={[
          { label: "Nomzod anketalari", href: "/nomzodlar/anketalar" },
          { label: "Yangi" },
        ]}
      />
      <IntakeOnboarding />
    </>
  );
}
