import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSalesSettings } from "../settings.ts";
import { getConnection } from "../repository.ts";
import { sendSalesMessage } from "../telegram-sales-api.ts";
import { authorizeOutbound } from "./outbound-guard.ts";
import { getTemplate } from "./templates.ts";
import { isSalesStage, type SalesStage } from "./stages.ts";
import { parseMemory, isPaymentConfirmed } from "../memory/conversation-memory.ts";

/**
 * REJALASHTIRILGAN FOLLOW-UP ISHCHISI.
 *
 * NEGA CRON, `setTimeout` EMAS: serverless funksiya javob qaytargach
 * o'ladi va u bilan birga taymer ham yo'qoladi. 7 daqiqadan keyin
 * yuborilishi kerak bo'lgan xabar hech qachon yuborilmasdi. Shuning
 * uchun navbat bazada turadi va cron uni tekshiradi.
 *
 * ── 2-FAZA: ATOMIK CLAIM (28-band) ────────────────────────────────
 *
 * OLDINGI XATO: runner `pending` yozuvlarni O'QIRDI, yuborardi,
 * keyin `sent` qilardi. O'qish bilan yozish orasida OYNA bor edi.
 * Vercel cron'i bir daqiqada ishlaydi va bir yugurish cho'zilsa,
 * ikkinchisi boshlanardi — ikkala worker ham bir xil `pending`
 * yozuvni ko'rib, MIJOZGA IKKI MARTA bir xil eslatma yuborardi.
 *
 * ENDI: avval ATOMIK `pending -> claimed` UPDATE. Shart
 * bajarilmasa qator qaytmaydi va bu worker o'sha yozuvni
 * o'tkazib yuboradi. Yuborish faqat CLAIM MUVAFFAQIYATLI
 * bo'lgandan keyin.
 */

export interface FollowupTickResult {
  due: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Telegram javobi noaniq — ko'r-ko'rona qayta yuborilmaydi. */
  unknown: number;
  notes: string[];
}

/** Bitta yugurishda ko'riladigan eng ko'p follow-up. */
const BATCH = 25;
/** Claim shuncha vaqtda o'z-o'zidan bo'shaydi (worker o'lsa). */
const LEASE_MS = 5 * 60 * 1000;

export async function runFollowupTick(now: Date = new Date()): Promise<FollowupTickResult> {
  const admin = createSupabaseAdminClient();
  const settings = await getSalesSettings();
  const workerId = `followup-${randomUUID().slice(0, 8)}`;

  /*
   * Lease muddati o'tgan claim'larni qaytaramiz. Worker yuborish
   * paytida o'lgan bo'lsa, yozuv abadiy `claimed` bo'lib qolardi
   * va eslatma hech qachon ketmasdi.
   *
   * DIQQAT: qaytarilgan yozuv `delivery_state = 'unknown'` bo'lsa
   * u QAYTA YUBORILMAYDI — pastdagi tanlovda shunday shart bor.
   */
  await admin
    .from("sales_followups")
    .update({ status: "pending", claim_token: null, claimed_by: null, lease_expires_at: null })
    .eq("status", "claimed")
    .eq("delivery_state", "pending")
    .lt("lease_expires_at", now.toISOString());

  const { data: due } = await admin
    .from("sales_followups")
    .select("id, conversation_id, followup_type, template_key, expected_stage, attempts, scheduled_at")
    .eq("status", "pending")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(BATCH);

  const result: FollowupTickResult = {
    due: due?.length ?? 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    unknown: 0,
    notes: [],
  };

  for (const row of due ?? []) {
    const followupId = row.id as string;
    const conversationId = row.conversation_id as string;

    /* ---------------------- 1. ATOMIK CLAIM ---------------------- */
    const claimToken = randomUUID();
    const { data: claimed } = await admin
      .from("sales_followups")
      .update({
        status: "claimed",
        claim_token: claimToken,
        claimed_by: workerId,
        claimed_at: now.toISOString(),
        lease_expires_at: new Date(now.getTime() + LEASE_MS).toISOString(),
      })
      .eq("id", followupId)
      // SHART: hali ham `pending`. Boshqa worker ulgurgan bo'lsa
      // qator qaytmaydi — va biz bu yozuvga TEGMAYMIZ.
      .eq("status", "pending")
      .select("id");

    if (!claimed || claimed.length === 0) {
      // Boshqa worker oldi. Bu xato emas va sanoqqa kirmaydi.
      continue;
    }
    result.claimed += 1;

    /* -------- 2. YUBORISHDAN OLDIN HOLATNI QAYTA O'QISH ---------- */
    /*
     * Rejalashtirilgandan keyin ko'p narsa o'zgargan bo'lishi mumkin:
     * mijoz "yozmang" degan, inson suhbatni olgan, to'lov tasdiqlangan
     * yoki mijoz allaqachon javob yozgan. Hammasi SHU YERDA,
     * yuborishdan oldin tekshiriladi.
     */
    const { data: conversation } = await admin
      .from("sales_conversations")
      // Bitta satr literal: Supabase tip xulosasi birlashtirilgan
      // ifodadan ustunlarni o'qiy olmaydi va natija `any` bo'lib qoladi.
      .select("id, business_connection_id, chat_id, sales_stage, ai_enabled, opted_out_at, rollout_bucket, human_required_at, payment_status, memory, last_incoming_at, referral_source")
      .eq("id", conversationId)
      .maybeSingle();

    if (!conversation) {
      await release(followupId, claimToken, "skipped", { cancel_reason: "suhbat topilmadi" });
      result.skipped += 1;
      continue;
    }

    const stageRaw = conversation.sales_stage as string;
    const stage: SalesStage = isSalesStage(stageRaw) ? stageRaw : "new";
    const expected = row.expected_stage as string;
    const memory = parseMemory(conversation.memory);

    // Suhbat oldinga ketgan — eskirgan follow-up yuborilmaydi.
    if (stage !== expected) {
      await release(followupId, claimToken, "skipped", {
        cancel_reason: `bosqich o‘zgargan: ${expected} -> ${stage}`,
      });
      result.skipped += 1;
      continue;
    }

    // INSON QO'LGA OLGAN — AI jim bo'ladi.
    if (conversation.human_required_at != null || conversation.ai_enabled === false) {
      await release(followupId, claimToken, "skipped", {
        cancel_reason: "inson nazorati",
      });
      result.skipped += 1;
      continue;
    }

    /*
     * TO'LAGAN MIJOZGA QAYTA TO'LOV ESLATMASI KETMAYDI.
     *
     * Bu eng ko'p ishonch yo'qotadigan xato: pul o'tkazgan odamga
     * "to'lovni unutmang" degan avtomatik xabar borishi.
     */
    const paymentConfirmed =
      isPaymentConfirmed(memory.paymentStatus) ||
      (conversation.payment_status as string) === "paid" ||
      (conversation.payment_status as string) === "confirmed";
    const isPaymentFollowup =
      (row.followup_type as string).includes("payment") ||
      (row.template_key as string).includes("payment");
    if (paymentConfirmed && isPaymentFollowup) {
      await release(followupId, claimToken, "skipped", {
        cancel_reason: "to‘lov tasdiqlangan — to‘lov eslatmasi yuborilmaydi",
      });
      result.skipped += 1;
      continue;
    }

    /*
     * MIJOZ YANGI XABAR YOZGAN BO'LSA ESLATMA ESKIRGAN.
     *
     * Javob kelgandan keyin "javobingizni kutyapmiz" deb yozish
     * botning mijozni o'qimaganini ko'rsatadi.
     */
    const lastIncoming = conversation.last_incoming_at as string | null;
    const scheduledFor = Date.parse((row.scheduled_at as string | null) ?? "");
    if (lastIncoming && Number.isFinite(scheduledFor)) {
      if (Date.parse(lastIncoming) > scheduledFor) {
        await release(followupId, claimToken, "skipped", {
          cancel_reason: "mijoz yangi xabar yozgan — eslatma eskirgan",
        });
        result.skipped += 1;
        continue;
      }
    }

    const template = getTemplate(row.template_key as string);
    if (!template) {
      await release(followupId, claimToken, "failed", { error: "shablon topilmadi" });
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
      rollout: settings.rollout,
      rolloutBucket:
        typeof conversation.rollout_bucket === "number" ? conversation.rollout_bucket : null,
      // Follow-up YUBORISHDAN OLDIN qayta tekshiriladi (20-band):
      // rejalashtirilgandan keyin mijoz "yozmang" degan bo'lishi mumkin.
      optedOut: conversation.opted_out_at != null || memory.optOut,
      /*
       * IMTIYOZLI SUHBAT — eslatma ham bundan mustasno emas.
       *
       * Eslatmalar ssenariy jadvalidan o'tmaydi, shuning uchun
       * u yerdagi taqiq bu yo'lni qamramaydi. "To'lovni
       * unutmang" degan avtomatik eslatma aynan shu yerdan
       * chiqib ketishi mumkin edi.
       */
      referral: conversation.referral_source != null,
    });

    if (!decision.allowed) {
      // Ruxsat yo'q — bu xato emas, holat. Yozuv `skipped` bo'ladi va
      // qayta urinilmaydi: sozlama o'zgarsa yangi follow-up rejalashadi.
      await release(followupId, claimToken, "skipped", { cancel_reason: decision.reason });
      result.skipped += 1;
      result.notes.push(`${row.followup_type}: ${decision.reason}`);
      continue;
    }

    /* --------------------- 3. YUBORISH --------------------------- */
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
        await release(followupId, claimToken, "sent", {
          sent_at: new Date().toISOString(),
          delivery_state: "delivered",
        });
        await admin
          .from("sales_conversations")
          .update({ last_outbound_at: new Date().toISOString() })
          .eq("id", conversationId);
        result.sent += 1;
      } else {
        await release(followupId, claimToken, "failed", {
          error: sent.error?.slice(0, 300),
          delivery_state: "failed",
        });
        result.failed += 1;
      }
    } catch (err) {
      /*
       * TIMEOUT/UZILISH — YETKAZILGANI NOMA'LUM (29-band).
       *
       * Telegram xabarni qabul qilgan, lekin javob bizga yetib
       * kelmagan bo'lishi mumkin. Ko'r-ko'rona qayta yuborish
       * mijozga IKKI MARTA bir xil xabar borishiga olib keladi.
       * Shuning uchun `unknown` — odam ko'rib hal qiladi.
       */
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      const timeoutLike = /timeout|aborted|ETIMEDOUT|ECONNRESET|fetch failed/i.test(message);

      await release(followupId, claimToken, timeoutLike ? "unknown" : "failed", {
        error: message,
        delivery_state: timeoutLike ? "unknown" : "failed",
      });
      if (timeoutLike) {
        result.unknown += 1;
        result.notes.push(`${row.followup_type}: yetkazilgani noma’lum — qayta yuborilmadi`);
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
}

/**
 * Claim'ni bo'shatib, yakuniy holatni yozadi.
 *
 * `claim_token` sharti: faqat SHU worker o'z claim'ini yopa oladi.
 * Lease tugab, ish boshqa workerga o'tgan bo'lsa, kechikkan worker
 * yangi holatni bosib yubormaydi.
 */
async function release(
  id: string,
  claimToken: string,
  status: "sent" | "skipped" | "failed" | "unknown",
  extra: Record<string, unknown>,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_followups")
    .update({ status, claim_token: null, lease_expires_at: null, ...extra })
    .eq("id", id)
    .eq("claim_token", claimToken);
}
