import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runQueuedJob } from "../flow/engine.ts";
import { claimJobs, completeJob, failJob, skipJob } from "./queue-store.ts";

/**
 * NAVBAT ISHCHISI.
 *
 * Qulf band bo'lgani uchun navbatga tushgan ishlarni bajaradi
 * (27-band). Cron bilan yuradi, chunki serverless funksiya
 * javobdan keyin o'ladi va kechiktirilgan ishni bajara olmaydi.
 *
 * IDEMPOTENTLIK: har ish bitta kiruvchi xabarga bog'langan va
 * `uq_sales_ai_job_message` unikal indeksi takrorini rad etadi.
 * Shu sabab bir xabar ikki marta javob olmaydi.
 */

export interface QueueTickResult {
  claimed: number;
  succeeded: number;
  skipped: number;
  requeued: number;
  failed: number;
  deadLettered: number;
  notes: string[];
}

/** Bitta yugurishda nechta ish olinadi. */
const BATCH = 5;

export async function runQueueTick(): Promise<QueueTickResult> {
  const workerId = `queue-${randomUUID().slice(0, 8)}`;
  const admin = createSupabaseAdminClient();

  const jobs = await claimJobs({ workerId, limit: BATCH });

  const result: QueueTickResult = {
    claimed: jobs.length,
    succeeded: 0,
    skipped: 0,
    requeued: 0,
    failed: 0,
    deadLettered: 0,
    notes: [],
  };

  for (const job of jobs) {
    // Xabar matnini olamiz: ish faqat identifikator saqlaydi.
    const { data: message } = await admin
      .from("sales_messages")
      .select("id, text, message_type, deleted_at")
      .eq("id", job.messageId ?? "")
      .maybeSingle();

    if (job.messageId && !message) {
      await skipJob(job.id, job.claimToken, "xabar topilmadi");
      result.skipped += 1;
      continue;
    }

    /*
     * O'CHIRILGAN XABARGA JAVOB BERILMAYDI.
     *
     * Mijoz xabarini qaytarib olgan bo'lsa, unga javob yozish
     * g'alati va ba'zan zararli bo'ladi (masalan xato yuborilgan
     * shaxsiy ma'lumot).
     */
    if (message?.deleted_at) {
      await skipJob(job.id, job.claimToken, "xabar o‘chirilgan");
      result.skipped += 1;
      continue;
    }

    try {
      const { result: flowResult, lockBusy } = await runQueuedJob({
        conversationId: job.conversationId,
        messageId: job.messageId,
        text: (message?.text as string | null) ?? null,
        messageType: (message?.message_type as string) ?? "text",
      });

      if (lockBusy) {
        /*
         * QULF HALI HAM BAND — ISH YO'QOLMAYDI.
         *
         * `waiting` holatiga qaytadi va keyingi tikda qayta
         * olinadi. Urinishlar soni OSHMAYDI: bu xato emas,
         * shunchaki navbat.
         */
        await admin
          .from("sales_ai_jobs")
          .update({
            status: "waiting",
            claim_token: null,
            lease_expires_at: null,
            available_at: new Date(Date.now() + 15_000).toISOString(),
          })
          .eq("id", job.id)
          .eq("claim_token", job.claimToken);
        result.requeued += 1;
        continue;
      }

      if (!flowResult) {
        await skipJob(job.id, job.claimToken, "oqim javob qaytarmadi");
        result.skipped += 1;
        continue;
      }

      await completeJob(job.id, job.claimToken);
      result.succeeded += 1;
      if (flowResult.refusals.length > 0) {
        result.notes.push(`${job.id}: ${flowResult.refusals.join(", ")}`);
      }
    } catch (err) {
      const decision = await failJob({
        jobId: job.id,
        claimToken: job.claimToken,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        error: err instanceof Error ? err.message : String(err),
      });
      if (decision.state === "dead_letter") result.deadLettered += 1;
      else result.failed += 1;
      result.notes.push(`${job.id}: ${decision.reason}`);
    }
  }

  return result;
}
