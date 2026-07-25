import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { listPhotoPromptFragments } from "@/lib/intake/photo-prompt";
import { AiPromptsEditor } from "./prompts-editor";

export const metadata = { title: "AI Promtlar — Nomzod rasm yaratish" };
export const dynamic = "force-dynamic";

export default async function AiPromptsPage() {
  const ctx = await requirePermission("ai_prompts.view");
  const canEdit = ctx.permissions.has("ai_prompts.edit");
  const fragments = await listPhotoPromptFragments();

  return (
    <>
      <PageHeader
        title="Nomzod link rasm yaratish promtlari"
        description="Nomzod havolasidagi AI rasm generatsiyasi uchun fon, kiyim va rang promtlari"
        breadcrumbs={[{ label: "AI Promtlar" }, { label: "Rasm yaratish promtlari" }]}
      />
      <AiPromptsEditor fragments={fragments} canEdit={canEdit} />
    </>
  );
}
