import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  answeredQuestionPairs,
  buildDialogTurns,
  conversationRangeHash,
  countQuestions,
  ensureChronological,
  isQuestionTurn,
  pairQuestionResponses,
  type DialogMessage,
} from "../src/lib/sales/dialog.ts";
import {
  detectOutcome,
  isSuccessfulOutcome,
  SALES_OUTCOMES,
} from "../src/lib/sales/outcome.ts";
import {
  aggregateIntents,
  guessIntentFromText,
  intentShare,
  normalizeIntentKey,
  resolveIntent,
  type IntentObservation,
} from "../src/lib/sales/intents.ts";
import {
  aggregateBatches,
  aggregatePatterns,
  chunkIntoBatches,
  patternDedupeKey,
  rankPatternsByOutcome,
  type PatternObservation,
} from "../src/lib/sales/aggregate.ts";
import {
  buildBatchTranscript,
  isBatchShapeValid,
  normalizeBatchExtraction,
} from "../src/lib/sales/knowledge.ts";
import { computeRunProgress, formatEta } from "../src/lib/sales/progress-tracker.ts";
import { addUsage, EMPTY_USAGE, estimateCostUsd } from "../src/lib/sales/cost.ts";
import { analyzeStyle, type StyleSample } from "../src/lib/sales/style.ts";
import { DEFAULT_RECENCY_BUCKETS, recencyWeight } from "../src/lib/sales/recency.ts";
import { redactPii, PII_PLACEHOLDERS } from "../src/lib/sales/redact.ts";
import type { SalesOutcome } from "../src/lib/sales/outcome.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const NOW = new Date("2026-09-07T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const msg = (
  id: string,
  direction: "incoming" | "outgoing",
  text: string | null,
  sentAt: string,
  messageType = "text",
): DialogMessage => ({ id, direction, text, messageType, sentAt });

/* ===================== 1. BARCHA XABARLAR, XRONOLOGIYA ==================== */

test("xabarlar vaqt bo‘yicha tartiblanadi va tartib BARQAROR", () => {
  const shuffled = [
    msg("c", "outgoing", "uchinchi", at(10)),
    msg("a", "incoming", "birinchi", at(30)),
    msg("b", "outgoing", "ikkinchi", at(20)),
  ];
  assert.deepEqual(
    ensureChronological(shuffled).map((m) => m.id),
    ["a", "b", "c"],
  );

  // Bir xil vaqtdagi ikki xabar har safar bir xil tartibda kelishi kerak,
  // aks holda bir suhbat ikki xil xesh berardi.
  const sameTime = [
    msg("z", "incoming", "z", at(5)),
    msg("y", "outgoing", "y", at(5)),
  ];
  assert.deepEqual(ensureChronological(sameTime).map((m) => m.id), ["y", "z"]);
  assert.deepEqual(ensureChronological([...sameTime].reverse()).map((m) => m.id), ["y", "z"]);
});

test("ketma-ket bir tomon xabarlari BITTA navbatga birlashadi", () => {
  const turns = buildDialogTurns([
    msg("1", "incoming", "Salom", at(50)),
    msg("2", "incoming", "Narxi qancha?", at(49)),
    msg("3", "outgoing", "Assalomu alaykum!", at(48)),
    msg("4", "outgoing", "38 ming so‘m.", at(47)),
    msg("5", "incoming", "Nima foydasi bor?", at(46)),
  ]);

  assert.equal(turns.length, 3);
  assert.deepEqual(turns.map((t) => t.speaker), ["customer", "us", "customer"]);
  assert.deepEqual(turns[0].messageIds, ["1", "2"]);
  assert.equal(turns[0].text, "Salom\nNarxi qancha?");
  assert.deepEqual(turns[1].messageIds, ["3", "4"]);
});

test("matnsiz xabar navbatda qoladi, lekin matnni buzmaydi", () => {
  const turns = buildDialogTurns([
    msg("1", "incoming", "Mana chek", at(10)),
    msg("2", "incoming", null, at(9), "photo"),
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, "Mana chek");
  assert.deepEqual(turns[0].mediaTypes, ["photo"]);
  assert.deepEqual(turns[0].messageIds, ["1", "2"]);
});

/* ======================== 2. SAVOL-JAVOB JUFTLASHUVI ===================== */

const dialog: DialogMessage[] = [
  msg("m1", "incoming", "Narxi qancha?", at(60)),
  msg("m2", "outgoing", "38 ming so‘m.", at(59)),
  msg("m3", "incoming", "Nima foydasi bor?", at(58)),
  msg("m4", "outgoing", "Profilingiz saytda chiqadi va sertifikat beriladi.", at(57)),
  msg("m5", "incoming", "Rahmat", at(56)),
];

test("javob SAVOLDAN KEYINGI bizning navbatimizga bog‘lanadi", () => {
  const pairs = pairQuestionResponses(buildDialogTurns(dialog));
  assert.equal(pairs.length, 3);

  assert.equal(pairs[0].question.text, "Narxi qancha?");
  assert.equal(pairs[0].answer?.text, "38 ming so‘m.");
  assert.equal(pairs[0].followUp?.text, "Nima foydasi bor?");

  assert.equal(pairs[1].answer?.text, "Profilingiz saytda chiqadi va sertifikat beriladi.");
  // Oxirgi mijoz navbatiga javob berilmagan.
  assert.equal(pairs[2].answer, null);
});

test("javobsiz savol pattern uchun olinmaydi", () => {
  const answered = answeredQuestionPairs(buildDialogTurns(dialog));
  assert.equal(answered.length, 2);
  assert.ok(answered.every((pair) => pair.answer !== null));
});

test("savol aniqlash: belgi ham, so‘roq so‘zi ham", () => {
  assert.equal(isQuestionTurn({ text: "Narxi qancha?" }), true);
  assert.equal(isQuestionTurn({ text: "qancha turadi" }), true);
  assert.equal(isQuestionTurn({ text: "Rahmat" }), false);
  assert.equal(countQuestions("Narxi qancha? Qachon chiqadi? Sertifikat bormi?"), 3);
  assert.equal(countQuestions("Rahmat"), 0);
});

/* ========================= 3. NIYAT KLASTERLASHUVI ======================= */

test("bir xil ma’nodagi savollar BITTA niyatga tushadi", () => {
  const variants = ["narxi qancha?", "qancha turadi?", "nech pul?", "narxchi?", "qanchadan?"];
  for (const variant of variants) {
    const intent = guessIntentFromText(variant);
    assert.equal(intent?.key, "PRICE_QUESTION", variant);
  }
});

test("eng UZUN mos ibora yutadi", () => {
  // "to'lov nech pul?" da narx haqidagi ibora aniqroq.
  assert.equal(guessIntentFromText("to‘lov nech pul?")?.key, "PRICE_QUESTION");
  assert.equal(guessIntentFromText("to‘lov qanday amalga oshadi?")?.key, "PAYMENT_METHOD");
});

test("kalit normallashadi, noma’lum kalit ham saqlanadi", () => {
  assert.equal(normalizeIntentKey("narx savoli"), "NARX_SAVOLI");
  assert.equal(normalizeIntentKey("  price-question "), "PRICE_QUESTION");

  const known = resolveIntent("price_question");
  assert.equal(known?.key, "PRICE_QUESTION");
  assert.equal(known?.known, true);

  // Model yangi niyat topsa u ham REAL ma'lumot — tashlanmaydi.
  const novel = resolveIntent("DELIVERY_TIME", "Yetkazish muddati");
  assert.equal(novel?.known, false);
  assert.equal(novel?.kind, "question");
  assert.equal(resolveIntent("OBJECTION_SPOUSE", "Turmush o‘rtog‘im")?.kind, "objection");
});

test("kuzatuvlar klasterga yig‘iladi va ulush hisoblanadi", () => {
  const observation = (
    key: string,
    conversationId: string,
    example: string,
  ): IntentObservation => ({
    key,
    label: key,
    kind: "question",
    known: true,
    conversationId,
    customerExample: example,
    customerMessageId: `${conversationId}-m`,
  });

  const aggregates = aggregateIntents([
    observation("PRICE_QUESTION", "c1", "narxi qancha?"),
    observation("PRICE_QUESTION", "c2", "qancha turadi?"),
    observation("PRICE_QUESTION", "c2", "nech pul?"),
    observation("CERTIFICATE", "c3", "sertifikat bormi?"),
  ]);

  assert.equal(aggregates[0].key, "PRICE_QUESTION");
  assert.equal(aggregates[0].occurrences, 3);
  // Bitta suhbatda ikki marta so'ralsa ham suhbat soni ikkiga chiqmaydi.
  assert.equal(aggregates[0].conversationCount, 2);
  assert.equal(aggregates[0].examples.length, 3);

  assert.equal(intentShare(3, 4), 75);
  assert.equal(intentShare(0, 0), 0);
});

/* ============================ 4. SOTUV NATIJASI ========================== */

test("to‘lov so‘ralgani va to‘langani aniqlanadi, isboti bilan", () => {
  const requested = detectOutcome([
    msg("a", "incoming", "Narxi qancha?", at(60)),
    msg("b", "outgoing", "38 ming so‘m. To‘lovni amalga oshiring.", at(59)),
  ], { now: NOW });
  assert.equal(requested.outcome, "payment_requested");
  assert.equal(requested.evidenceMessageId, "b");
  assert.equal(requested.confident, true);

  const paid = detectOutcome([
    msg("a", "outgoing", "To‘lovni amalga oshiring.", at(60)),
    msg("b", "incoming", "To‘ladim, chek yubordim", at(59)),
  ], { now: NOW });
  // To'langan to'lov so'ralganidan USTUN.
  assert.equal(paid.outcome, "paid");
  assert.equal(paid.evidenceMessageId, "b");
});

test("aniq belgisi yo‘q yangi suhbat — noma’lum, taxmin qilinmaydi", () => {
  const result = detectOutcome([msg("a", "incoming", "Salom", at(5))], { now: NOW });
  assert.equal(result.outcome, "unknown");
  assert.equal(result.confident, false);
  assert.equal(result.evidenceMessageId, null);
});

test("davom etgan va uzilgan suhbat farqlanadi", () => {
  const continued = detectOutcome([
    msg("a", "incoming", "Narxi qancha?", at(60)),
    msg("b", "outgoing", "Salom", at(59)),
    msg("c", "incoming", "Tushunarli", at(58)),
  ], { now: NOW });
  assert.equal(continued.outcome, "continued");
  assert.equal(continued.confident, false);

  const dropped = detectOutcome(
    [
      msg("a", "incoming", "Narxi qancha?", daysAgo(30)),
      msg("b", "outgoing", "Ma’lumot yubordim", daysAgo(30)),
    ],
    { now: NOW },
  );
  assert.equal(dropped.outcome, "dropped");

  // Xuddi shu suhbat YANGI bo'lsa "uzilgan" emas: mijoz hali javob
  // berishga ulgurmagan bo'lishi mumkin.
  const fresh = detectOutcome(
    [
      msg("a", "incoming", "Narxi qancha?", at(30)),
      msg("b", "outgoing", "Ma’lumot yubordim", at(29)),
    ],
    { now: NOW },
  );
  assert.equal(fresh.outcome, "unknown");
});

test("muvaffaqiyat ta’rifi: davom etgan suhbat sotuv emas", () => {
  assert.equal(isSuccessfulOutcome("paid"), true);
  assert.equal(isSuccessfulOutcome("application_sent"), true);
  assert.equal(isSuccessfulOutcome("continued"), false);
  assert.equal(isSuccessfulOutcome("unknown"), false);
  assert.equal(SALES_OUTCOMES.length, 7);
});

/* ====================== 5. JAVOB VARIANTLARI VA REYTING ================== */

const patternObservation = (
  response: string,
  outcome: SalesOutcome,
  conversationId: string,
): PatternObservation => ({
  intentKey: "PRICE_QUESTION",
  intentLabel: "Narx qancha",
  intentKind: "question",
  conversationId,
  customerExample: "narxi qancha?",
  responseExample: response,
  customerMessageId: `${conversationId}-q`,
  responseMessageId: `${conversationId}-a`,
  outcome,
  observedAt: daysAgo(2),
});

test("bir xil javob variantga yig‘iladi, chastota va natija sanaladi", () => {
  const patterns = aggregatePatterns(
    [
      patternObservation("38 ming so‘m.", "paid", "c1"),
      patternObservation("38 ming so‘m", "paid", "c2"),
      patternObservation("38 ming so‘m.", "dropped", "c3"),
      patternObservation("Narxlar ro‘yxatini yuboraman.", "unknown", "c4"),
    ],
    { now: NOW },
  );

  const main = patterns.find((p) => p.responseExample.startsWith("38 ming"))!;
  // Nuqta farqi variantni ikkiga bo‘lmaydi.
  assert.equal(main.frequency, 3);
  assert.equal(main.successCount, 2);
  assert.equal(main.unknownCount, 0);
  assert.equal(main.successRate, 66.7);
  assert.equal(main.conversationIds.length, 3);
  assert.ok(main.recencyWeight > 0);
});

test("barcha natija noma’lum bo‘lsa successRate NULL — 0 emas", () => {
  const [pattern] = aggregatePatterns([patternObservation("Javob", "unknown", "c1")], { now: NOW });
  // 0 "ishlamadi", null "bilmaymiz" — ikkisi aralashsa reyting buziladi.
  assert.equal(pattern.successRate, null);
  assert.equal(pattern.unknownCount, 1);
});

test("eng yaxshi javob natija bo‘yicha, noma’lum esa oxirida", () => {
  const ranked = rankPatternsByOutcome([
    { successRate: null, successCount: 0, frequency: 100 },
    { successRate: 20, successCount: 2, frequency: 10 },
    { successRate: 80, successCount: 8, frequency: 10 },
  ]);
  assert.deepEqual(
    ranked.map((p) => p.successRate),
    [80, 20, null],
  );
});

test("javob varianti kaliti niyat + matndan chiqadi", () => {
  assert.equal(
    patternDedupeKey("PRICE_QUESTION", "38 ming so‘m"),
    patternDedupeKey("PRICE_QUESTION", "  38 ming so‘m. "),
  );
  assert.notEqual(
    patternDedupeKey("PRICE_QUESTION", "38 ming so‘m"),
    patternDedupeKey("CERTIFICATE", "38 ming so‘m"),
  );
});

/* ========================= 6. BATCH VA CHECKPOINT ======================== */

test("har suhbat AYNAN BITTA batchga tushadi", () => {
  const ids = Array.from({ length: 503 }, (_, i) => `c${i}`);
  const batches = chunkIntoBatches(ids, 15);

  assert.equal(batches.length, 34);
  const flat = batches.flat();
  assert.equal(flat.length, ids.length);
  assert.equal(new Set(flat).size, ids.length);
  assert.deepEqual(flat, ids);
  assert.equal(batches[batches.length - 1].length, 503 % 15);
});

test("batch hajmi 0 yoki manfiy bo‘lsa ham suhbat yo‘qolmaydi", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(chunkIntoBatches(ids, 0).flat(), ids);
  assert.deepEqual(chunkIntoBatches(ids, -5).flat(), ids);
  assert.deepEqual(chunkIntoBatches([], 10), []);
});

test("o‘zgarmagan suhbat bir xil xesh beradi, o‘zgargani boshqa", () => {
  const base = [...dialog];
  assert.equal(conversationRangeHash("c1", base), conversationRangeHash("c1", base));
  // Tartib buzilib kelsa ham xesh o'zgarmaydi.
  assert.equal(
    conversationRangeHash("c1", base),
    conversationRangeHash("c1", [...base].reverse()),
  );
  // Boshqa suhbat — boshqa xesh.
  assert.notEqual(conversationRangeHash("c1", base), conversationRangeHash("c2", base));
  // Yangi xabar qo'shilsa qayta o'rganish kerak.
  assert.notEqual(
    conversationRangeHash("c1", base),
    conversationRangeHash("c1", [...base, msg("m6", "incoming", "Yana savol", at(1))]),
  );
  // Xabar TAHRIRLANSA ham (soni o'zgarmasa ham) xesh o'zgaradi.
  const edited = base.map((m) => (m.id === "m2" ? { ...m, text: "38 ming so‘m, chegirma bor" } : m));
  assert.notEqual(conversationRangeHash("c1", base), conversationRangeHash("c1", edited));
});

/* ===================== 7. BATCH TRANSKRIPT VA BOG‘LANISH ================= */

const batchInput = [
  {
    conversationId: "conv-a",
    messages: [
      msg("a0", "incoming", "Narxi qancha? Raqamim +998 90 123 45 67", at(60)),
      msg("a1", "outgoing", "38 ming so‘m.", at(59)),
    ],
  },
  {
    conversationId: "conv-b",
    messages: [
      msg("b0", "incoming", "Sertifikat bormi?", at(40)),
      msg("b1", "outgoing", "Ha, sertifikat beriladi.", at(39)),
    ],
  },
];

test("batch transkripti PII’ni maskalaydi, narxni saqlaydi", () => {
  const transcript = buildBatchTranscript(batchInput);
  assert.ok(!transcript.text.includes("998 90 123 45 67"));
  assert.ok(transcript.text.includes(PII_PLACEHOLDERS.phone));
  assert.ok(transcript.text.includes("38 ming"));
  assert.ok(transcript.text.includes("### SUHBAT 0"));
  assert.ok(transcript.text.includes("[1.0] MIJOZ:"));
  assert.equal(transcript.messageCount, 4);
  assert.equal(transcript.conversations.get(1)?.conversationId, "conv-b");
});

test("redaksiya IDEMPOTENT — ikki marta qo‘llansa matn buzilmaydi", () => {
  const once = redactPii("Raqam +998901234567 va karta 8600123456789012").text;
  assert.equal(redactPii(once).text, once);
});

test("javob MIJOZ savoliga bog‘lanadi, teskarisi rad etiladi", () => {
  const transcript = buildBatchTranscript(batchInput);
  const outcomes = new Map<string, SalesOutcome>([["conv-a", "paid"]]);

  const ok = normalizeBatchExtraction(
    {
      conversations: [
        {
          conversationIndex: 0,
          intents: [{ key: "PRICE_QUESTION", customerIndex: 0, responseIndex: 1 }],
          knowledge: [],
        },
      ],
    },
    transcript,
    outcomes,
  );
  assert.equal(ok.intents.length, 1);
  assert.equal(ok.patterns.length, 1);
  assert.equal(ok.patterns[0].customerMessageId, "a0");
  assert.equal(ok.patterns[0].responseMessageId, "a1");
  // Natija suhbatdan keladi, modeldan emas.
  assert.equal(ok.patterns[0].outcome, "paid");
  // Matn asl yozishmadan olinadi — model qayta yozgan variant emas.
  assert.equal(ok.patterns[0].responseExample, "38 ming so‘m.");

  const swapped = normalizeBatchExtraction(
    {
      conversations: [
        {
          // Savol sifatida BIZNING satr ko'rsatilgan.
          conversationIndex: 0,
          intents: [{ key: "PRICE_QUESTION", customerIndex: 1, responseIndex: 0 }],
          knowledge: [],
        },
      ],
    },
    transcript,
    outcomes,
  );
  assert.equal(swapped.intents.length, 0);
  assert.ok(swapped.rejected.some((r) => r.reason.includes("mijoz satriga")));
});

test("savoldan OLDIN turgan javob pattern bo‘lmaydi", () => {
  const transcript = buildBatchTranscript([
    {
      conversationId: "conv-c",
      messages: [
        msg("c0", "outgoing", "Salom!", at(70)),
        msg("c1", "incoming", "Narxi qancha?", at(69)),
      ],
    },
  ]);
  const result = normalizeBatchExtraction(
    {
      conversations: [
        {
          conversationIndex: 0,
          intents: [{ key: "PRICE_QUESTION", customerIndex: 1, responseIndex: 0 }],
          knowledge: [],
        },
      ],
    },
    transcript,
    new Map(),
  );
  // Niyat qayd etiladi (savol haqiqatan bor), lekin javob juftligi yo'q.
  assert.equal(result.intents.length, 1);
  assert.equal(result.patterns.length, 0);
  assert.ok(result.rejected.some((r) => r.reason.includes("savoldan oldin")));
});

test("model kaliti bo‘lmasa niyat matndan topiladi", () => {
  const transcript = buildBatchTranscript(batchInput);
  const result = normalizeBatchExtraction(
    { conversations: [{ conversationIndex: 0, intents: [{ customerIndex: 0 }], knowledge: [] }] },
    transcript,
    new Map(),
  );
  assert.equal(result.intents[0]?.key, "PRICE_QUESTION");
});

test("javob shakli tekshiriladi — buzuq javob qayta urinishga sabab", () => {
  assert.equal(isBatchShapeValid({ conversations: [{ conversationIndex: 0 }] }), true);
  // Bo'sh ro'yxat TO'G'RI javob: hech narsa topilmagan bo'lishi mumkin.
  assert.equal(isBatchShapeValid({ conversations: [] }), true);
  assert.equal(isBatchShapeValid({ items: [] }), false);
  assert.equal(isBatchShapeValid([{ conversationIndex: 0 }]), false);
  assert.equal(isBatchShapeValid(null), false);
  assert.equal(isBatchShapeValid({ conversations: [{}] }), false);
});

test("bilim batchda ham manba xabarga bog‘lanadi va takrorlanmaydi", () => {
  const transcript = buildBatchTranscript(batchInput);
  const result = normalizeBatchExtraction(
    {
      conversations: [
        {
          conversationIndex: 0,
          intents: [],
          knowledge: [
            { category: "price", question: "Narxi qancha?", answer: "38 ming so‘m", sourceIndex: 1 },
            { category: "price", question: "narxi qancha? ", answer: "38 ming so‘m.", sourceIndex: 1 },
            { category: "price", answer: "manbasiz", sourceIndex: 99 },
          ],
        },
      ],
    },
    transcript,
    new Map(),
  );
  assert.equal(result.knowledge.length, 1);
  assert.equal(result.knowledge[0].sourceMessageId, "a1");
  assert.equal(result.knowledge[0].sourceConversationId, "conv-a");
  assert.ok(result.rejected.some((r) => r.reason.includes("takrorlandi")));
  assert.ok(result.rejected.some((r) => r.reason.includes("sourceIndex")));
});

test("batchlar yig‘indisida suhbat ikki marta sanalmaydi", () => {
  const aggregate = aggregateBatches(
    [
      {
        batchIndex: 0,
        conversationIds: ["c1", "c2"],
        messagesProcessed: 10,
        intents: [],
        patterns: [],
        knowledge: [],
        styleSamples: [],
        outcomes: [{ conversationId: "c1", outcome: "paid" }],
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      },
      {
        batchIndex: 1,
        // c2 ikkinchi marta uchraydi (qayta ishlangan batch).
        conversationIds: ["c2", "c3"],
        messagesProcessed: 5,
        intents: [],
        patterns: [],
        knowledge: [],
        styleSamples: [],
        outcomes: [],
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      },
    ],
    { now: NOW },
  );

  assert.equal(aggregate.conversationsProcessed, 3);
  assert.deepEqual(aggregate.uniqueConversationIds, ["c1", "c2", "c3"]);
  assert.equal(aggregate.messagesProcessed, 15);
  assert.equal(aggregate.usage.totalTokens, 180);
  assert.equal(aggregate.outcomes.get("c1"), "paid");
});

/* ============================ 8. PROGRESS (REAL) ========================= */

test("foiz HAQIQIY sanoqdan chiqadi", () => {
  const progress = computeRunProgress({
    stage: "clustering",
    processedConversations: 250,
    targetConversations: 500,
    processedMessages: 4000,
    totalMessages: 8421,
    startedAt: null,
  });
  // Batch bosqichi 25–80% oralig'ida; yarmi ishlangan => 52.5%.
  assert.equal(progress.percent, 52.5);
  assert.equal(progress.conversationLabel, "250 / 500");
  assert.ok(progress.messageLabel.includes("8"));
});

test("hech narsa ishlanmagan bo‘lsa soxta progress yo‘q", () => {
  const progress = computeRunProgress({
    stage: "clustering",
    processedConversations: 0,
    targetConversations: 500,
    processedMessages: 0,
    totalMessages: 8421,
    startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    now: NOW,
  });
  assert.equal(progress.percent, 25);
  // Tezlik o'lchanmagan — ETA taxmin qilinmaydi.
  assert.equal(progress.etaSeconds, null);
  assert.equal(progress.throughput, null);
  assert.equal(formatEta(null), "—");
});

test("ETA o‘lchangan tezlikdan hisoblanadi", () => {
  const progress = computeRunProgress({
    stage: "clustering",
    processedConversations: 100,
    targetConversations: 500,
    processedMessages: 1000,
    totalMessages: 5000,
    // 100 ta suhbat 100 sekundda => 1/sek => qolgan 400 ta ~400 sekund.
    startedAt: new Date(NOW.getTime() - 100_000).toISOString(),
    now: NOW,
  });
  assert.equal(progress.throughput, 1);
  assert.equal(progress.etaSeconds, 400);
  assert.equal(formatEta(400), "6m 40s");
});

test("progress 100 dan oshmaydi va bosqichlar to‘g‘ri joylashadi", () => {
  const done = computeRunProgress({
    stage: "done",
    processedConversations: 500,
    targetConversations: 500,
    processedMessages: 8421,
    totalMessages: 8421,
    startedAt: new Date(NOW.getTime() - 100_000).toISOString(),
    now: NOW,
  });
  assert.equal(done.percent, 100);
  assert.equal(done.etaSeconds, null);

  assert.equal(
    computeRunProgress({
      stage: "loading",
      processedConversations: 0,
      targetConversations: 500,
      processedMessages: 0,
      totalMessages: 0,
      startedAt: null,
    }).percent,
    1,
  );
});

/* ============================== 9. TOKEN / NARX ========================== */

test("token yig‘indisi va narx hisoblanadi", () => {
  const usage = addUsage(addUsage(EMPTY_USAGE, { promptTokens: 1000, completionTokens: 200 }), {
    promptTokens: 500,
    completionTokens: 100,
  });
  assert.equal(usage.promptTokens, 1500);
  assert.equal(usage.totalTokens, 1800);

  const cost = estimateCostUsd("gpt-4o-mini", usage);
  // 1500/1M*0.15 + 300/1M*0.6
  assert.equal(cost, 0.0004);
});

test("narxi noma’lum model uchun narx TAXMIN QILINMAYDI", () => {
  assert.equal(estimateCostUsd("qandaydir-yangi-model", EMPTY_USAGE), null);
});

/* ======================= 10. RECENCY VA USLUB KUCHI ====================== */

test("yangi recency jadvali yetti pog‘onali", () => {
  const cases: Array<[number, number]> = [
    [0, 1.0],
    [3, 1.0],
    [4, 0.95],
    [7, 0.95],
    [8, 0.85],
    [14, 0.85],
    [15, 0.7],
    [30, 0.7],
    [31, 0.45],
    [60, 0.45],
    [61, 0.3],
    [90, 0.3],
    [91, 0.15],
    [365, 0.15],
  ];
  for (const [age, expected] of cases) {
    assert.equal(recencyWeight(age), expected, `${age} kun`);
  }
  assert.equal(DEFAULT_RECENCY_BUCKETS.length, 7);
});

const styleSample = (
  text: string,
  ageDays: number,
  extra: Partial<StyleSample> = {},
): StyleSample => ({
  text,
  sentAt: daysAgo(ageDays),
  direction: "outgoing",
  conversationId: `c-${ageDays}`,
  ...extra,
});

test("oxirgi kunlardagi uslub eskisidan KUCHLIROQ", () => {
  const recent = analyzeStyle(
    [
      styleSample("Rahmat 😊", 1),
      styleSample("Zo‘r 🚀", 2),
      styleSample("Hurmatli mijoz, arizangiz qabul qilindi.", 120),
      styleSample("Hurmatli mijoz, hujjat tayyor.", 200),
    ],
    { now: NOW },
  );
  // 2 × 1.00 va 2 × 0.15 => emoji ulushi 0.87 atrofida.
  assert.ok(recent.profile.emoji.usageRate > 0.8, String(recent.profile.emoji.usageRate));

  const old = analyzeStyle(
    [
      styleSample("Rahmat 😊", 120),
      styleSample("Zo‘r 🚀", 200),
      styleSample("Hurmatli mijoz, arizangiz qabul qilindi.", 1),
      styleSample("Hurmatli mijoz, hujjat tayyor.", 2),
    ],
    { now: NOW },
  );
  assert.ok(old.profile.emoji.usageRate < 0.2, String(old.profile.emoji.usageRate));
});

test("mijoz qisqa yozsa qanday javob berishimiz o‘lchanadi", () => {
  const analysis = analyzeStyle(
    [
      styleSample("Ha", 1, { incomingWords: 2, incomingQuestionCount: 1 }),
      styleSample("Albatta", 1, { incomingWords: 3, incomingQuestionCount: 1 }),
      styleSample(
        "Narxlar quyidagicha va har bir tarif alohida imkoniyat beradi, batafsil yozaman",
        1,
        { incomingWords: 2, incomingQuestionCount: 1 },
      ),
    ],
    { now: NOW },
  );
  const r = analysis.profile.reciprocity;
  assert.ok(r.samples > 0);
  assert.ok(r.shortInShortOutRate > r.shortInLongOutRate);

  // Juftlik konteksti yo'q namunalar ulushga KIRMAYDI.
  const unpaired = analyzeStyle([styleSample("Ha", 1)], { now: NOW });
  assert.equal(unpaired.profile.reciprocity.samples, 0);
  assert.equal(unpaired.profile.reciprocity.shortInShortOutRate, 0);
});

test("ko‘p savolga ro‘yxat bilan javob berish o‘lchanadi", () => {
  const analysis = analyzeStyle(
    [
      styleSample("1. Narxi 38 ming\n2. Bir haftada chiqadi", 1, {
        incomingWords: 8,
        incomingQuestionCount: 2,
      }),
      styleSample("Narxi 38 ming, bir haftada chiqadi", 1, {
        incomingWords: 8,
        incomingQuestionCount: 2,
      }),
    ],
    { now: NOW },
  );
  assert.equal(analysis.profile.structure.multiQuestionSamples, 2);
  assert.equal(analysis.profile.structure.multiQuestionListShare, 0.5);
});

test("qisqa/batafsil javob ulushi va follow-up aniqlanadi", () => {
  const analysis = analyzeStyle(
    [
      styleSample("Ha, albatta", 1),
      styleSample(
        "Assalomu alaykum, avvalgi xabarimni eslatib o‘taman va javobingizni kutyapmiz; " +
          "agar savolingiz qolgan bo‘lsa, bemalol yozing, biz batafsil tushuntirib beramiz",
        1,
      ),
    ],
    { now: NOW },
  );
  assert.ok(analysis.profile.length.shortShare > 0);
  assert.ok(analysis.profile.length.detailedShare > 0);
  assert.ok(analysis.profile.followUp.usageRate > 0);
  assert.ok(analysis.profile.followUp.top.length > 0);
  // Follow-up iboralari lug'atdan — ularda raqam bo'lishi mumkin emas.
  for (const phrase of analysis.profile.followUp.top) {
    assert.ok(!/\d/.test(phrase.phrase));
  }
});

/* ===================== 11. AVTO-JAVOB YO‘Q (yangi kod) =================== */

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("chuqur o‘rganish moduli ham mijozga xabar yubormaydi", () => {
  const source = stripComments(readFileSync(join(ROOT, "src/lib/sales/deep-learning.ts"), "utf8"));
  assert.ok(!/\b(sendMessage|sendPhoto|copyMessage|forwardMessage)\b/.test(source));
  assert.ok(!source.includes("telegram"));
  assert.ok(!source.includes("api.telegram.org"));
});

/* ====================== 12. MIGRATSIYA KAFOLATLARI ======================= */

const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260907170000_sales_deep_learning.sql"),
  "utf8",
);

test("0.1 sxemasi buzilmaydi: drop/rename yo‘q", () => {
  assert.ok(!/drop table/i.test(MIGRATION));
  assert.ok(!/drop column/i.test(MIGRATION));
  assert.ok(!/rename/i.test(MIGRATION));
  // 0.1 dagi learning_status ustuniga tegilmaydi — chuqur oqim o'zinikini ishlatadi.
  assert.ok(MIGRATION.includes("deep_learning_status"));
});

test("batch checkpointi unikal va qisman EMAS", () => {
  assert.ok(
    /create unique index if not exists uq_sales_learning_batches_job_index\s+on public\.sales_learning_batches\(job_id, batch_index\)/.test(
      MIGRATION,
    ),
  );
  const idx = MIGRATION.slice(MIGRATION.indexOf("uq_sales_learning_batches_job_index"));
  assert.ok(!idx.slice(0, 200).includes("where"));
});

test("javob shabloni qoralama bo‘lib tug‘iladi va success_rate NULL bo‘la oladi", () => {
  assert.ok(/status text not null default 'draft'/.test(MIGRATION));
  assert.ok(/success_rate numeric\(5, 2\)(?!\s+not null)/.test(MIGRATION));
});

test("recency sozlamasi FAQAT tegilmagan bo‘lsa yangilanadi", () => {
  // `where ... and value = <0.1 defaulti>` — admin sozlagan jadval
  // ustidan yozilmasligi kerak.
  assert.ok(/update public\.sales_settings/.test(MIGRATION));
  assert.ok(/where key = 'recency_buckets'\s+and value = '\[/.test(MIGRATION));
});

test("yangi jadvallarda ham public policy yo‘q", () => {
  const sql = MIGRATION.replace(/''/g, "'");
  assert.ok(!/to anon/.test(sql));
  assert.ok(!/using \(true\)/.test(sql));
  assert.ok(sql.includes("has_permission('sales.view')"));
  assert.ok(sql.includes("has_permission('sales.manage')"));
});

/* ================= 13. O‘ZBEK APOSTROFI (regressiya testi) =============== */

test("apostrofning barcha varianti bir xil taniladi", () => {
  // Telegram klaviaturasi, iPhone tuzatishi va veb forma uch xil belgi
  // beradi. Bu normallashtirilmasa, "to'lov so'raldi" belgisi jimgina
  // ishlamay qolardi — testda aynan shu tutilgan.
  const variants = ["to‘lovni", "to’lovni", "to'lovni", "toʻlovni", "to`lovni"];
  for (const variant of variants) {
    const result = detectOutcome(
      [
        msg("a", "incoming", "Narxi qancha?", at(60)),
        msg("b", "outgoing", `38 ming so‘m. ${variant} amalga oshiring.`, at(59)),
      ],
      { now: NOW },
    );
    assert.equal(result.outcome, "payment_requested", variant);
  }
});

test("niyat lug‘ati ham apostrof variantiga bog‘liq emas", () => {
  for (const variant of ["ro‘yxatdan qanday", "ro'yxatdan qanday", "roʻyxatdan qanday"]) {
    assert.equal(guessIntentFromText(variant)?.key, "APPLICATION_PROCESS", variant);
  }
});

test("uslub lug‘ati ham apostrof variantiga bog‘liq emas", () => {
  for (const variant of ["ariza qoldiring", "ro‘yxatdan o‘ting", "ro'yxatdan o'ting"]) {
    const analysis = analyzeStyle([styleSample(`Marhamat, ${variant}.`, 1)], { now: NOW });
    assert.ok(analysis.profile.cta.usageRate > 0, variant);
  }
});

/* =============== 14. TANLASH QOIDASI (manba darajasida) ================= */

test("suhbatlar oxirgi yozishilgani bo‘yicha va CHEGARA bilan olinadi", () => {
  // Bu qoida baza so‘rovida yashaydi, shuning uchun manba darajasida
  // qo‘riqlanadi: tartib yoki chegara tushib qolsa, "oxirgi 500 ta"
  // va’dasi jimgina buzilardi.
  const source = readFileSync(join(ROOT, "src/lib/sales/deep-learning.ts"), "utf8");
  const selection = source.slice(
    source.indexOf("async function selectLatestConversations"),
    source.indexOf("/* ------------------------------- job ochish"),
  );
  assert.match(selection, /\.order\("last_message_at", \{ ascending: false/);
  assert.match(selection, /\.limit\(limit\)/);

  // Xabarlar suhbat ichida XRONOLOGIK olinadi — dialog zanjiri shunga tayanadi.
  const loader = source.slice(
    source.indexOf("async function loadConversationMessages"),
    source.indexOf("/* ------------------------------ batch ishlash"),
  );
  assert.match(loader, /\.order\("sent_at", \{ ascending: true \}\)/);
  // O'chirilgan xabar o'rganilmaydi.
  assert.match(loader, /\.is\("deleted_at", null\)/);
});

test("standart qamrov: oxirgi 500 suhbat, 15 talik batch", () => {
  const settings = readFileSync(join(ROOT, "src/lib/sales/settings.ts"), "utf8");
  const block = settings.slice(settings.indexOf("DEFAULT_DEEP_LEARNING_SETTINGS"));
  assert.match(block, /targetConversations: 500/);
  assert.match(block, /batchSize: 15/);
  assert.match(block, /maxMessagesPerConversation: 400/);
});
