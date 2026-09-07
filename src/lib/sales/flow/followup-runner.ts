import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSalesSettings } from "../settings.ts";
import { getConnection } from "../repository.ts";
import { sendSalesMessage } from "../telegram-sales-api.ts";
import { authorizeOutbound } from "./outbound-guard.ts";
import { getTemplate } from "./templates.ts";
import { isSalesStage, type SalesStage } from "./stages.ts";

/**
 * REJALASHTIRILGAN FOLLOW-UP ISHCHISI.
 *
 * NEGA CRON, `setTimeout` EMAS: serverless funksiya javob qaytargach
 * o'ladi va u bilan birga taymer ham yo'qoladi. 7 daqiqadan keyin
 * yuborilishi kerak bo'lgan xabar hech qachon yuborilmasdi. Shuning
 * uchun navbat bazada turadi va cron uni tekshiradi.
 *
 * ESKIRGAN FOLLOW-UP YUBORILMAYDI: har yozuvda rejalashtirilgan
 * paytdagi bosqich saqlangan. Suhbat undan oldinga ketgan bo'lsa
 * (mijoz javob bergan, admin qo'lga olgan) — `skipped`.
 */

export interface FollowupTickResult {
  due: number;
  sent: number;
  skipped: number;
  failed: number;
  notes: string[];
}

/** Bitta yugurishda ko'riladigan eng ko'p follow-up. */
const BATCH = 25;

export async function runFollowupTick(now: Date = new Date()): Promise<FollowupTickResult> {
  const admin = createSupabaseAdminClient();
  const settings = await getSalesSettings();

  const { data: due } = await admin
    .from("sales_followups")
    .select("id, conversation_id, followup_type, template_key, expected_stage, attempts")
    .eq("status", "pending")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(BATCH);

  const result: FollowupTickResult = {
    due: due?.length ?? 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    notes: [],
  };

  for (const row of due ?? []) {
    const followupId = row.id as string;
    const conversationId = row.conversation_id as string;

    const { data: conversation } = await admin
      .from("sales_conversations")
      .select("id, business_connection_id, chat_id, sales_stage, ai_enabled")
      .eq("id", conversationId)
      .maybeSingle();

    if (!conversation) {
      await markFollowup(followupId, "skipped", { cancel_reason: "suhbat topilmadi" });
      result.skipped += 1;
      continue;
    }

    const stageRaw = conversation.sales_stage as string;
    const stage: SalesStage = isSalesStage(stageRaw) ? stageRaw : "new";
    const expected = row.expected_stage as string;

    // Suhbat oldinga ketgan — eskirgan follow-up yuborilmaydi.
    if (stage !== expected) {
      await markFollowup(followupId, "skipped", {
        cancel_reason: `bosqich o‘zgargan: ${expected} -> ${stage}`,
      });
      result.skipped += 1;
      continue;
    }

    const template = getTemplate(row.template_key as string);
    if (!template) {
      await markFollowup(followupId, "failed", { error: "shablon topilmadi" });
      result.failed += 1;
      continue;
    }

    const connection = await getConnection(conversation.business_connection_id as string);
    const decision = authorizeOutbound({
      conversationId,
      businessConnectionId: conversation.business_connection_id as string,
      chatId: conversation.chat_id as number,
      stage,
      expectedStages: [stage],
      kind: "followup",
      templateKey: template.key,
      body: template.body,
      autoReplyEnabled: settings.flow.autoReplyEnabled,
      aiEnabled: conversation.ai_enabled !== false,
      connectionEnabled: connection?.isEnabled ?? false,
      connectionCanReply: connection?.canReply ?? false,
    });

    if (!decision.allowed) {
      // Ruxsat yo'q — bu xato emas, holat. Yozuv `skipped` bo'ladi va
      // qayta urinilmaydi: sozlama o'zgarsa yangi follow-up rejalashadi.
      await markFollowup(followupId, "skipped", { cancel_reason: decision.reason });
      result.skipped += 1;
      result.notes.push(`${row.followup_type}: ${decision.reason}`);
      continue;
    }

    try {
      const sent = await sendSalesMessage(decision.authorization, template.body);
      await admin.from("sales_outbound_log").insert({
        conversation_id: conversationId,
        kind: "followup",
        template_key: template.key,
        body: template.body,
        stage_before: stage,
        stage_after: stage,
        telegram_message_id: sent.telegramMessageId,
        simulated: false,
        error: sent.ok ? null : sent.error,
      });

      if (sent.ok) {
        await markFollowup(followupId, "sent", { sent_at: new Date().toISOString() });
        await admin
          .from("sales_conversations")
          .update({ last_outbound_at: new Date().toISOString() })
          .eq("id", conversationId);
        result.sent += 1;
      } else {
        await markFollowup(followupId, "failed", { error: sent.error?.slice(0, 300) });
        result.failed += 1;
      }
    } catch (err) {
      await markFollowup(followupId, "failed", {
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
      result.failed += 1;
    }
  }

  return result;
}

async function markFollowup(
  id: string,
  status: "sent" | "skipped" | "failed",
  extra: Record<string, unknown>,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_followups")
    .update({ status, ...extra })
    .eq("id", id);
}
