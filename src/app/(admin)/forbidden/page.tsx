import { PermissionDenied } from "@/components/ui/feedback";
import { PageHeader } from "@/components/admin/page-header";

export const metadata = { title: "Ruxsat yo‘q" };

export default function ForbiddenPage() {
  return (
    <>
      <PageHeader title="Ruxsat yo‘q" />
      <PermissionDenied />
    </>
  );
}
