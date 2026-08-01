import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { AiAssistantForm, type AiAssistantSettingsRow } from "./ai-assistant-form";

export const metadata = { title: "AI Assistant" };
export const dynamic = "force-dynamic";

export default async function AiAssistantSettingsPage() {
  await requirePermission("ai_assistant.manage");
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("ai_assistant_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  return (
    <>
      <PageHeader
        title="AI Assistant"
        description="User panelning pastki burchagida turadigan Jaxongir AI widgetining ko'rinishi va xatti-harakati"
        breadcrumbs={[{ label: "AI Assistant" }]}
      />
      <div className="max-w-3xl">
        <AiAssistantForm settings={data as AiAssistantSettingsRow | null} />
      </div>
    </>
  );
}
