import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  formatTashkent,
  parseCalendarDate,
  shiftCalendarDate,
  tashkentDayRange,
  tashkentDayRangeForDate,
  tashkentHour,
  tashkentOffsetMinutes,
  tashkentToday,
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
  buildPaymentUndoList,
  buildPaymentUndoResult,
  parsePaymentCallback,
  parsePaymentUndoCallback,
  paymentCallbackData,
  PAYMENT_PUBLISH_DELAY_MS,
  paymentUndoCallbackData,
  REPORT_BUTTON_LABEL,
  UNDO_LIST_SIZE,
  blacklistCallbackData,
  buildBlacklistWarningText,
  parseBlacklistCallback,
  PAYMENT_ASK_END_HOUR,
  PAYMENT_ASK_START_HOUR,
  withinAskingHours,
} from "../src/lib/intake/payment-messages.ts";
import { CANONICAL_POST_QUOTE_HELP_TEXT } from "../src/lib/intake/canonical-quote.ts";
import { blacklistKey } from "../src/lib/intake/name-key.ts";
import {
  checkQuote,
  countWords,
  isBlankQuote,
  quoteFingerprint,
  splitSentences,
  QUOTE_MIN_WORDS_PER_SENTENCE,
  QUOTE_SENTENCE_COUNT,
} from "../src/lib/intake/quote-rules.ts";
import {
  buildBatchProgressText,
  buildBatchStartedText,
  buildNothingToPublishText,
  progressBar,
} from "../src/lib/intake/batch-messages.ts";

const MIGRATION = fs.readFileSync(
  "supabase/migrations/20260904120000_intake_payment_and_publish_batches.sql",
  "utf8",
);
const BATCH = fs.readFileSync("src/lib/intake/publish-batch.ts", "utf8");
const PAYMENT = fs.readFileSync("src/lib/intake/payment.ts", "utf8");
const BLACKLIST = fs.readFileSync("src/lib/intake/blacklist.ts", "utf8");
const PIPELINE = fs.readFileSync("src/lib/post-studio/pipeline.ts", "utf8");
const TELEGRAM = fs.readFileSync("src/lib/post-studio/telegram.ts", "utf8");
const ROUTER = fs.readFileSync("src/lib/post-studio/bot-router.ts", "utf8");

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

test("any calendar date can be turned into its own Tashkent day", () => {
  // The board reaches back through the archive, so the range comes from a date
  // rather than from whichever day the server happens to be inside.
  const range = tashkentDayRangeForDate("2026-08-14");
  assert.equal(range.date, "2026-08-14");
  assert.equal(range.startIso, "2026-08-13T19:00:00.000Z");
  assert.equal(range.endIso, "2026-08-14T19:00:00.000Z");

  // A leap day is a real day and must survive the round trip.
  assert.equal(tashkentDayRangeForDate("2028-02-29").date, "2028-02-29");
});

test("a hand-edited date is rejected rather than silently reinterpreted", () => {
  assert.equal(parseCalendarDate("2026-09-04"), "2026-09-04");
  assert.equal(parseCalendarDate(null), null);
  assert.equal(parseCalendarDate(""), null);
  assert.equal(parseCalendarDate("04.09.2026"), null);
  assert.equal(parseCalendarDate("2026-9-4"), null);
  // Shape-valid but non-existent: without the round-trip check this would
  // quietly become 2026-03-02.
  assert.equal(parseCalendarDate("2026-02-30"), null);
  assert.equal(parseCalendarDate("2026-13-01"), null);
  assert.equal(parseCalendarDate("2026-00-10"), null);
});

test("today is the Tashkent calendar date, not the server's", () => {
  // 19:05 UTC is already tomorrow in Tashkent; the default board must follow
  // the zone, not the machine.
  assert.equal(tashkentToday(new Date("2026-09-04T19:05:00Z")), "2026-09-05");
  assert.equal(tashkentToday(new Date("2026-09-04T18:55:00Z")), "2026-09-04");
});

test("stepping between days crosses month and year boundaries", () => {
  assert.equal(shiftCalendarDate("2026-09-05", -1), "2026-09-04");
  assert.equal(shiftCalendarDate("2026-09-01", -1), "2026-08-31");
  assert.equal(shiftCalendarDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftCalendarDate("2028-02-28", 1), "2028-02-29");
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

test("candidates whose post never went out are finished first", () => {
  // They are already on the site with nothing announcing them, and finishing
  // one costs a single post while a fresh candidate costs the whole chain.
  const rows = [
    { ...row("fresh-early", "2026-09-04T07:00:00Z"), postPending: false },
    { ...row("repair-late", "2026-09-04T11:00:00Z", "paid", "published"), postPending: true },
    { ...row("fresh-late", "2026-09-04T09:00:00Z"), postPending: false },
    { ...row("repair-early", "2026-09-04T08:00:00Z", "paid", "published"), postPending: true },
  ];
  assert.deepEqual(
    selectEligibleForBatch(rows, null).map((r) => r.id),
    // Repairs first, each group still in submission order.
    ["repair-early", "repair-late", "fresh-early", "fresh-late"],
  );
});

test("a published candidate whose post already went out is left alone", () => {
  const rows = [{ ...row("done", "2026-09-04T08:00:00Z", "paid", "published"), postPending: false }];
  assert.equal(selectEligibleForBatch(rows, null).length, 0);
});

test("a repair is still refused when the payment is not confirmed", () => {
  const rows = [
    { ...row("x", "2026-09-04T08:00:00Z", "unknown", "published"), postPending: true },
  ];
  assert.equal(selectEligibleForBatch(rows, null).length, 0);
});

test("someone already on the site is never queued again", () => {
  // A returning candidate, or a second form under the same name: re-running
  // them would rewrite their live article and post them as if they were new.
  const rows = [
    { ...row("fresh", "2026-09-04T08:00:00Z"), alreadyPublished: null },
    {
      ...row("returning", "2026-09-04T08:01:00Z"),
      alreadyPublished: { candidateId: "cand-1", slug: "aliyev-ali" },
    },
  ];
  assert.deepEqual(
    selectEligibleForBatch(rows, null).map((r) => r.id),
    ["fresh"],
  );
  // Not even by ticking them by hand.
  assert.equal(selectEligibleForBatch(rows, ["returning"]).length, 0);
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
  // The grace period is stated, and so is the way out of a mis-tap.
  assert.match(yes, /10 daqiqadan keyin boshlanadi/);
  assert.match(yes, /To‘lov statusida adashish/);

  const no = buildPaymentAnswerText({ fullName: "Test Nomzod" }, false);
  assert.match(no, /To‘lov qilmagan/);
  assert.match(no, /2 soatdan keyin qayta so‘raladi/);
});

test("a confirmed payment waits out a grace period before anything is published", () => {
  // Publishing an article and posting it to every editorial chat cannot be
  // recalled, so a mis-tap needs a window in which it still can be.
  assert.equal(PAYMENT_PUBLISH_DELAY_MS, 10 * 60 * 1000);
  assert.match(PAYMENT, /Date\.now\(\) \+ PAYMENT_PUBLISH_DELAY_MS/);
});

test("the undo list offers the last ten confirmations, numbered", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    id: `id-${i}`,
    fullName: `Nomzod ${i + 1}`,
    confirmedAt: "2026-09-04T09:00:00Z",
    published: i === 0,
  }));
  const text = buildPaymentUndoList(candidates);
  assert.match(text, /^1\. Nomzod 1/m);
  assert.match(text, /^10\. Nomzod 10/m);
  // An already-published candidate is flagged, so nobody taps it expecting the
  // article to come back off the site.
  assert.match(text, /Nomzod 1 —.*chop etilgan/);
  assert.doesNotMatch(text, /Nomzod 2 —.*chop etilgan/);
  assert.equal(UNDO_LIST_SIZE, 10);

  assert.match(buildPaymentUndoList([]), /Hozircha .* nomzod yo‘q/);
});

test("undoing before publication is a real revert; after it, it says so", () => {
  const pending = buildPaymentUndoResult({ fullName: "Test Nomzod", published: false });
  assert.match(pending, /BEKOR QILINDI/);
  assert.match(pending, /Nashr navbatidan chiqarildi/);

  const late = buildPaymentUndoResult({ fullName: "Test Nomzod", published: true });
  assert.match(late, /KECH QOLINDI/);
  assert.match(late, /saytda/, "it does not pretend the article was withdrawn");
});

test("an undo round-trips and cannot be confused with a confirmation", () => {
  const id = "3f1c2d4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f";
  const data = paymentUndoCallbackData(id);
  assert.equal(parsePaymentUndoCallback(data), id);
  assert.ok(Buffer.byteLength(data, "utf8") <= 64);
  // The two prefixes must not overlap: they do opposite things to one candidate.
  assert.equal(parsePaymentUndoCallback(paymentCallbackData(id, true)), null);
  assert.equal(parsePaymentCallback(data), null);
  assert.equal(parsePaymentUndoCallback("und:not-a-uuid"), null);
});

test("an undo takes the candidate back out of the publish queue", () => {
  const undo = PAYMENT.match(/export async function undoPaymentConfirmation[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(undo, /payment_status: "unpaid"/);
  assert.match(undo, /post_pipeline_status: "skipped"/, "the queued run is withdrawn");
  // Guarded, so two taps on the same number do not double-write.
  assert.match(undo, /\.eq\("payment_status", "paid"\)/);
});

test("a duplicate is caught by identity, on both publish paths", () => {
  const NAMESAKE = fs.readFileSync("src/lib/intake/namesake.ts", "utf8");
  // The site's own identity for a person: publishing derives every slug from
  // slugify(full_name), and the slug is unique among live candidates.
  assert.match(NAMESAKE, /slugify\(fullName\)/);
  assert.match(NAMESAKE, /\.eq\("status", "published"\)/);
  assert.match(NAMESAKE, /\.is\("deleted_at", null\)/);
  // An intake promoted earlier matches its own slug; that is continuation.
  assert.match(NAMESAKE, /excludeCandidateId && data\.id === excludeCandidateId/);

  // Checked on the batch path AND on the payment-triggered automatic path —
  // gating only one of them would leave the other free to republish.
  assert.match(BATCH, /findPublishedNamesake\(/);
  assert.match(PIPELINE, /findPublishedNamesake\(/);
  // And in the pipeline it runs BEFORE anything is promoted or published.
  assert.ok(
    PIPELINE.indexOf("findPublishedNamesake(") < PIPELINE.indexOf("promoteIntakeToDraft(intakeId"),
    "the check precedes promotion",
  );
});

test("the board can be pointed at any past day, and the batch follows it", () => {
  assert.match(BATCH, /export async function loadPublishQueue/);
  assert.match(BATCH, /date \? tashkentDayRangeForDate\(date\) : tashkentDayRange\(now\)/);
  // Starting a batch on an archive day must queue that day, not today's.
  assert.match(BATCH, /const queue = await loadPublishQueue\(date\)/);
  const actions = fs.readFileSync("src/lib/actions/publish-batch.ts", "utf8");
  assert.match(actions, /parseCalendarDate\(date\)/, "the date is validated, not trusted");
  assert.match(actions, /Sana noto‘g‘ri/);
});

test("the payment question goes out the moment a form is submitted", () => {
  const route = fs.readFileSync("src/app/api/intake/submit/route.ts", "utf8");
  assert.match(route, /await askPaymentOnSubmit\(resolved\.intakeId\)/);
  // After the submit RPC succeeded — never in front of it. Compared against the
  // call site, not the import, which naturally sits at the top of the file.
  assert.ok(
    route.indexOf("submit_candidate_intake") < route.indexOf("askPaymentOnSubmit(resolved"),
    "the ask follows a successful submission",
  );
  // The manual admin path gets the same trigger.
  const actions = fs.readFileSync("src/lib/actions/intakes.ts", "utf8");
  assert.match(actions, /await askPaymentOnSubmit\(intakeId\)/);
  // And it can never fail the submission it follows.
  const fn = PAYMENT.match(/export async function askPaymentOnSubmit[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(fn, /try \{[\s\S]*\} catch/);
});

test("the report leads with today and puts the running totals underneath", () => {
  const text = buildBotStatusReportText({
    todayDate: "2026-09-05",
    total: { filling: 57, submitted: 200, paid: 3, unpaid: 1, paymentUnknown: 196, posts: 47, published: 16 },
    today: { filling: 2, submitted: 9, paid: 3, unpaid: 1, paymentUnknown: 5, posts: 1, published: 0 },
  });
  const todayAt = text.indexOf("BUGUN");
  const totalAt = text.indexOf("JAMI");
  assert.ok(todayAt > 0 && totalAt > 0, "both blocks are present");
  assert.ok(todayAt < totalAt, "today comes first — it is what anyone acts on");
  // Today's block carries the unanswered figure too, not just the totals.
  assert.match(text.slice(todayAt, totalAt), /Javob berilmagan: 5/);
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

test("every editorial button is reachable as a button and as a command", () => {
  // A keyboard button arrives as an ordinary message carrying its label, so
  // both spellings have to hit the same branch.
  assert.equal(REPORT_BUTTON_LABEL, "📊 Hozirgi hisobot");
  for (const [command, label] of [
    ["/hisobot", "REPORT_BUTTON_LABEL"],
    ["/chop", "BATCH_BUTTON_LABEL"],
    ["/bekor", "UNDO_BUTTON_LABEL"],
  ] as const) {
    assert.match(ROUTER, new RegExp(`command === "${command}"`), `${command} works typed`);
    assert.match(ROUTER, new RegExp(`text === ${label}`), `${label} works tapped`);
  }
});

test("editorial actions are refused outside the configured chats", () => {
  // The keyboard is only half a guard: a label can be typed by any subscriber,
  // and an inline keyboard can be forwarded anywhere.
  assert.match(ROUTER, /async function isEditorialChat/);
  assert.match(ROUTER, /configured\.includes\(chatId\)/);
  for (const branch of ["/hisobot", "/chop", "/bekor"]) {
    const at = ROUTER.indexOf(`command === "${branch}"`);
    const block = ROUTER.slice(at, at + 400);
    assert.match(block, /if \(!editorial\) return deny\(/, `${branch} checks membership`);
  }
  // Both callback kinds re-check it as well.
  const callbacks = ROUTER.match(/async function handleCallbackQuery[\s\S]*?\n}/)?.[0] ?? "";
  assert.equal(
    (callbacks.match(/await isEditorialChat\(chatId\)/g) ?? []).length,
    3,
    "blacklist, undo and payment callbacks are each guarded",
  );
});

test("the bot's batch button drives the same queue as the panel", () => {
  // Not a parallel implementation: one table, one worker, one ordering. A run
  // started from the panel is therefore what the bot button reports on.
  assert.match(BATCH, /export async function runBotBatchButton/);
  assert.match(BATCH, /const activeId = await getActiveBatchId\(\)/);
  assert.match(BATCH, /await createPublishBatch\(null, null\)/);
  assert.match(ROUTER, /runBotBatchButton\(\)/);

  // With a run in flight the button NEVER reaches createPublishBatch — an
  // unreadable progress row must not fall through to starting a second one.
  const fn = BATCH.match(/export async function runBotBatchButton[\s\S]*?\n}/)?.[0] ?? "";
  const activeBranch = fn.slice(fn.indexOf("if (activeId)"), fn.indexOf("const created"));
  assert.match(activeBranch, /return progress\s*\?/);
  assert.ok(!activeBranch.includes("createPublishBatch"), "no second run while one is active");
});

test("the batch repair path reaches the pipeline for a published candidate", () => {
  // runItem normally skips anything already published; the exception is a
  // candidate still owed a post, and the pipeline then skips straight past the
  // article stages to the post half.
  assert.match(BATCH, /const repairable =/);
  assert.match(BATCH, /await postAwaitingDelivery\(candidateId\)/);
  assert.match(BATCH, /\.eq\("candidate_id", candidateId\)/);
});

test("the batch progress message reports done, in-flight and remaining", () => {
  const text = buildBatchProgressText({
    status: "running",
    total: 12,
    completed: 5,
    failed: 1,
    remaining: 6,
    percent: 44,
    currentName: "Rasuljonova Gulnoza",
    currentStage: "Post render qilinmoqda",
    elapsedMs: 372_000,
    etaMs: 450_000,
  });
  assert.match(text, /44%/);
  assert.match(text, /Qilindi: 5/);
  assert.match(text, /Qilinyapti: Rasuljonova Gulnoza/);
  assert.match(text, /Post render qilinmoqda/);
  assert.match(text, /Qoldi: 6/);
  assert.match(text, /Xato: 1/);
  assert.match(text, /06:12/);
  assert.match(text, /~ 07:30/);
});

test("the batch message never invents a countdown", () => {
  const text = buildBatchProgressText({
    status: "queued",
    total: 4,
    completed: 0,
    failed: 0,
    remaining: 4,
    percent: 0,
    currentName: null,
    currentStage: null,
    elapsedMs: 0,
    etaMs: null,
  });
  assert.match(text, /hisoblanmoqda…/);
  assert.doesNotMatch(text, /~ \d/);
});

test("the progress bar stays inside its own bounds", () => {
  assert.equal(progressBar(0), "░░░░░░░░░░ 0%");
  assert.equal(progressBar(100), "██████████ 100%");
  assert.equal(progressBar(50), "█████░░░░░ 50%");
  // Out-of-range input is clamped rather than drawn past the end of the bar.
  assert.equal(progressBar(-20), "░░░░░░░░░░ 0%");
  assert.equal(progressBar(140), "██████████ 100%");
});

test("starting a batch with nothing eligible is stated plainly, not as an error", () => {
  assert.match(buildNothingToPublishText(), /CHOP ETISHGA TAYYOR NOMZOD YO‘Q/);
  assert.match(buildBatchStartedText(12), /JAMOVIY CHOP ETISH BOSHLANDI/);
  assert.match(buildBatchStartedText(12), /Jami: 12 ta nomzod/);
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

test("every route that runs the pipeline is shipped the segmentation model", () => {
  // The batch worker deployed without the model once. Nothing failed at build
  // time: the function ran, reached the portrait stage, and every candidate it
  // touched died at "Portret fonini olib tashlash amalga oshmadi" while the
  // identical work on the pipeline cron succeeded.
  const config = fs.readFileSync("next.config.ts", "utf8");
  const listed = config.match(/const SEGMENTATION_ROUTES = \[([\s\S]*?)\];/)?.[1] ?? "";

  const cronDir = "src/app/api/cron";
  for (const entry of fs.readdirSync(cronDir)) {
    const routeFile = `${cronDir}/${entry}/route.ts`;
    if (!fs.existsSync(routeFile)) continue;
    const source = fs.readFileSync(routeFile, "utf8");
    // Anything reaching the pipeline reaches preparePortrait with it.
    const runsPipeline = /post-studio\/pipeline|intake\/publish-batch/.test(source);
    if (!runsPipeline) continue;
    assert.ok(
      listed.includes(`/api/cron/${entry}`),
      `/api/cron/${entry} runs the pipeline but is not in SEGMENTATION_ROUTES`,
    );
  }

  // And the includes are generated from that list, not hand-written per route —
  // hand-listing is what let one ship without the model, the fonts or the
  // backgrounds.
  assert.match(config, /SEGMENTATION_ROUTES\.map\(\(route\) => \[\s*route,/);
  assert.match(config, /\.\.\.POST_STUDIO_ASSETS, \.\.\.SEGMENTATION_MODEL/);
});

test("a missing model is reported as a build fault, not a bad photograph", () => {
  const service = fs.readFileSync("src/lib/post-studio/service.ts", "utf8");
  assert.match(service, /err\.code === "model_unavailable"/);
  assert.match(service, /SEGMENTATION_ROUTES/, "the message points at the actual fix");
  // And the underlying failure always reaches the logs, whatever is shown.
  assert.match(service, /console\.error\("\[post-studio\] portrait failed"/);
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

/* ------------------------------------------------------------------ *
 * Ish vaqti, qora ro'yxat va iqtibos eslatmasi
 * ------------------------------------------------------------------ */

test("payment questions are only sent during working hours", () => {
  // 09:00-21:00 Tashkent. The question repeats every two hours until answered,
  // so without a quiet window an unanswered candidate wakes the editors all
  // night.
  assert.equal(withinAskingHours(new Date("2026-09-05T03:59:00Z")), false); // 08:59
  assert.equal(withinAskingHours(new Date("2026-09-05T04:00:00Z")), true); //  09:00
  assert.equal(withinAskingHours(new Date("2026-09-05T15:59:00Z")), true); //  20:59
  assert.equal(withinAskingHours(new Date("2026-09-05T16:00:00Z")), false); // 21:00
  assert.equal(withinAskingHours(new Date("2026-09-05T20:00:00Z")), false); // 01:00
  assert.equal(PAYMENT_ASK_START_HOUR, 9);
  assert.equal(PAYMENT_ASK_END_HOUR, 21);
});

test("a skipped night does not count as having asked", () => {
  // The stamp is only written when something is actually sent, so the morning
  // sweep picks everyone up instead of treating the night as a round of asking.
  const sweep = PAYMENT.match(/export async function runPaymentAskSweep[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(sweep, /if \(!withinAskingHours\(now\)\) return \[\]/);
  assert.ok(
    sweep.indexOf("withinAskingHours") < sweep.indexOf("findIntakesNeedingPaymentAsk"),
    "the hour is checked before any query",
  );
});

test("nobody already on the site is asked about payment", () => {
  // Their article is out; asking whether they paid is noise, and a "yes" would
  // trigger a republish.
  const sweep = PAYMENT.match(/export async function runPaymentAskSweep[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(sweep, /await findPublishedNamesake\(intake\.full_name, null\)/);
  assert.match(sweep, /blacklisted\.has\(blacklistKey\(intake\.full_name\)\)/);
});

test("the blacklist is keyed by name, so a fresh form still matches", () => {
  // A terminated contract has to survive the person filling the form again
  // under a brand-new intake id.
  assert.match(BLACKLIST, /blacklistKey\(input\.fullName\)/);
  assert.match(BLACKLIST, /onConflict: "name_slug"/);
  assert.match(BLACKLIST, /export async function findBlacklistedSlugs/);
  // A lookup failure must not silently block a legitimate candidate.
  assert.match(BLACKLIST, /\[blacklist\] lookup failed/);
});

test("a terminated contract blocks every publish path", () => {
  assert.match(BATCH, /await isBlacklisted\(intake\.full_name as string\)/);
  assert.match(PIPELINE, /await isBlacklisted\(/);
  // And the button that sets it also takes them out of the queue. Sliced by
  // index rather than matched to `\n}`, which a multi-line parameter type ends
  // long before the body does.
  const from = PAYMENT.indexOf("export async function handleBlacklistCallback");
  const fn = PAYMENT.slice(from, from + 2000);
  assert.match(fn, /post_pipeline_status: "skipped"/);
  assert.match(fn, /payment_status: "unpaid"/);
});

test("a blacklisted person returning raises a warning instead of a payment ask", () => {
  const fn = PAYMENT.match(/export async function askPaymentOnSubmit[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(fn, /if \(await warnIfBlacklisted\(intakeId\)\) return;/);
  assert.ok(
    fn.indexOf("warnIfBlacklisted") < fn.indexOf("askPaymentForIntakes"),
    "the warning replaces the question rather than following it",
  );
  const warning = buildBlacklistWarningText({
    fullName: "Test Nomzod",
    phone: "+998901234567",
    telegramUsername: "test",
    reason: "Shartnoma buzildi",
    listedAt: "2026-09-01T09:00:00Z",
  });
  assert.match(warning, /OGOHLANTIRISH/);
  assert.match(warning, /AVTOMATIK chiqarilmaydi/);
});

test("the blacklist button round-trips and stays distinct from the other two", () => {
  const id = "3f1c2d4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f";
  const data = blacklistCallbackData(id);
  assert.equal(parseBlacklistCallback(data), id);
  assert.ok(Buffer.byteLength(data, "utf8") <= 64);
  // Three buttons, three prefixes — none may be read as another.
  assert.equal(parseBlacklistCallback(paymentCallbackData(id, true)), null);
  assert.equal(parseBlacklistCallback(paymentUndoCallbackData(id)), null);
  assert.equal(parsePaymentCallback(data), null);
  assert.equal(parsePaymentUndoCallback(data), null);
});

test("the quote instruction states every rule the poster depends on", () => {
  // This answer goes onto the poster verbatim — the AI is blocked from
  // rewriting it — so the instruction has to carry the constraints itself.
  assert.match(CANONICAL_POST_QUOTE_HELP_TEXT, /Ikkita gap/);
  assert.match(CANONICAL_POST_QUOTE_HELP_TEXT, /kamida 6 ta so‘z/);
  assert.match(CANONICAL_POST_QUOTE_HELP_TEXT, /imloviy/i);
  assert.match(CANONICAL_POST_QUOTE_HELP_TEXT, /ChatGPT/);
  assert.match(CANONICAL_POST_QUOTE_HELP_TEXT, /o‘zgartirilmaydi/);

  const migration = fs.readFileSync(
    "supabase/migrations/20260905030000_quote_hint_and_blacklist.sql",
    "utf8",
  );
  assert.match(migration, /canonical_key = 'post_quote'/);
  assert.match(migration, /Ikkita gap yozing/);
  assert.match(migration, /create table if not exists public\.intake_blacklist/);
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(migration, /drop table|delete from|truncate/i);
});

test("the poster uses the photo the site is showing right now", () => {
  // avatar_url is what the published article displays. Once an editor replaces
  // it, re-rendering from the original intake attachment would put a picture on
  // the poster that no longer matches the article it links to.
  const repository = fs.readFileSync("src/lib/post-studio/repository.ts", "utf8");
  const fn = repository.match(
    /export async function resolveCandidatePortraitSource[\s\S]*?\n}/,
  )?.[0] ?? "";
  assert.ok(
    fn.indexOf('selection: "candidate_avatar"') < fn.indexOf('selection: "confirmed_ai"'),
    "the live site photo is resolved before the intake attachments",
  );
  // The intake sources remain as the fallback for candidates with no avatar.
  assert.match(fn, /selection: "confirmed_original"/);
  assert.match(fn, /selection: "primary_photo"/);
});

test("every way of writing an Uzbek name reaches one blacklist key", () => {
  // slugify keeps U+02BB, so "oʻgʻli" and "o'g'li" produced two different keys
  // and the list silently missed the same person written the other way. The
  // blacklist key collapses all five apostrophes first.
  const variants = [
    "Vohidov Jamshid Shuxrat o\u02BBg\u02BBli", // ʻ modifier turned comma
    "Vohidov Jamshid Shuxrat o\u02BCg\u02BCli", // ʼ modifier apostrophe
    "Vohidov Jamshid Shuxrat o\u2018g\u2018li", // ‘ left single quote
    "Vohidov Jamshid Shuxrat o\u2019g\u2019li", // ’ right single quote
    "Vohidov Jamshid Shuxrat o'g'li", //             ASCII
    "Vohidov Jamshid Shuxrat ogli", //               none at all
  ];
  const keys = new Set(variants.map(blacklistKey));
  assert.equal(keys.size, 1, `variants split into ${[...keys].join(", ")}`);
  assert.equal([...keys][0], "vohidov-jamshid-shuxrat-ogli");

  // Different people still get different keys.
  assert.notEqual(blacklistKey("Vohidov Jamshid"), blacklistKey("Vohidov Jasur"));
  assert.equal(blacklistKey(""), "");
});

test("the seeded blacklist keys match what the code computes", () => {
  // A key written by hand into the migration that the app never produces would
  // be a row that can never match anyone.
  const seed = fs.readFileSync(
    "supabase/migrations/20260905040000_seed_blacklist.sql",
    "utf8",
  );
  const rows = [...seed.matchAll(/\n\s+'([a-z0-9-]+)',\n\s+'([^']*(?:'')?[^']*)',/g)];
  assert.ok(rows.length >= 5, `found ${rows.length} seeded rows`);
  for (const [, slug, fullName] of rows) {
    assert.equal(blacklistKey(fullName), slug, `${fullName} keys to ${slug}`);
  }
  assert.match(seed, /on conflict \(name_slug\) do nothing/);
});

test("the copy-paste photo prompt comes from the admin panel, not a constant", () => {
  // "Nomzod link rasm yaratish promtlari" edits photo_prompt_fragments. The
  // candidate card used to render a compiled-in constant, so anything set there
  // changed the in-app generation while the text candidates actually copied
  // stayed frozen — two prompts drifting apart with nothing saying so.
  const promptLib = fs.readFileSync("src/lib/intake/photo-prompt.ts", "utf8");
  assert.match(promptLib, /export async function buildManualPhotoPrompts/);
  assert.match(promptLib, /\.from\("photo_prompt_fragments"\)/);
  assert.match(promptLib, /\.eq\("is_active", true\)/);
  // Clearing a fragment must leave a working prompt, not an empty box.
  assert.match(promptLib, /MANUAL_PHOTO_PROMPTS\[gender\]/);

  // It reaches the candidate through the resolve payload...
  const resolve = fs.readFileSync("src/app/api/intake/resolve/route.ts", "utf8");
  assert.match(resolve, /buildManualPhotoPrompts\(\)/);
  assert.match(resolve, /photoPrompts,/);

  // ...and the card prefers it over the constant.
  const form = fs.readFileSync("src/components/intake/intake-form.tsx", "utf8");
  assert.match(form, /prompts\?\.\[promptGender\]\?\.trim\(\) \|\| MANUAL_PHOTO_PROMPTS\[promptGender\]/);
  assert.match(form, /<PhotoPromptCard gender=\{gender\} prompts=\{photoPrompts\} \/>/);
});

test("a forced resend is the only path past the sent-once guarantee", () => {
  // Normal delivery skips anyone holding a `sent` row, which is what made a
  // second press report "0 sent, 4 skipped". Forcing clears those rows first —
  // the partial unique index would otherwise reject the new ones.
  assert.match(TELEGRAM, /const alreadySent = options\.force\s*\?\s*new Set<string>\(\)/);
  assert.match(TELEGRAM, /if \(options\.force\) \{/);
  assert.match(TELEGRAM, /\.from\("telegram_post_deliveries"\)\s*\.delete\(\)/);
  // It is recorded as its own action, at warning severity.
  assert.match(TELEGRAM, /options\.force \? "post\.telegram_force_resent"/);

  // Reachable only from an explicit field, so no retry, cron or batch hits it.
  const actions = fs.readFileSync("src/lib/actions/post-studio.ts", "utf8");
  assert.match(actions, /const force = formData\.get\("force"\) === "on"/);
  const scheduler = fs.readFileSync("src/lib/post-studio/scheduler.ts", "utf8");
  assert.ok(!scheduler.includes("force"), "the scheduled sweep never forces");
  assert.ok(!PIPELINE.includes("force:"), "the pipeline never forces");

  // And the admin confirms before it happens.
  const studio = fs.readFileSync(
    "src/app/(admin)/postlar/[postId]/studio-client.tsx",
    "utf8",
  );
  assert.match(studio, /Majburiy qayta yuborish/);
  assert.match(studio, /formData\.set\("force", "on"\)/);
  assert.match(studio, /<ConfirmDialog/);
  assert.ok(
    studio.indexOf("setForceResendOpen(true)") < studio.indexOf('formData.set("force", "on")'),
    "the dialog opens before anything is sent",
  );
});

test("extending a link actually hands the form back to the candidate", () => {
  // resolveActiveLink only serves `draft` and `needs_clarification`, so a
  // submitted intake left the token refused. Pushing expires_at out on its own
  // changed nothing anyone could see: the admin extended, the link stayed dead.
  const data = fs.readFileSync("src/lib/intake/data.ts", "utf8");
  assert.match(data, /\["draft", "needs_clarification"\]\.includes/);

  const actions = fs.readFileSync("src/lib/actions/intakes.ts", "utf8");
  const fn = actions.slice(
    actions.indexOf("export async function extendLinkAction"),
    actions.indexOf("/* --------------------------- manual answers"),
  );
  assert.match(fn, /status: "needs_clarification"/, "the form is reopened");
  assert.match(fn, /expires_at: expiresAt/, "the deadline still moves");

  // A queued publish must not fire while the candidate is mid-edit, and null
  // (not 'skipped') lets the submit trigger re-arm it on their next send.
  assert.match(fn, /post_pipeline_status: null/);

  // An already-published candidate is refused: their article exists, and
  // editing the form behind a live page would silently desync the two.
  assert.match(actions, /const REOPENABLE_STATUSES/);
  for (const status of ["promoted", "published", "archived"]) {
    assert.ok(
      !new RegExp(`REOPENABLE_STATUSES[\\s\\S]*?"${status}"[\\s\\S]*?\\] as const`).test(actions),
      `${status} is not reopenable`,
    );
  }
  assert.match(fn, /nashr qilingan/, "the refusal explains itself");

  // And the panel says which of the two things happened.
  const panel = fs.readFileSync("src/components/intake/link-panel.tsx", "utf8");
  assert.match(panel, /r\.reopened \? "Havola ochildi" : "Muddat uzaytirildi"/);
});

/* ------------------------------------------------------------------ *
 * Post iqtibosi qoidalari
 * ------------------------------------------------------------------ */

test("a quote is judged by the rule the candidate was shown", () => {
  const good = checkQuote(
    "Har kuni kichik qadam tashlagan inson albatta manzilga yetadi. " +
      "Bilim olishdan hech qachon qo\u2018rqmang va to\u2018xtamang.",
  );
  assert.equal(good.ok, true, good.problems.join(" | "));
  assert.equal(good.sentences.length, QUOTE_SENTENCE_COUNT);
  assert.ok(good.wordCounts.every((n) => n >= QUOTE_MIN_WORDS_PER_SENTENCE));
});

test("each way of breaking the rule is named, so a retry can correct it", () => {
  // One sentence instead of two.
  const one = checkQuote("Har kuni kichik qadam tashlagan inson albatta manzilga yetadi.");
  assert.equal(one.ok, false);
  assert.match(one.problems.join(" "), /aynan 2 ta bo\u2018lishi kerak/);

  // Second sentence too short.
  const short = checkQuote(
    "Har kuni kichik qadam tashlagan inson manzilga yetadi. Harakat qiling.",
  );
  assert.equal(short.ok, false);
  assert.match(short.problems.join(" "), /2-gapda 2 ta so\u2018z/);

  // No terminator on the last sentence.
  const open = checkQuote(
    "Har kuni kichik qadam tashlagan inson manzilga yetadi. Bilim olishdan hech qachon qo\u2018rqmang",
  );
  assert.equal(open.ok, false);
  assert.match(open.problems.join(" "), /nuqta, undov yoki so\u2018roq/);
});

test("sentence splitting survives real punctuation", () => {
  assert.equal(splitSentences("Birinchi gap! Ikkinchi gap?").length, 2);
  assert.equal(splitSentences("Bitta gap.").length, 1);
  assert.equal(splitSentences("   ").length, 0);
  // A run of terminators is still one sentence, and no empty trailing entry.
  assert.equal(splitSentences("Harakat qiling!!! Yana urinib ko\u2018ring.").length, 2);
  // Apostrophes belong to the word, not between words.
  assert.equal(countWords("o\u2018qish va o\u2018rganish"), 3);
});

test("two quotes differing only by punctuation count as the same quote", () => {
  // Shipping both would be exactly the repetition this prevents.
  assert.equal(
    quoteFingerprint("Bilim — kuch, harakat esa natija!"),
    quoteFingerprint("bilim kuch harakat esa natija"),
  );
  assert.equal(quoteFingerprint("O\u2018qish"), quoteFingerprint("o'qish"));
  assert.notEqual(quoteFingerprint("Bilim kuch"), quoteFingerprint("Mehnat kuch"));

  assert.equal(isBlankQuote(""), true);
  assert.equal(isBlankQuote("   \n  "), true);
  assert.equal(isBlankQuote("—"), true, "punctuation alone is not an answer");
  assert.equal(isBlankQuote("Bilim"), false);
});

test("the quote is polished or written, and never over the raw answer", () => {
  const polish = fs.readFileSync("src/lib/intake/quote-polish.ts", "utf8");
  // Written to the intake, so the candidate's own wording stays recoverable.
  assert.match(polish, /post_quote: result\.text/);
  assert.match(polish, /post_quote_generated: result\.generated/);
  assert.ok(
    !polish.includes("candidate_intake_answers"),
    "the raw answer row is never written to",
  );

  // Empty answer means write one for them; anything else is adapted.
  assert.match(polish, /const generated = isBlankQuote\(raw\)/);

  // A repeat is retried with the failure named, not silently accepted.
  assert.match(polish, /seen\.has\(quoteFingerprint\(text\)\)/);
  assert.match(polish, /allaqachon ishlatilgan/);

  // Uniqueness spans both what future posters will carry and what past ones did.
  assert.match(polish, /\.from\("candidate_intakes"\)/);
  assert.match(polish, /\.from\("candidate_social_posts"\)/);

  // Failing every attempt still yields something rather than stopping the run.
  assert.match(polish, /return \{ text: best \|\| raw/);
});

test("the polished quote is what reaches the poster", () => {
  const repository = fs.readFileSync("src/lib/post-studio/repository.ts", "utf8");
  assert.match(repository, /const polished = preserveCanonicalPostQuote\(intake\.postQuote\)/);
  // An editor's manual edit still outranks it; the raw answer is the fallback.
  assert.match(repository, /manuallyEdited \|\|\s*polished \|\|/);

  // And it runs as part of the automatic editorial pass.
  const improve = fs.readFileSync("src/lib/intake/improve-service.ts", "utf8");
  assert.match(improve, /await applyPostQuote\(/);
  // A failure there must not lose the whole pass.
  assert.match(improve, /catch \(quoteError\)/);
});

test("the hint warns that an empty answer will be written for them", () => {
  for (const phrase of ["Ikkita gap", "kamida 6 ta so\u2018z", "ChatGPT", "Jaxongir AI", "1 oy"]) {
    assert.ok(
      CANONICAL_POST_QUOTE_HELP_TEXT.includes(phrase),
      `the hint states: ${phrase}`,
    );
  }
  const migration = fs.readFileSync(
    "supabase/migrations/20260905060000_post_quote_polish.sql",
    "utf8",
  );
  const setBlock = migration.slice(
    migration.indexOf("set help_text ="),
    migration.indexOf("where canonical_key = 'post_quote'"),
  );
  const rebuilt = (setBlock.match(/'([^']*)'/g) ?? [])
    .map((literal) => literal.slice(1, -1))
    .join("");
  assert.equal(rebuilt, CANONICAL_POST_QUOTE_HELP_TEXT);
  assert.doesNotMatch(migration, /drop table|delete from|truncate/i);
});
