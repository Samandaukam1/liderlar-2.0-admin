import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  classifyAttachment,
  type AttachmentClassification,
} from "./attachment-intent.ts";
import { isSalesStage, type SalesStage } from "./stages.ts";

/**
 * Birikmani tasniflash uchun suhbat holatini o'qiydi.
 *
 * Qoidalar SOF modulda (`attachment-intent.ts`) — bu yerda faqat I/O.
 */
export async function classifyIncomingAttachment(input: {
  conversationId: string;
  messageType: string;
  caption: string | null;
}): Promise<AttachmentClassification> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_conversations")
    .select("sales_stage, payment_status")
    .eq("id", input.conversationId)
    .maybeSingle();

  const rawStage = (data?.sales_stage as string | null) ?? "new";
  const stage: SalesStage = isSalesStage(rawStage) ? rawStage : "new";

  return classifyAttachment({
    messageType: input.messageType,
    caption: input.caption,
    stage,
    paymentStatus: (data?.payment_status as string | null) ?? "none",
  });
}
