import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  formatTashkent,
  tashkentDayRange,
  tashkentHour,
  tashkentOffsetMinutes,
} from "../src/lib/tashkent-day.ts";
import {
  classifyPayment,
  selectEligibleForBatch,
  sortBySubmittedAt,
} from "../src/lib/intake/queue-order.ts";
import {
  buildBotStatusReportText,
  buildPaymentAnswerText,
  buildPaymentQuestion,
  parsePaymentCallback,
  paymentCallbackData,
  REPORT_BUTTON_LABEL,
} from "../src/lib/intake/payment-messages.ts";

const MIGRATION = fs.readFileSync(
  "supabase/migrations/20260904120000_intake_payment_and_publish_batches.sql",
  "utf8",
);
const BATCH = fs.readFileSync("src/lib/intake/publish-batch.ts", "utf8");
const PAYMENT = fs.readFileSync("src/lib/intake/payment.ts", "utf8");
const PIPELINE = fs.readFileSync("src/lib/post-studio/pipeline.ts", "utf8");
const TELEGRAM = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");

/* ------------------------------------------------------------------ *
 * "Bugun" — Asia/Tashkent
 * ------------------------------------------------------------------ */

test("Tashkent is read from the zone database, not hardcoded as +05:00", () => {
  assert.equal(tashkentOffsetMinutes(new Date("2026-09-04T10:00:00Z")), 300);
  // Same in January: Uzbekistan keeps no daylight saving, so the range never
  // shifts under the panel mid-year.
  assert.equal(tashkentOffsetMinutes(new Date("2026-01-15T10:00:00Z")), 300);
});

test("reading the offset never mutates the caller's Date", () => {
  const instant = new Date("2026-09-04T10:00:00.750Z");
  tashkentOffsetMinutes(instant);
  assert.equal(instant.toISOString(), "2026-09-04T10:00:00.750Z");
});

test("today's range covers exactly one Tashkent calendar day", () => {
  const range = tashkentDayRange(new Date("2026-09-04T10:00:00Z"));
  assert.equal(range.date, "2026-09-04");
  assert.equal(range.startIso, "2026-09-03T19:00:00.000Z");
  assert.equal(range.endIso, "2026-09-04T19:00:00.000Z");
});

test("the day boundary includes midnight and excludes the next one", () => {
  const range = tashkentDayRange(new Date("2026-09-04T10:00:00Z"));
  const start = Date.parse(range.startIso);
  const end = Date.parse(range.endIso);
  const inRange = (iso: string) => {
    const t = Date.parse(iso);
    return t >= start && t < end;
  };

  // 23:59:59 the previous day (Tashkent) — excluded.
  assert.equal(inRange("2026-09-03T18:59:59Z"), false);
  // 00:00:00 today — included, because the lower bound is inclusive.
  assert.equal(inRange("2026-09-03T19:00:00Z"), true);
  // 23:59:59 today — included.
  assert.equal(inRange("2026-09-04T18:59:59Z"), true);
  // 00:00:00 tomorrow — excluded, because the upper bound is exclusive. A row
  // stamped exactly at midnight therefore belongs to one day only.
  assert.equal(inRange("2026-09-04T19:00:00Z"), false);
});

test("a UTC server past 19:00 already shows the next Tashkent day", () => {
  // 19:05 UTC is 00:05 the following morning in Tashkent. Using the server's
  // own date here is what would keep the board on yesterday until 05:00 UTC.
  assert.equal(tashkentDayRange(new Date("2026-09-04T19:05:00Z")).date, "2026-09-05");
  assert.equal(tashkentDayRange(new Date("2026-09-04T18:55:00Z")).date, "2026-09-04");
});

test("wall-clock helpers report Tashkent time, not UTC", () => {
  assert.equal(tashkentHour(new Date("2026-09-04T19:30:00Z")), 0);
  assert.equal(formatTashkent("2026-09-04T09:05:00Z"), "04.09.2026 14:05");
  assert.equal(formatTashkent(null), "—");
  assert.equal(formatTashkent("not a date"), "—");
});

/* ------------------------------------------------------------------ *
 * Navbat tartibi
 * ------------------------------------------------------------------ */

const row = (
  id: string,
  submittedAt: string | null,
  paymentStatus = "paid",
  status = "submitted",
) => ({ id, submittedAt, paymentStatus, status });

test("the earliest submission is processed first", () => {
  const ordered = sortBySubmittedAt([
    row("b", "2026-09-04T09:00:00Z"),
    row("a", "2026-09-04T07:30:00Z"),
    row("c", "2026-09-04T11:00:00Z"),
  ]);
  assert.deepEqual(
    ordered.map((r) => r.id),
    ["a", "b", "c"],
  );
});

test("ordering is total and stable, and undated rows never jump the queue", () => {
  const ordered = sortBySubmittedAt([
    row("z", null),
    row("m", "2026-09-04T08:00:00Z"),
    row("n", "2026-09-04T08:00:00Z"),
  ]);
  assert.deepEqual(
    ordered.map((r) => r.id),
    ["m", "n", "z"],
  );
  // Sorting does not mutate the input.
  const input = [row("b", "2026-09-04T09:00:00Z"), row("a", "2026-09-04T07:00:00Z")];
  sortBySubmittedAt(input);
  assert.equal(input[0].id, "b");
});

test("a batch queues only paid, unpublished candidates", () => {
  const rows = [
    row("paid", "2026-09-04T08:00:00Z", "paid"),
    row("unpaid", "2026-09-04T08:01:00Z", "unpaid"),
    row("unknown", "2026-09-04T08:02:00Z", "unknown"),
    row("done", "2026-09-04T08:03:00Z", "paid", "published"),
  ];
  assert.deepEqual(
    selectEligibleForBatch(rows, null).map((r) => r.id),
    ["paid"],
  );
});

test("an unanswered payment question is not permission to publish", () => {
  // "unknown" is neither a yes nor a no: it must not be published, and it must
  // not be reported as a refusal either.
  assert.equal(selectEligibleForBatch([row("x", "2026-09-04T08:00:00Z", "unknown")], null).length, 0);
  assert.equal(classifyPayment("unknown"), "unknown");
  assert.equal(classifyPayment(null), "unknown");
  assert.equal(classifyPayment(undefined), "unknown");
  assert.equal(classifyPayment("weird-value"), "unknown");
  assert.notEqual(classifyPayment(null), "unpaid");
  assert.equal(classifyPayment("paid"), "paid");
  assert.equal(classifyPayment("unpaid"), "unpaid");
});

test("selection narrows the batch without touching anyone else", () => {
  const rows = [
    row("a", "2026-09-04T08:00:00Z"),
    row("b", "2026-09-04T08:01:00Z"),
    row("c", "2026-09-04T08:02:00Z"),
    row("d", "2026-09-04T08:03:00Z"),
    row("e", "2026-09-04T08:04:00Z"),
  ];
  const picked = selectEligibleForBatch(rows, ["c", "a"]);
  assert.equal(picked.length, 2);
  // Ticking "c" before "a" must not put c first: order is submission order.
  assert.deepEqual(
    picked.map((r) => r.id),
    ["a", "c"],
  );
});

test("selecting an unpaid candidate does not force them through", () => {
  const rows = [row("a", "2026-09-04T08:00:00Z", "unpaid")];
  assert.equal(selectEligibleForBatch(rows, ["a"]).length, 0);
});

/* ------------------------------------------------------------------ *
 * To'lov savoli
 * ------------------------------------------------------------------ */

test("a tapped button round-trips to its intake and answer", () => {
  const id = "3f1c2d4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f";
  assert.deepEqual(parsePaymentCallback(paymentCallbackData(id, true)), {
    intakeId: id,
    paid: true,
  });
  assert.deepEqual(parsePaymentCallback(paymentCallbackData(id, false)), {
    intakeId: id,
    paid: false,
  });
});

test("callback payloads stay inside Telegram's 64-byte limit", () => {
  const data = paymentCallbackData("3f1c2d4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f", true);
  assert.ok(Buffer.byteLength(data, "utf8") <= 64, `${data} is ${Buffer.byteLength(data)} bytes`);
});

test("a malformed or foreign callback is ignored rather than guessed at", () => {
  assert.equal(parsePaymentCallback(undefined), null);
  assert.equal(parsePaymentCallback(""), null);
  assert.equal(parsePaymentCallback("other:y:3f1c2d4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f"), null);
  assert.equal(parsePaymentCallback("pay:maybe:3f1c2d4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f"), null);
  // A truncated id must never be written to the database as a status.
  assert.equal(parsePaymentCallback("pay:y:3f1c2d4e"), null);
  assert.equal(parsePaymentCallback("pay:y:"), null);
});

test("the question carries everything needed to recognise the candidate", () => {
  const text = buildPaymentQuestion({
    fullName: "Rasuljonova Gulnoza Avazjon qizi",
    phone: "+998901234567",
    telegramUsername: "gulnoza",
    submittedAt: "2026-09-04T09:05:00Z",
    round: 1,
  });
  assert.match(text, /Rasuljonova Gulnoza Avazjon qizi/);
  assert.match(text, /\+998901234567/);
  assert.match(text, /@gulnoza/, "a username without @ is still shown as one");
  assert.match(text, /04\.09\.2026 14:05/, "the time is Tashkent, not UTC");
  assert.match(text, /to‘lov qildimi\?/i);
  assert.doesNotMatch(text, /so‘rov/, "a first ask is not labelled as a repeat");
});

test("a repeated ask says so", () => {
  const text = buildPaymentQuestion({
    fullName: "Test Nomzod",
    phone: null,
    telegramUsername: null,
    submittedAt: "2026-09-04T09:05:00Z",
    round: 4,
  });
  assert.match(text, /4-so‘rov/);
});

test("an answered question is rewritten with its outcome", () => {
  const yes = buildPaymentAnswerText({ fullName: "Test Nomzod" }, true, new Date("2026-09-04T11:00:00Z"));
  assert.match(yes, /TO‘LOV QILGAN/);
  assert.match(yes, /16:00/);
  assert.match(yes, /post tayyorlanmoqda/i);

  const no = buildPaymentAnswerText({ fullName: "Test Nomzod" }, false);
  assert.match(no, /To‘lov qilmagan/);
  assert.match(no, /2 soatdan keyin qayta so‘raladi/);
});

test("the report separates 'no answer yet' from 'did not pay'", () => {
  const text = buildBotStatusReportText({
    todayDate: "2026-09-04",
    total: {
      filling: 12,
      submitted: 38,
      paid: 22,
      unpaid: 5,
      paymentUnknown: 11,
      posts: 19,
      published: 21,
    },
    today: {
      filling: 3,
      submitted: 27,
      paid: 22,
      unpaid: 4,
      paymentUnknown: 1,
      posts: 19,
      published: 18,
    },
  });
  assert.match(text, /To‘ldirmoqda: 12/);
  assert.match(text, /To‘ldirib yuborgan: 38/);
  assert.match(text, /To‘lov qilgan: 22/);
  assert.match(text, /To‘lov qilmagan: 5/);
  assert.match(text, /Javob berilmagan: 11/, "unknown is its own line, never folded into unpaid");
  assert.match(text, /Postga aylantirilgan: 19/);
  assert.match(text, /BUGUN \(2026-09-04\)/);
});

/* ------------------------------------------------------------------ *
 * Gate, tartib va idempotentlik — manba tekshiruvlari
 * ------------------------------------------------------------------ */

test("publishing is gated on a confirmed payment", () => {
  // Without this filter the two-hour sweep would publish candidates who never
  // paid — which is the whole reason the payment loop exists.
  assert.match(PIPELINE, /\.eq\("payment_status", "paid"\)/);
  // And a run re-checks it, because payment can change between queue and claim.
  assert.match(BATCH, /payment_status.*!== "paid"|!== "paid"/s);
});

test("confirming payment is what queues the publish run", () => {
  assert.match(PAYMENT, /post_pipeline_status = "pending"|post_pipeline_status.*pending/s);
  assert.match(PAYMENT, /payment_confirmed_at/);
  // First answer wins: the guard is what stops two editors double-triggering.
  assert.match(PAYMENT, /\.neq\("payment_status", "paid"\)/);
});

test("the sweep never re-asks inside its two-hour window", () => {
  assert.match(PAYMENT, /PAYMENT_ASK_INTERVAL_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(PAYMENT, /payment_last_asked_at\.lte\./);
  assert.match(PAYMENT, /\.neq\("payment_status", "paid"\)/);
  // And it will not reach back through months of history.
  assert.match(PAYMENT, /PAYMENT_MAX_AGE_DAYS = 14/);
});

test("batch items are claimed atomically, one worker at a time", () => {
  assert.match(MIGRATION, /for update skip locked/i);
  assert.match(MIGRATION, /claim_next_publish_batch_item/);
  assert.match(BATCH, /claim_next_publish_batch_item/);
  assert.match(BATCH, /BATCH_CONCURRENCY = 1/);
});

test("one candidate cannot be queued twice in the same batch", () => {
  assert.match(MIGRATION, /create unique index if not exists uq_batch_item_intake/);
  assert.match(MIGRATION, /on public\.intake_publish_batch_items\(batch_id, intake_id\)/);
});

test("a retry resumes instead of restarting completed work", () => {
  // Only failed, needs_review and cancelled items go back in the queue.
  assert.match(BATCH, /\.in\("status", \["failed", "needs_review", "cancelled"\]\)/);
  assert.doesNotMatch(
    BATCH,
    /\.in\("status", \[[^\]]*"completed"[^\]]*\]\)\s*\.select\("id"\)/,
    "completed items are never requeued",
  );
});

test("cancelling stops the queue without tearing down the running candidate", () => {
  const cancel = BATCH.match(/export async function cancelBatch[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(cancel, /\.eq\("status", "queued"\)/);
  assert.doesNotMatch(cancel, /"running"[\s\S]*status.*cancelled/);
});

test("a worker killed mid-candidate does not stall the batch", () => {
  // The claim only takes queued rows, so a row abandoned in `running` would sit
  // there forever and the queue would stop one candidate short.
  assert.match(BATCH, /await releaseStaleItems\(batchId\)/);
  assert.match(BATCH, /\.eq\("status", "running"\)\s*\.lt\("started_at", cutoff\)/);
  // The cutoff must clear the function budget, or a slow-but-alive run would be
  // re-claimed and processed twice in parallel.
  assert.match(BATCH, /STALE_ITEM_MS = 10 \* 60 \* 1000/);
  const cron = fs.readFileSync("src/app/api/cron/intake-publish-batches/route.ts", "utf8");
  assert.match(cron, /maxDuration = 300/);
  // And a candidate that keeps killing the worker is parked, not retried forever.
  assert.match(BATCH, /MAX_ITEM_ATTEMPTS = 3/);
});

test("a claim that returns an empty composite row is not treated as work", () => {
  // A plpgsql function returning a composite type can answer with a row of
  // nulls; keying off the object would then "claim" a candidate that is not
  // there and run the pipeline for intake id `undefined`.
  assert.match(BATCH, /if \(!item\?\.id\)/);
});

test("ETA is measured, never invented", () => {
  // Nothing finished yet means no estimate at all, rather than a made-up one.
  assert.match(BATCH, /processed > 0 \? Number\(batch\.duration_ms_total/);
  assert.match(BATCH, /etaMs: running && remaining > 0/);
});

/* ------------------------------------------------------------------ *
 * Telegram
 * ------------------------------------------------------------------ */

test("automated posts go to the configured chats, not the whole subscriber list", () => {
  assert.match(PIPELINE, /getPostDeliveryChatIds\(\)/);
  assert.match(PIPELINE, /chatIds: chatIds\.length > 0 \? chatIds : undefined/);
  assert.match(TELEGRAM, /subscriberQuery\.in\("chat_id", options\.chatIds\)/);
});

test("the three editorial chats are seeded as the delivery recipients", () => {
  assert.match(MIGRATION, /telegram_bot\.post_delivery_chat_ids/);
  for (const chatId of ["5072996465", "6398047875", "8254451152"]) {
    assert.ok(MIGRATION.includes(chatId), `${chatId} is configured`);
  }
  // Stored as strings so a 64-bit id survives JSON parsing intact.
  assert.match(MIGRATION, /\["5072996465","6398047875","8254451152"\]/);
});

test("a configured recipient always has a subscriber row to dedupe against", () => {
  // Without the row the "sent once" index has nothing to key on, and a retry
  // would send the same post to that chat a second time.
  assert.match(TELEGRAM, /ensureDeliverySubscribers/);
  assert.match(TELEGRAM, /if \(options\.chatIds\?\.length\) await ensureDeliverySubscribers/);
});

test("delivery is the last stage, after the article is published", () => {
  const order = [
    "1. fact-preserving answer improvement",
    "2. auto-approval",
    "3. promotion",
    "4. publication",
    "5. social post draft",
    "6. portrait",
    "7. render",
    "8. Telegram caption",
    "9. Telegram delivery",
  ];
  let cursor = 0;
  for (const step of order) {
    const at = PIPELINE.indexOf(step, cursor);
    assert.ok(at > 0, `stage "${step}" is present`);
    cursor = at;
  }
});

test("a post already delivered to a chat is not counted as a failure", () => {
  // `skipped` means the chat already holds this post from an earlier run.
  assert.match(PIPELINE, /delivery\.sent === 0 && delivery\.skipped === 0/);
});

test("the bot answers a tapped button before doing any slow work", () => {
  const handler = PAYMENT.match(/export async function handlePaymentCallback[\s\S]*?\n}/)?.[0] ?? "";
  const answerAt = handler.indexOf("safeAnswer");
  const queryAt = handler.indexOf('.from("candidate_intakes")');
  assert.ok(answerAt > 0 && queryAt > 0, "both steps are present");
  assert.ok(answerAt < queryAt, "the spinner is cleared first");
});

test("the webhook is registered for button taps, not only for messages", () => {
  // An allowed_updates list without callback_query makes Telegram drop every
  // tap: the buttons spin, nothing is recorded, and nothing is logged either.
  const script = fs.readFileSync("scripts/set-telegram-webhook.mjs", "utf8");
  assert.match(script, /allowed_updates: \["message", "callback_query"\]/);
});

test("the report button is reachable as a button and as a command", () => {
  assert.equal(REPORT_BUTTON_LABEL, "📊 Hozirgi hisobot");
  assert.match(TELEGRAM, /command === "\/hisobot"/);
  assert.match(TELEGRAM, /=== REPORT_BUTTON_LABEL/);
  assert.match(TELEGRAM, /replyKeyboard: BOT_KEYBOARD/);
});

/* ------------------------------------------------------------------ *
 * Xavfsizlik va migration
 * ------------------------------------------------------------------ */

test("the migration is additive — nothing existing is dropped or deleted", () => {
  assert.doesNotMatch(MIGRATION, /drop table/i);
  assert.doesNotMatch(MIGRATION, /truncate/i);
  assert.doesNotMatch(MIGRATION, /delete from/i);
  assert.doesNotMatch(MIGRATION, /drop column/i);
  // Every column is added defensively, so re-running is safe.
  assert.match(MIGRATION, /add column if not exists payment_status/);
  assert.match(MIGRATION, /on conflict \(key\) do nothing/);
});

test("payment defaults to 'unknown', never to 'unpaid'", () => {
  assert.match(MIGRATION, /payment_status text not null default 'unknown'/);
  assert.match(MIGRATION, /check \(payment_status in \('unknown', 'paid', 'unpaid'\)\)/);
});

test("the new tables are closed to public clients", () => {
  for (const table of [
    "intake_payment_requests",
    "intake_publish_batches",
    "intake_publish_batch_items",
  ]) {
    assert.match(
      MIGRATION,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} has RLS`,
    );
  }
  assert.doesNotMatch(MIGRATION, /to anon/);
  assert.match(MIGRATION, /revoke all on function public\.claim_next_publish_batch_item/);
});

test("the batch worker route pins Node and fails closed without its secret", () => {
  const cron = fs.readFileSync("src/app/api/cron/intake-publish-batches/route.ts", "utf8");
  assert.match(cron, /export const runtime = "nodejs"/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /status: 503/, "a missing secret refuses to run");
  assert.match(cron, /status: 401/, "a wrong secret is rejected");
});

test("batch server actions check permissions before touching anything", () => {
  const actions = fs.readFileSync("src/lib/actions/publish-batch.ts", "utf8");
  for (const fn of [
    "startPublishBatchAction",
    "cancelPublishBatchAction",
    "retryPublishBatchAction",
    "getBatchProgressAction",
    "askPaymentChunkAction",
  ]) {
    const body = actions.match(new RegExp(`export async function ${fn}[\\s\\S]*?\\n}`))?.[0] ?? "";
    assert.match(body, /await requirePermission\(/, `${fn} is guarded`);
  }
  // An empty selection is an error, not a silent "publish everyone".
  assert.match(actions, /intakeIds !== null && intakeIds\.length === 0/);
});

test("no server secret can reach the queue panel bundle", () => {
  const client = fs.readFileSync(
    "src/app/(admin)/nomzodlar/anketalar/chop-etishga-tayyorlar/queue-client.tsx",
    "utf8",
  );
  assert.match(client, /^"use client";/);
  assert.ok(!/process\.env\.(?!NEXT_PUBLIC_)/.test(client));
  assert.ok(!client.includes("TELEGRAM_BOT_TOKEN"));
  assert.ok(!client.includes("SUPABASE_SERVICE_ROLE"));
  // The wide table scrolls inside its own box rather than the page.
  assert.match(client, /overflow-x-auto/);
});
