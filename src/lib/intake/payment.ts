import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { tashkentDayRange } from "@/lib/tashkent-day";
import { addToBlacklist, findBlacklistedSlugs, isBlacklisted } from "./blacklist";
import { findPublishedNamesake } from "./namesake";
import { slugify } from "@/lib/utils";
import {
  answerCallbackQuery,
  editTelegramMessageText,
  isTelegramConfigured,
  sendTelegramMessage,
} from "@/lib/post-studio/telegram-api";
import { getPostDeliveryChatIds } from "@/lib/post-studio/delivery-recipients";
import {
  buildBotStatusReportText,
  buildPaymentAnswerText,
  buildPaymentQuestion,
  buildPaymentUndoList,
  buildPaymentUndoResult,
  blacklistCallbackData,
  buildBlacklistedText,
  buildBlacklistWarningText,
  withinAskingHours,
  PAYMENT_BLACKLIST_LABEL,
  PAYMENT_NO_LABEL,
  PAYMENT_PUBLISH_DELAY_MS,
  PAYMENT_YES_LABEL,
  paymentCallbackData,
  paymentUndoCallbackData,
  UNDO_LIST_SIZE,
  type BotStatusCounts,
  type UndoCandidate,
} from "./payment-messages";

/**
 * To'lov tasdiqlash oqimi.
 *
 * Tizimda umuman to'lov ma'lumoti yo'q edi, shuning uchun manba — tahririyat
 * o'zi: bot har 2 soatda to'lanmagan nomzodni sozlangan chatlarga tugmalar
 * bilan yuboradi, "Ha" bosilishi esa nashr oqimini OCHADI.
 *
 * Muhim qoida: javob berilmagan nomzod "to'lov qilmagan" DEB HISOBLANMAYDI —
 * u 'unknown' bo'lib qoladi va hisobotda alohida ko'rsatiladi.
 */

/** How long to wait before asking about the same candidate again. */
export const PAYMENT_ASK_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * Upper bound on how far back the sweep reaches. Defence in depth: a backfill
 * or a bulk status change must never turn months of history into one flood of
 * bot messages.
 */
export const PAYMENT_MAX_AGE_DAYS = 14;

/** Candidates asked about per sweep, to stay inside the function budget. */
export const PAYMENT_ASK_BATCH_SIZE = 10;

/**
 * Statuses that still await payment. `published` is excluded — money for an
 * already-published candidate is not this loop's business — and so are `draft`
 * (form unfinished) and `archived`.
 */
const AWAITING_PAYMENT_STATUSES = ["submitted", "approved", "promoted"] as const;

export {
  BATCH_BUTTON_LABEL,
  parseBlacklistCallback,
  parsePaymentCallback,
  parsePaymentUndoCallback,
  REPORT_BUTTON_LABEL,
  UNDO_BUTTON_LABEL,
  withinAskingHours,
} from "./payment-messages";

interface PayableIntake {
  id: string;
  full_name: string;
  phone_e164: string | null;
  telegram_username: string | null;
  submitted_at: string | null;
  payment_ask_count: number;
}

/**
 * Candidates whose payment is still open and whose two-hour window has elapsed.
 *
 * Ordered by the least-recently-asked first, so a growing backlog is served
 * round-robin rather than starving the oldest rows behind newer ones.
 */
export async function findIntakesNeedingPaymentAsk(
  limit = PAYMENT_ASK_BATCH_SIZE,
): Promise<PayableIntake[]> {
  const db = createSupabaseAdminClient();
  const now = Date.now();
  const oldestAllowed = new Date(now - PAYMENT_MAX_AGE_DAYS * 86400000).toISOString();
  const askableBefore = new Date(now - PAYMENT_ASK_INTERVAL_MS).toISOString();

  const { data, error } = await db
    .from("candidate_intakes")
    .select("id, full_name, phone_e164, telegram_username, submitted_at, payment_ask_count")
    .is("deleted_at", null)
    .in("status", AWAITING_PAYMENT_STATUSES)
    .neq("payment_status", "paid")
    .not("submitted_at", "is", null)
    .gte("submitted_at", oldestAllowed)
    .or(`payment_last_asked_at.is.null,payment_last_asked_at.lte.${askableBefore}`)
    .order("payment_last_asked_at", { ascending: true, nullsFirst: true })
    .order("submitted_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[payment] sweep query failed", error.message);
    return [];
  }
  return (data ?? []) as PayableIntake[];
}

export interface PaymentAskResult {
  intakeId: string;
  fullName: string;
  round: number;
  sent: number;
  failed: number;
}

/**
 * Sends one candidate's question to every editorial chat.
 *
 * The "asked" stamp is written even when every chat failed. Otherwise a bot
 * that is misconfigured (blocked, wrong id) would be retried on every cron
 * tick instead of every two hours, and the log would fill with the same error.
 */
async function askOne(intake: PayableIntake, chatIds: number[]): Promise<PaymentAskResult> {
  const db = createSupabaseAdminClient();
  const round = intake.payment_ask_count + 1;
  const text = buildPaymentQuestion({
    fullName: intake.full_name,
    phone: intake.phone_e164,
    telegramUsername: intake.telegram_username,
    submittedAt: intake.submitted_at,
    round,
  });
  const inlineKeyboard = [
    [{ text: PAYMENT_YES_LABEL, callback_data: paymentCallbackData(intake.id, true) }],
    [{ text: PAYMENT_NO_LABEL, callback_data: paymentCallbackData(intake.id, false) }],
    [{ text: PAYMENT_BLACKLIST_LABEL, callback_data: blacklistCallbackData(intake.id) }],
  ];

  const rows: Record<string, unknown>[] = [];
  let sent = 0;
  let failed = 0;

  for (const chatId of chatIds) {
    try {
      const message = await sendTelegramMessage(chatId, text, { inlineKeyboard });
      sent += 1;
      rows.push({
        intake_id: intake.id,
        chat_id: chatId,
        telegram_message_id: message.messageId,
        round,
        status: "sent",
      });
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[payment] ask failed chat=${chatId}`, error);
      rows.push({
        intake_id: intake.id,
        chat_id: chatId,
        round,
        status: "failed",
        error: error.slice(0, 500),
      });
    }
  }

  if (rows.length > 0) await db.from("intake_payment_requests").insert(rows);
  await db
    .from("candidate_intakes")
    .update({
      payment_last_asked_at: new Date().toISOString(),
      payment_ask_count: round,
    })
    .eq("id", intake.id);

  return { intakeId: intake.id, fullName: intake.full_name, round, sent, failed };
}

/**
 * One sweep: asks about every candidate whose two-hour window has elapsed.
 *
 * Outside 09:00–21:00 nothing is sent. The question repeats every two hours
 * until answered, so without the quiet window an unanswered candidate would
 * wake the editors through the night — and the `payment_last_asked_at` stamp is
 * deliberately NOT touched when we skip, so the morning sweep picks everyone up
 * rather than treating the night as if they had been asked.
 */
export async function runPaymentAskSweep(
  chatIds: number[],
  limit = PAYMENT_ASK_BATCH_SIZE,
  now: Date = new Date(),
): Promise<PaymentAskResult[]> {
  if (!isTelegramConfigured() || chatIds.length === 0) return [];
  if (!withinAskingHours(now)) return [];

  const due = await findIntakesNeedingPaymentAsk(limit);
  if (due.length === 0) return [];

  // Two whole groups are dropped before anything is sent:
  //
  //  - anyone already on the site. Their article is out; asking whether they
  //    paid is noise, and the answer would trigger a republish.
  //  - anyone blacklisted. The contract is over; the point of the list is that
  //    nobody has to remember that.
  const blacklisted = await findBlacklistedSlugs(due.map((i) => i.full_name));
  const results: PaymentAskResult[] = [];

  for (const intake of due) {
    if (blacklisted.has(slugify(intake.full_name))) {
      await markAsked(intake.id, intake.payment_ask_count);
      continue;
    }
    if (await findPublishedNamesake(intake.full_name, null)) {
      await markAsked(intake.id, intake.payment_ask_count);
      continue;
    }
    results.push(await askOne(intake, chatIds));
  }
  return results;
}

/**
 * Stamps a candidate as handled without sending anything.
 *
 * Skipped rows still need the stamp, or every sweep would re-examine the same
 * ones ahead of candidates that genuinely need asking.
 */
async function markAsked(intakeId: string, askCount: number): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("candidate_intakes")
    .update({ payment_last_asked_at: new Date().toISOString(), payment_ask_count: askCount })
    .eq("id", intakeId);
}

export interface PaymentAskChunkResult {
  ok: boolean;
  error?: string;
  /** Candidates whose question actually went out to at least one chat. */
  asked: number;
  /** Already confirmed as paid, so nothing was sent. */
  alreadyPaid: number;
  failed: number;
  results: PaymentAskResult[];
}

/**
 * Asks about a specific set of candidates, now.
 *
 * The admin pressing the button is an explicit instruction, so the two-hour
 * gap that governs the automatic sweep does not apply here. Candidates who are
 * already confirmed as paid are still skipped — re-asking a settled question
 * is how a chat ends up with two live answers for one candidate.
 */
export async function askPaymentForIntakes(
  intakeIds: string[],
  chatIds?: number[],
): Promise<PaymentAskChunkResult> {
  const empty: PaymentAskChunkResult = {
    ok: true,
    asked: 0,
    alreadyPaid: 0,
    failed: 0,
    results: [],
  };
  if (intakeIds.length === 0) return empty;
  if (!isTelegramConfigured()) {
    return { ...empty, ok: false, error: "TELEGRAM_BOT_TOKEN sozlanmagan" };
  }

  const recipients = chatIds ?? (await resolveAskRecipients());
  if (recipients.length === 0) {
    return { ...empty, ok: false, error: "To‘lov savoli yuboriladigan chat sozlanmagan." };
  }

  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("candidate_intakes")
    .select("id, full_name, phone_e164, telegram_username, submitted_at, payment_ask_count, payment_status")
    .in("id", intakeIds)
    .is("deleted_at", null)
    .in("status", AWAITING_PAYMENT_STATUSES)
    .order("submitted_at", { ascending: true });

  const rows = (data ?? []) as (PayableIntake & { payment_status: string })[];
  const result: PaymentAskChunkResult = { ...empty, results: [] };

  for (const intake of rows) {
    if (intake.payment_status === "paid") {
      result.alreadyPaid += 1;
      continue;
    }
    const asked = await askOne(intake, recipients);
    result.results.push(asked);
    if (asked.sent > 0) result.asked += 1;
    else result.failed += 1;
  }

  return result;
}

/**
 * Where payment questions go.
 *
 * Deliberately the same list the finished posts use: one place to configure,
 * so an editor added there starts receiving both without a second setting.
 */
async function resolveAskRecipients(): Promise<number[]> {
  return getPostDeliveryChatIds();
}

/**
 * Asks about one candidate the moment their form lands.
 *
 * Waiting for the two-hourly sweep meant a candidate could sit unasked for
 * almost two hours before anyone was even told they existed. Submission is the
 * natural trigger, and the sweep stays as the safety net for anyone this misses.
 *
 * Never throws: a Telegram outage must not turn a successfully submitted form
 * into an error for the candidate who just filled it in.
 */
export async function askPaymentOnSubmit(intakeId: string): Promise<void> {
  try {
    // A blacklisted person coming back gets a warning INSTEAD of a payment
    // question. That is the whole value of the list: they can return months
    // later under a fresh form, and nobody has to have remembered.
    if (await warnIfBlacklisted(intakeId)) return;

    const result = await askPaymentForIntakes([intakeId]);
    if (!result.ok) {
      console.error("[payment] submit ask refused:", result.error);
      return;
    }
    console.log(`[payment] submit ask sent intake=${intakeId} asked=${result.asked}`);
  } catch (err) {
    console.error(
      "[payment] submit ask failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Sends the blacklist warning if this intake belongs to a listed person.
 *
 * Returns true when a warning went out, so the caller knows not to ask about
 * payment as well. The warning is sent unconditionally rather than once per
 * person: a returning candidate is exactly the moment the editors need to see
 * it, however many times it happens.
 */
export async function warnIfBlacklisted(intakeId: string): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { data: intake } = await db
    .from("candidate_intakes")
    .select("id, full_name, phone_e164, telegram_username")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) return false;

  const entry = await isBlacklisted(intake.full_name as string);
  if (!entry) return false;

  const text = buildBlacklistWarningText({
    fullName: intake.full_name as string,
    phone: (intake.phone_e164 as string | null) ?? null,
    telegramUsername: (intake.telegram_username as string | null) ?? null,
    reason: entry.reason,
    listedAt: entry.createdAt,
  });

  for (const chatId of await resolveAskRecipients()) {
    try {
      await sendTelegramMessage(chatId, text);
    } catch (err) {
      console.error("[blacklist] warning send failed", err instanceof Error ? err.message : err);
    }
  }

  await logAudit({
    actorId: null,
    action: "intake.blacklist_warning",
    entityType: "candidate_intake",
    entityId: intakeId,
    severity: "warning",
    metadata: { fullName: intake.full_name, reason: entry.reason },
  });
  return true;
}

/* ------------------------------------------------------------------ *
 * Blacklist button
 * ------------------------------------------------------------------ */

/**
 * "Bu kishi bilan shartnoma buzuldi".
 *
 * Records the person by name, closes every open question about them, and takes
 * them out of the publish queue. Payment is set to `unpaid` rather than left
 * alone so no other path can mistake them for cleared to publish.
 */
export async function handleBlacklistCallback(input: {
  intakeId: string;
  chatId: number | null;
  messageId: number | null;
  fromUserId: number | null;
  callbackQueryId: string;
}): Promise<PaymentCallbackOutcome> {
  const db = createSupabaseAdminClient();
  await safeAnswer(input.callbackQueryId, "🚫 Qora ro‘yxatga olindi");

  const { data: intake } = await db
    .from("candidate_intakes")
    .select("id, full_name")
    .eq("id", input.intakeId)
    .maybeSingle();
  if (!intake) return "not_found";

  const fullName = intake.full_name as string;
  const added = await addToBlacklist({
    fullName,
    intakeId: input.intakeId,
    chatId: input.chatId,
  });
  if (!added.ok) return "error";

  await db
    .from("candidate_intakes")
    .update({
      payment_status: "unpaid",
      payment_confirmed_at: null,
      payment_confirmed_by_chat_id: null,
      post_pipeline_status: "skipped",
      post_pipeline_error: "Shartnoma buzildi — qora ro‘yxat",
    })
    .eq("id", input.intakeId);

  const answerText = buildBlacklistedText(fullName);
  await closeOpenRequests(
    input.intakeId,
    false,
    input.fromUserId,
    answerText,
    input.chatId,
    input.messageId,
  );

  return "recorded";
}

/* ------------------------------------------------------------------ *
 * Answering
 * ------------------------------------------------------------------ */

export type PaymentCallbackOutcome =
  | "recorded"
  | "already_paid"
  | "not_found"
  | "error";

export interface PaymentCallbackInput {
  intakeId: string;
  paid: boolean;
  chatId: number | null;
  messageId: number | null;
  fromUserId: number | null;
  callbackQueryId: string;
}

/**
 * Records one tapped answer.
 *
 * The button spinner is cleared BEFORE any database work: Telegram shows the
 * tapper a failure if nothing answers within a few seconds, and the write is
 * not fast enough to rely on.
 *
 * "Paid" is written with a `payment_status <> 'paid'` guard, so two editors
 * tapping at the same moment produce exactly one state change and exactly one
 * pipeline enqueue — the first answer wins and the second is a no-op.
 */
export async function handlePaymentCallback(
  input: PaymentCallbackInput,
): Promise<PaymentCallbackOutcome> {
  const db = createSupabaseAdminClient();

  await safeAnswer(
    input.callbackQueryId,
    input.paid ? "✅ To‘lov qilgan deb belgilandi" : "❌ To‘lov qilmagan deb belgilandi",
  );

  const { data: intake } = await db
    .from("candidate_intakes")
    .select("id, full_name, payment_status, status")
    .eq("id", input.intakeId)
    .maybeSingle();

  if (!intake) {
    if (input.chatId && input.messageId) {
      await safeEdit(input.chatId, input.messageId, "⚠️ Anketa topilmadi (o‘chirilgan bo‘lishi mumkin).");
    }
    return "not_found";
  }

  const alreadyPaid = (intake.payment_status as string) === "paid";
  const answerText = buildPaymentAnswerText(
    { fullName: intake.full_name as string },
    input.paid || alreadyPaid,
  );

  if (alreadyPaid) {
    // A stale button from an earlier round. Rewrite it so the chat shows the
    // settled state, but never downgrade a paid candidate back to unpaid.
    await closeOpenRequests(input.intakeId, true, input.fromUserId, answerText, input.chatId, input.messageId);
    return "already_paid";
  }

  const patch: Record<string, unknown> = { payment_status: input.paid ? "paid" : "unpaid" };
  if (input.paid) {
    patch.payment_confirmed_at = new Date().toISOString();
    patch.payment_confirmed_by_chat_id = input.chatId;
    // Publishing is gated on payment, so confirming it is what puts the intake
    // in front of the worker. attempts reset because this is a fresh mandate,
    // not a retry of a failed run.
    //
    // The run is scheduled ten minutes out rather than immediately: publishing
    // an article and posting it to every editorial chat cannot be undone, and a
    // mis-tap needs a window in which it still can be.
    patch.post_pipeline_status = "pending";
    patch.post_pipeline_process_after = new Date(
      Date.now() + PAYMENT_PUBLISH_DELAY_MS,
    ).toISOString();
    patch.post_pipeline_attempts = 0;
    patch.post_pipeline_error = null;
  }

  const { data: updated, error } = await db
    .from("candidate_intakes")
    .update(patch)
    .eq("id", input.intakeId)
    .neq("payment_status", "paid")
    .select("id");

  if (error) {
    console.error("[payment] status write failed", error.message);
    return "error";
  }
  if ((updated?.length ?? 0) === 0) return "already_paid";

  await closeOpenRequests(
    input.intakeId,
    input.paid,
    input.fromUserId,
    answerText,
    input.chatId,
    input.messageId,
  );

  await logAudit({
    actorId: null,
    action: input.paid ? "intake.payment_confirmed" : "intake.payment_declined",
    entityType: "candidate_intake",
    entityId: input.intakeId,
    severity: "info",
    metadata: {
      paid: input.paid,
      chatId: input.chatId,
      telegramUserId: input.fromUserId,
      queuedForPublish: input.paid,
    },
  });

  return "recorded";
}

/**
 * Settles the question in every chat it was sent to.
 *
 * The same question goes to several editors at once; leaving live buttons in
 * the other chats is what would let a second person "answer" a decided
 * question. Each edit is best-effort — Telegram rejects an edit whose text is
 * unchanged, and that must not fail the write that already succeeded.
 */
async function closeOpenRequests(
  intakeId: string,
  paid: boolean,
  fromUserId: number | null,
  answerText: string,
  answeredChatId: number | null,
  answeredMessageId: number | null,
): Promise<void> {
  const db = createSupabaseAdminClient();

  const { data: open } = await db
    .from("intake_payment_requests")
    .select("id, chat_id, telegram_message_id")
    .eq("intake_id", intakeId)
    .eq("status", "sent");

  await db
    .from("intake_payment_requests")
    .update({
      status: paid ? "answered_yes" : "answered_no",
      answered_at: new Date().toISOString(),
      answered_by_user_id: fromUserId,
    })
    .eq("intake_id", intakeId)
    .eq("status", "sent");

  const edited = new Set<string>();
  for (const row of open ?? []) {
    const chatId = Number(row.chat_id);
    const messageId = row.telegram_message_id as number | null;
    if (!messageId) continue;
    edited.add(`${chatId}:${messageId}`);
    await safeEdit(chatId, messageId, answerText);
  }

  // The tapped message may predate the rows above (an older round), so it is
  // rewritten explicitly when the loop did not already cover it.
  if (answeredChatId && answeredMessageId && !edited.has(`${answeredChatId}:${answeredMessageId}`)) {
    await safeEdit(answeredChatId, answeredMessageId, answerText);
  }
}

async function safeAnswer(callbackQueryId: string, text: string): Promise<void> {
  try {
    await answerCallbackQuery(callbackQueryId, text);
  } catch (err) {
    console.error("[payment] answerCallbackQuery failed", err instanceof Error ? err.message : err);
  }
}

async function safeEdit(chatId: number, messageId: number, text: string): Promise<void> {
  try {
    await editTelegramMessageText(chatId, messageId, text);
  } catch (err) {
    console.error("[payment] editMessageText failed", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ *
 * Undo — "to'lov statusida adashish"
 * ------------------------------------------------------------------ */

export interface UndoListPayload {
  text: string;
  /** Numbered buttons, laid out five to a row. */
  keyboard: { text: string; callback_data: string }[][];
}

/**
 * The most recent payment confirmations, newest first.
 *
 * Ten is enough to catch a mis-tap without turning the message into a wall:
 * a mistake is noticed within minutes, not days.
 */
export async function buildPaymentUndoPayload(): Promise<UndoListPayload> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("candidate_intakes")
    .select("id, full_name, payment_confirmed_at, status")
    .eq("payment_status", "paid")
    .is("deleted_at", null)
    .order("payment_confirmed_at", { ascending: false, nullsFirst: false })
    .limit(UNDO_LIST_SIZE);

  const candidates: UndoCandidate[] = (data ?? []).map((row) => ({
    id: row.id as string,
    fullName: row.full_name as string,
    confirmedAt: (row.payment_confirmed_at as string | null) ?? null,
    published: (row.status as string) === "published",
  }));

  const keyboard: UndoListPayload["keyboard"] = [];
  for (let i = 0; i < candidates.length; i += 5) {
    keyboard.push(
      candidates.slice(i, i + 5).map((candidate, offset) => ({
        text: String(i + offset + 1),
        callback_data: paymentUndoCallbackData(candidate.id),
      })),
    );
  }

  return { text: buildPaymentUndoList(candidates), keyboard };
}

export interface UndoOutcome {
  ok: boolean;
  text: string;
}

/**
 * Puts a candidate back to "not paid" and takes them out of the publish queue.
 *
 * The queue removal is the point: within the ten-minute grace period nothing
 * has run yet, so this fully undoes the confirmation. Past that the article and
 * post already exist and cannot be recalled from here — the message says so
 * rather than implying a rollback that did not happen.
 */
export async function undoPaymentConfirmation(intakeId: string): Promise<UndoOutcome> {
  const db = createSupabaseAdminClient();

  const { data: intake } = await db
    .from("candidate_intakes")
    .select("id, full_name, payment_status, status")
    .eq("id", intakeId)
    .maybeSingle();

  if (!intake) return { ok: false, text: "⚠️ Anketa topilmadi." };
  if ((intake.payment_status as string) !== "paid") {
    return {
      ok: false,
      text: `ℹ️ ${intake.full_name} allaqachon “to‘lov qilgan” emas — o‘zgarish kerak emas.`,
    };
  }

  const published = (intake.status as string) === "published";

  const { error } = await db
    .from("candidate_intakes")
    .update({
      payment_status: "unpaid",
      payment_confirmed_at: null,
      payment_confirmed_by_chat_id: null,
      // Taken off the queue. 'skipped' rather than null so the row reads as a
      // deliberate decision instead of one the trigger never scheduled.
      post_pipeline_status: "skipped",
      post_pipeline_error: null,
      // Asked about again on the next sweep rather than immediately, so an undo
      // does not bounce the same question straight back into the chat.
      payment_last_asked_at: new Date().toISOString(),
    })
    .eq("id", intakeId)
    .eq("payment_status", "paid");

  if (error) {
    console.error("[payment] undo failed", error.message);
    return { ok: false, text: "⚠️ Bekor qilib bo‘lmadi — qayta urinib ko‘ring." };
  }

  await logAudit({
    actorId: null,
    action: "intake.payment_undone",
    entityType: "candidate_intake",
    entityId: intakeId,
    severity: "warning",
    metadata: { alreadyPublished: published },
  });

  return {
    ok: true,
    text: buildPaymentUndoResult({ fullName: intake.full_name as string, published }),
  };
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

/** Counts for the bot's "Hozirgi hisobot" button. */
export async function buildBotStatusReport(): Promise<string> {
  const db = createSupabaseAdminClient();
  const day = tashkentDayRange();

  // Every tally is a head-only `count: exact` query — no rows cross the wire,
  // and the whole report is one round of parallel counts.
  const intakes = () =>
    db.from("candidate_intakes").select("id", { count: "exact", head: true }).is("deleted_at", null);
  const posts = () => db.from("candidate_social_posts").select("id", { count: "exact", head: true });
  const submitted = () => intakes().not("submitted_at", "is", null);

  const [
    fillingTotal,
    submittedTotal,
    paidTotal,
    unpaidTotal,
    unknownTotal,
    postsTotal,
    publishedTotal,
    fillingToday,
    submittedToday,
    paidToday,
    unpaidToday,
    postsToday,
    publishedToday,
  ] = await Promise.all([
    intakes().eq("status", "draft"),
    submitted(),
    submitted().eq("payment_status", "paid"),
    submitted().eq("payment_status", "unpaid"),
    submitted().eq("payment_status", "unknown"),
    posts(),
    intakes().eq("status", "published"),
    intakes().eq("status", "draft").gte("created_at", day.startIso).lt("created_at", day.endIso),
    submitted().gte("submitted_at", day.startIso).lt("submitted_at", day.endIso),
    submitted()
      .eq("payment_status", "paid")
      .gte("submitted_at", day.startIso)
      .lt("submitted_at", day.endIso),
    submitted()
      .eq("payment_status", "unpaid")
      .gte("submitted_at", day.startIso)
      .lt("submitted_at", day.endIso),
    posts().gte("created_at", day.startIso).lt("created_at", day.endIso),
    intakes()
      .eq("status", "published")
      .gte("published_at", day.startIso)
      .lt("published_at", day.endIso),
  ]);

  const n = (result: { count: number | null }) => result.count ?? 0;

  const total: BotStatusCounts = {
    filling: n(fillingTotal),
    submitted: n(submittedTotal),
    paid: n(paidTotal),
    unpaid: n(unpaidTotal),
    paymentUnknown: n(unknownTotal),
    posts: n(postsTotal),
    published: n(publishedTotal),
  };
  const todayCounts: BotStatusCounts = {
    filling: n(fillingToday),
    submitted: n(submittedToday),
    paid: n(paidToday),
    unpaid: n(unpaidToday),
    paymentUnknown: Math.max(0, n(submittedToday) - n(paidToday) - n(unpaidToday)),
    posts: n(postsToday),
    published: n(publishedToday),
  };

  return buildBotStatusReportText({ total, today: todayCounts, todayDate: day.date });
}
