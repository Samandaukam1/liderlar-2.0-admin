import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_MAX_ATTEMPTS,
  decideAfterFailure,
  leaseExpiry,
  selectNextJobs,
  type JobState,
  type QueuedJobRow,
} from "./job-state.ts";

/**
 * NAVBAT SAQLASH QATLAMI — `sales_ai_jobs` ustida.
 *
 * Mavjud jadval qayta ishlatiladi (27-band aynan shuni so'raydi):
 * u allaqachon suhbat/xabarga bog'langan va unikal indeks bilan
 * idempotent. 2-faza migratsiyasi unga lease/claim ustunlarini
 * qo'shdi.
 *
 * QOIDALAR `job-state.ts` DA — bu yerda faqat I/O.
 */

export interface EnqueueInput {
  conversationId: string;
  messageId: string | null;
  kind: "reply" | "followup" | "fallback" | "objection";
  reason: string;
}

export interface EnqueueResult {
  jobId: string | null;
  /** Ish allaqachon bor edi — takroriy update. */
  duplicate: boolean;
}

/**
 * Ishni navbatga qo'yadi.
 *
 * TAKRORIY UPDATE XATO EMAS: `uq_sales_ai_job_message` unikal
 * indeksi ikkinchi yozuvni rad etadi va biz buni `duplicate`
 * deb qaytaramiz. Chaqiruvchi uchun bu muvaffaqiyat — mijoz
 * ikkita javob olmasligi kerak.
 */
export async function enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("sales_ai_jobs")
    .insert({
      conversation_id: input.conversationId,
      message_id: input.messageId,
      status: "queued",
      generation_type: input.kind,
      attempts: 0,
      max_attempts: DEFAULT_MAX_ATTEMPTS,
      available_at: now,
      enqueued_at: now,
      refusal_reason: input.reason.slice(0, 300),
    })
    .select("id")
    .single();

  if (error) {
    // 23505 — unikal indeks buzilishi, ya'ni ish allaqachon bor.
    if (error.code === "23505") return { jobId: null, duplicate: true };
    throw new Error(error.message);
  }

  return { jobId: data.id as string, duplicate: false };
}

export interface ClaimedJob {
  id: string;
  conversationId: string;
  messageId: string | null;
  kind: string;
  attempts: number;
  maxAttempts: number;
  claimToken: string;
}

/**
 * Ishlarni ATOMIK egallaydi.
 *
 * IKKI QADAM, LEKIN POYGASIZ:
 *   1) nomzodlarni o'qish (bu yerda poyga bo'lishi mumkin);
 *   2) HAR BIRINI shartli UPDATE bilan egallash.
 *
 * Ikkinchi qadam hal qiluvchi: `eq("status", ...)` sharti
 * bajarilmasa qator qaytmaydi va biz uni O'TKAZIB YUBORAMIZ.
 * Shuning uchun ikki worker bir xil ishni ololmaydi — yutqazgani
 * bo'sh natija oladi.
 */
export async function claimJobs(options: {
  workerId: string;
  limit?: number;
  now?: Date;
}): Promise<ClaimedJob[]> {
  const admin = createSupabaseAdminClient();
  const now = options.now ?? new Date();
  const limit = options.limit ?? 5;

  // Lease muddati o'tgan ishlarni qaytarib olamiz: worker o'lgan
  // bo'lsa, suhbat abadiy bloklanib qolmasligi kerak.
  await admin
    .from("sales_ai_jobs")
    .update({ status: "queued", claim_token: null, claimed_by: null, lease_expires_at: null })
    .eq("status", "claimed")
    .lt("lease_expires_at", now.toISOString());

  const { data } = await admin
    .from("sales_ai_jobs")
    .select("id, conversation_id, message_id, generation_type, status, attempts, max_attempts, enqueued_at, priority, available_at")
    .in("status", ["queued", "waiting", "failed_retryable"])
    .lte("available_at", now.toISOString())
    .order("priority", { ascending: true })
    .order("enqueued_at", { ascending: true })
    .limit(limit * 6);

  const rows: QueuedJobRow[] = (data ?? []).map((row) => ({
    id: row.id as string,
    conversationId: row.conversation_id as string,
    messageId: (row.message_id as string | null) ?? null,
    state: row.status as JobState,
    enqueuedAt: (row.enqueued_at as string) ?? new Date(0).toISOString(),
    priority: (row.priority as number) ?? 100,
    availableAt: (row.available_at as string) ?? new Date(0).toISOString(),
  }));

  const candidates = selectNextJobs(rows, { now, limit });
  const claimed: ClaimedJob[] = [];

  for (const candidate of candidates) {
    const token = randomUUID();
    const { data: updated } = await admin
      .from("sales_ai_jobs")
      .update({
        status: "claimed",
        claim_token: token,
        claimed_by: options.workerId,
        claimed_at: now.toISOString(),
        lease_expires_at: leaseExpiry(now).toISOString(),
      })
      .eq("id", candidate.id)
      // SHART: holat hali ham o'zgarmagan bo'lsin. Boshqa worker
      // ulgurgan bo'lsa bu shart bajarilmaydi va qator qaytmaydi.
      .eq("status", candidate.state)
      .select("id, conversation_id, message_id, generation_type, attempts, max_attempts");

    if (!updated || updated.length === 0) continue;

    const row = updated[0];
    claimed.push({
      id: row.id as string,
      conversationId: row.conversation_id as string,
      messageId: (row.message_id as string | null) ?? null,
      kind: (row.generation_type as string) ?? "reply",
      attempts: (row.attempts as number) ?? 0,
      maxAttempts: (row.max_attempts as number) ?? DEFAULT_MAX_ATTEMPTS,
      claimToken: token,
    });
  }

  return claimed;
}

/** Ish muvaffaqiyatli tugadi. */
export async function completeJob(jobId: string, claimToken: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_ai_jobs")
    .update({
      status: "succeeded",
      claim_token: null,
      lease_expires_at: null,
      error: null,
    })
    .eq("id", jobId)
    .eq("claim_token", claimToken);
}

/** Ish kerak bo'lmay qoldi (opt-out, takeover, rollout). */
export async function skipJob(
  jobId: string,
  claimToken: string,
  reason: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_ai_jobs")
    .update({
      status: "skipped",
      claim_token: null,
      lease_expires_at: null,
      refusal_reason: reason.slice(0, 300),
    })
    .eq("id", jobId)
    .eq("claim_token", claimToken);
}

/**
 * Ish xato bilan tugadi.
 *
 * Qaror (qayta urinishmi yoki dead-letter) SOF modulda
 * hisoblanadi — shuning uchun uni testda to'g'ridan-to'g'ri
 * tekshirish mumkin.
 */
export async function failJob(input: {
  jobId: string;
  claimToken: string;
  attempts: number;
  maxAttempts: number;
  error: string;
  permanent?: boolean;
  now?: Date;
}): Promise<{ state: JobState; reason: string }> {
  const admin = createSupabaseAdminClient();
  const now = input.now ?? new Date();

  const decision = decideAfterFailure(
    { state: "claimed", attempts: input.attempts, maxAttempts: input.maxAttempts },
    { now, permanent: input.permanent },
  );

  await admin
    .from("sales_ai_jobs")
    .update({
      status: decision.state,
      attempts: decision.attempts,
      available_at: (decision.availableAt ?? now).toISOString(),
      claim_token: null,
      lease_expires_at: null,
      error: input.error.slice(0, 500),
      last_error_at: now.toISOString(),
      dead_lettered_at: decision.state === "dead_letter" ? now.toISOString() : null,
    })
    .eq("id", input.jobId)
    .eq("claim_token", input.claimToken);

  return { state: decision.state, reason: decision.reason };
}

export interface QueueStats {
  queued: number;
  claimed: number;
  waiting: number;
  failedRetryable: number;
  deadLetter: number;
  succeeded: number;
  skipped: number;
}

export async function queueStats(): Promise<QueueStats> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("sales_ai_jobs").select("status");

  const stats: QueueStats = {
    queued: 0,
    claimed: 0,
    waiting: 0,
    failedRetryable: 0,
    deadLetter: 0,
    succeeded: 0,
    skipped: 0,
  };

  for (const row of data ?? []) {
    switch (row.status as string) {
      case "queued": stats.queued += 1; break;
      case "claimed": stats.claimed += 1; break;
      case "waiting": stats.waiting += 1; break;
      case "failed_retryable": stats.failedRetryable += 1; break;
      case "dead_letter": stats.deadLetter += 1; break;
      case "succeeded":
      case "sent": stats.succeeded += 1; break;
      case "skipped": stats.skipped += 1; break;
    }
  }
  return stats;
}
