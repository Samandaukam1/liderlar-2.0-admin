import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/admin/page-header";
import { CornerVideoForm, type CornerVideoSettingsRow } from "./corner-video-form";

export const metadata = { title: "Burchak video" };
export const dynamic = "force-dynamic";

export default async function CornerVideoSettingsPage() {
  await requirePermission("corner_video.manage");
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("corner_video_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  return (
    <>
      <PageHeader
        title="Burchak video"
        description="User panelning har bir sahifasida burchakda ovozsiz o'ynaydigan video va uning ostidagi animatsiyali tugma"
        breadcrumbs={[{ label: "Burchak video" }]}
      />
      <div className="max-w-3xl">
        <CornerVideoForm settings={data as CornerVideoSettingsRow | null} />
      </div>
    </>
  );
}
