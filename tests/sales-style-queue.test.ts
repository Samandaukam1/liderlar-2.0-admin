import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzeStyleDataset,
  classifyMessage,
  collectStyleSignals,
  describeLengths,
  isRecommendableExample,
  isUppercasePressure,
  percentile,
  selectHumanDataset,
  type StyleCandidate,
} from "../src/lib/sales/mining/style-dataset.ts";
import {
  backoffMs,
  decideAfterFailure,
  isClaimable,
  isLeaseExpired,
  isTerminal,
  jobIdempotencyKey,
  selectNextJobs,
  DEFAULT_MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  type QueuedJobRow,
} from "../src/lib/sales/queue/job-state.ts";
import {
  findUnsupportedNumericClaims,
  extractNumericClaims,
} from "../src/lib/sales/number-guard.ts";
import { redactPii, isRedacted, containsPii } from "../src/lib/sales/redact.ts";
import {
  aggregatePatterns,
  confidenceFor,
  formatRate,
  rateOrNull,
  type PatternObservation,
} from "../src/lib/sales/mining/response-analytics.ts";

/* ==================== USLUB: FAQAT INSON ============================== */

function candidate(overrides: Partial<StyleCandidate> = {}): StyleCandidate {
  return {
    text: "Xo‘p, kutamiz.",
    sentAt: "2026-09-10T10:00:00.000Z",
    origin: "human",
    conversationId: "c1",
    delivered: true,
    deleted: false,
    simulated: false,
    ...overrides,
  };
}

test("USLUB FAQAT INSON xabaridan o‘rganiladi", () => {
  /*
   * 19-BAND. Bot o'z javobini namuna qilib olsa, o'z xatosini
   * mustahkamlaydi — auditdagi "hi" muammosi aynan shunday
   * kuchaygan edi.
   */
  const selection = selectHumanDataset([
    candidate({ origin: "human" }),
    candidate({ origin: "ai" }),
    candidate({ origin: "system" }),
    candidate({ origin: "customer" }),
    candidate({ deleted: true }),
    candidate({ simulated: true }),
    candidate({ delivered: false }),
    candidate({ text: "" }),
  ]);

  assert.equal(selection.kept.length, 1, "faqat bitta inson xabari qoladi");
  assert.equal(selection.excluded.ai, 1);
  assert.equal(selection.excluded.system, 1);
  assert.equal(selection.excluded.customer, 1);
  assert.equal(selection.excluded.deleted, 1);
  assert.equal(selection.excluded.simulated, 1);
  assert.equal(selection.excluded.undelivered, 1);
  assert.equal(selection.excluded.empty, 1);
  assert.equal(selection.excludedTotal, 7, "chiqarilganlar SANALADI — qamrov halol");
});

test("UZUN SHABLON qisqa javoblardan AJRATILADI", () => {
  /*
   * 20-BAND. O'lchangan holat: median 42 belgi, o'rtacha 344 —
   * sakkiz barobar farq, chunki 3 709 belgilik foydalar bloki
   * o'rtachani tortadi. Ular bitta sinfda bo'lsa, prompt
   * "o'rtacha 344 belgi yoz" deb buyurardi.
   */
  assert.equal(classifyMessage("xo‘p"), "short_operational");
  assert.equal(classifyMessage("A".repeat(1200)), "canonical_template");
});

test("MEDIANA ishlatiladi, o‘rtacha xulosa uchun emas", () => {
  // To'rtta qisqa va bitta juda uzun xabar.
  const lengths = [10, 20, 30, 40, 3709];
  const stats = describeLengths(lengths);

  assert.equal(stats.median, 30);
  assert.ok(stats.mean > 700, "o‘rtacha uzun xabardan buzildi");
  assert.ok(stats.median < stats.mean / 10, "mediana barqaror, o‘rtacha emas");
  assert.equal(stats.p25, 20);
  assert.equal(stats.p90, 3709);
});

test("persentil chegaralarda ham to‘g‘ri ishlaydi", () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([5], 0.5), 5);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
});

test("KATTA HARFLI BOSIM tavsiya namunasiga tushmaydi", () => {
  /*
   * 21-BAND: qo'pollik, bosim va "..." bilan javob — bular uslub
   * emas, XATO. Ular statistikada ko'rinadi, lekin namuna
   * sifatida ko'rsatilmaydi.
   */
  assert.ok(isUppercasePressure("FAQAT BUGUN CHEGIRMA BOR SHOSHILING"));
  assert.ok(!isUppercasePressure("Assalomu alaykum"));
  assert.ok(!isRecommendableExample("FAQAT BUGUN CHEGIRMA BOR SHOSHILING"));
  assert.ok(!isRecommendableExample("..."));
  assert.ok(isRecommendableExample("Anketani to‘ldirib yuboring, kutamiz."));
});

test("taqiqlangan uslub belgilari SANALADI", () => {
  const signals = collectStyleSignals([
    "chegirma faqat bugun, shoshiling",
    "juda yomon chiqibsiz",
    "Anketani to‘ldirib yuboring.",
  ]);

  const forbidden = signals.filter((signal) => signal.kind === "forbidden");
  assert.ok(forbidden.some((signal) => signal.key === "fake_urgency"));
  assert.ok(signals.some((signal) => signal.kind === "positive"));
});

test("to‘liq tahlil qamrovni halol qaytaradi", () => {
  const analysis = analyzeStyleDataset([
    candidate({ text: "xo‘p" }),
    candidate({ text: "Anketani to‘ldirib yuboring." }),
    candidate({ text: "A".repeat(1500) }),
    candidate({ origin: "ai", text: "AI javobi" }),
  ]);

  assert.equal(analysis.humanMessageCount, 3);
  assert.equal(analysis.excluded.ai, 1);
  assert.ok(analysis.classes.length >= 2, "sinflar ajratilgan");
  assert.ok(analysis.classes.some((row) => row.messageClass === "canonical_template"));
});

/* ==================== NAVBAT ========================================== */

test("qulf band bo‘lgan ish OLINADIGAN holatda qoladi", () => {
  assert.ok(isClaimable("queued"));
  assert.ok(isClaimable("waiting"));
  assert.ok(isClaimable("failed_retryable"));
  assert.ok(!isClaimable("succeeded"));
  assert.ok(!isClaimable("dead_letter"));
});

test("terminal holatlardan chiqilmaydi", () => {
  assert.ok(isTerminal("succeeded"));
  assert.ok(isTerminal("dead_letter"));
  assert.ok(isTerminal("skipped"));
  assert.ok(!isTerminal("queued"));
});

test("BITTA SUHBATDAN BITTA ish olinadi — tartib buzilmaydi", () => {
  /*
   * 27-BAND. Ikkita ish parallel bajarilsa, ikkinchi javob
   * birinchisidan oldin ketib qolishi mumkin va mijoz suhbatni
   * teskari tartibda o'qirdi.
   */
  const now = new Date("2026-09-14T12:00:00.000Z");
  const rows: QueuedJobRow[] = [
    { id: "j1", conversationId: "c1", messageId: "m1", state: "queued", enqueuedAt: "2026-09-14T11:00:00.000Z", priority: 100, availableAt: "2026-09-14T11:00:00.000Z" },
    { id: "j2", conversationId: "c1", messageId: "m2", state: "queued", enqueuedAt: "2026-09-14T11:01:00.000Z", priority: 100, availableAt: "2026-09-14T11:01:00.000Z" },
    { id: "j3", conversationId: "c2", messageId: "m3", state: "queued", enqueuedAt: "2026-09-14T11:02:00.000Z", priority: 100, availableAt: "2026-09-14T11:02:00.000Z" },
  ];

  const chosen = selectNextJobs(rows, { now, limit: 10 });
  assert.equal(chosen.length, 2, "c1 dan faqat bittasi");
  assert.deepEqual(chosen.map((job) => job.id), ["j1", "j3"]);
  assert.equal(chosen[0].id, "j1", "eng eski birinchi — tartib saqlanadi");
});

test("vaqti kelmagan ish olinmaydi", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");
  const rows: QueuedJobRow[] = [
    { id: "j1", conversationId: "c1", messageId: null, state: "failed_retryable", enqueuedAt: "2026-09-14T11:00:00.000Z", priority: 100, availableAt: "2026-09-14T13:00:00.000Z" },
  ];
  assert.equal(selectNextJobs(rows, { now }).length, 0);
});

test("RETRY CHEKLANGAN — cheksiz urinish yo‘q", () => {
  const almost = decideAfterFailure(
    { state: "claimed", attempts: DEFAULT_MAX_ATTEMPTS - 1, maxAttempts: DEFAULT_MAX_ATTEMPTS },
    { now: new Date() },
  );
  assert.equal(almost.state, "dead_letter", "chegaraga yetganda dead-letter");

  const retry = decideAfterFailure(
    { state: "claimed", attempts: 1, maxAttempts: DEFAULT_MAX_ATTEMPTS },
    { now: new Date() },
  );
  assert.equal(retry.state, "failed_retryable");
  assert.ok(retry.availableAt != null, "keyingi urinish vaqti belgilanadi");
});

test("qaytarib bo‘lmaydigan xato darhol dead-letter", () => {
  const decision = decideAfterFailure(
    { state: "claimed", attempts: 0, maxAttempts: DEFAULT_MAX_ATTEMPTS },
    { permanent: true },
  );
  assert.equal(decision.state, "dead_letter");
});

test("backoff o‘sadi, lekin CHEGARASI bor", () => {
  assert.ok(backoffMs(1) < backoffMs(3));
  assert.equal(backoffMs(50), MAX_BACKOFF_MS, "chegarasiz kutish mijozni yo‘qotardi");
});

test("lease muddati o‘tgan ish QAYTA OLINADI", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");
  assert.ok(isLeaseExpired("2026-09-14T11:59:00.000Z", now), "o‘lgan worker navbatni bloklamaydi");
  assert.ok(!isLeaseExpired("2026-09-14T12:05:00.000Z", now));
  assert.ok(isLeaseExpired(null, now));
});

test("IDEMPOTENTLIK kaliti xabarga bog‘langan", () => {
  // Telegram bitta update'ni ikki marta yetkazsa, kalit bir xil
  // bo'ladi va ikkinchi ish yaratilmaydi.
  const a = jobIdempotencyKey({ conversationId: "c1", messageId: "m1", kind: "reply" });
  const b = jobIdempotencyKey({ conversationId: "c1", messageId: "m1", kind: "reply" });
  assert.equal(a, b);

  const other = jobIdempotencyKey({ conversationId: "c1", messageId: "m2", kind: "reply" });
  assert.notEqual(a, other);
});

/* ==================== RAQAM TO'SIG'I ================================== */

test("MANBASIZ “2 kun” BLOKLANADI — bir xonali son ham fakt da’vosi", () => {
  /*
   * 31-BAND. Eski guard `digits.length <= 1` bo'lsa tekshiruvni
   * o'tkazib yuborardi, ya'ni manbasiz "2 kun" bemalol ketardi.
   */
  const unsupported = findUnsupportedNumericClaims("Maqola 2 kunda chiqadi.", [
    "Narxi 38 000 so‘m.",
  ]);
  assert.equal(unsupported.length, 1);
  assert.equal(unsupported[0].unit, "muddat");
});

test("TASDIQLANGAN muddat va narx o‘tadi", () => {
  assert.equal(
    findUnsupportedNumericClaims("Maqola 3 kunda chiqadi, narxi 38 000 so‘m.", [
      "Maqola odatda 3 kunda tayyor bo‘ladi.",
      "Narx 38 000 so‘m.",
    ]).length,
    0,
  );
});

test("manbasiz FOIZ va MIQDOR ham bloklanadi", () => {
  assert.equal(findUnsupportedNumericClaims("5% chegirma bor.", ["narx 38 000"]).length, 1);
  assert.equal(findUnsupportedNumericClaims("7 ta maqola chiqaramiz.", ["narx 38 000"]).length, 1);
});

test("BIRLIKSIZ son fakt da’vosi emas — asossiz bloklanmaydi", () => {
  /*
   * "Bitta savol bering" yoki ro'yxat raqami bloklanmasligi kerak:
   * ular biznes da'vosi emas va bloklansa foydali javob yo'qolardi.
   */
  assert.equal(extractNumericClaims("1. Birinchi qadam\n2. Ikkinchi qadam").length, 0);
  assert.equal(findUnsupportedNumericClaims("Menga 1 savol bering.", []).length, 0);
});

test("vaqt va sana fakt da’vosi sifatida ushlanmaydi", () => {
  assert.equal(extractNumericClaims("Soat 14:30 da yozaman").length, 0);
});

test("joriy yil bloklanmaydi", () => {
  assert.equal(findUnsupportedNumericClaims("2026 yilgi ro‘yxat", []).length, 0);
});

/* ==================== PII ============================================= */

test("ANKETA HAVOLASIDAGI TOKEN olib tashlanadi, yo‘l qoladi", () => {
  /*
   * 33-BAND. Havola BIR MARTALIK KIRISH KALITI: kim ko'rsa,
   * o'sha mijozning anketasini ochadi. Auditda u xom holda
   * outbound jurnalga yozilardi.
   */
  const result = redactPii("Anketa: https://liderlar.uz/anketa/AbCdEf0123456789XyZ_-QwErTy");
  assert.ok(result.kinds.includes("intake_link"));
  assert.ok(!result.text.includes("AbCdEf0123456789XyZ"), "token qolmaydi");
  assert.ok(result.text.includes("/anketa/"), "yo‘l saqlanadi — admin qaysi havola ekanini biladi");
});

test("Telegram identifikatori va foydalanuvchi nomi maskalanadi", () => {
  assert.ok(redactPii("tg://user?id=123456789").kinds.includes("telegram_id"));
  assert.ok(redactPii("Telegram ID: 987654321").kinds.includes("telegram_id"));
  assert.ok(redactPii("yozing: @sinovfoydalanuvchi").kinds.includes("telegram_username"));
  assert.ok(redactPii("https://t.me/sinovkanal").kinds.includes("telegram_username"));
});

test("BIZNES FAKTLARI maskalanmaydi", () => {
  /*
   * 8-BAND: "Do NOT mask useful business facts such as 38 000 so'm".
   * Narx maskalansa, bilim bazasi ma'nosini yo'qotardi.
   */
  const result = redactPii("Narx 38 000 so‘m, oldin 100 000 so‘m edi. Maqola 3–7 kunda chiqadi.");
  assert.equal(result.kinds.length, 0, "hech narsa maskalanmadi");
  assert.ok(result.text.includes("38 000"));
  assert.ok(result.text.includes("100 000"));
  assert.ok(result.text.includes("3–7 kun"));
});

test("telefon va karta maskalanadi", () => {
  assert.ok(redactPii("+998 90 123 45 67").kinds.includes("phone"));
  assert.ok(redactPii("8600 1234 5678 9012").kinds.includes("card"));
});

test("REDAKSIYADAN O‘TGAN matn “toza” deb baholanadi", () => {
  /*
   * `token: [maxfiy]` o'z naqshiga qayta tushib, `isRedacted()`
   * doim `false` qaytarardi — bilim yozuvi umuman saqlanmasdi.
   */
  const once = redactPii("token: abcdef123456 va @sinovfoydalanuvchi");
  assert.ok(containsPii("token: abcdef123456"));
  assert.ok(isRedacted(once.text), "ikkinchi o‘tishda PII topilmaydi");
});

test("bo‘sh kirish xato bermaydi", () => {
  assert.deepEqual(redactPii(null), { text: "", kinds: [] });
  assert.deepEqual(redactPii(undefined), { text: "", kinds: [] });
});

/* ==================== JAVOB ANALITIKASI =============================== */

test("FOIZ NAMUNA HAJMISIZ ko‘rsatilmaydi", () => {
  /*
   * 37-BAND. 1/1 = 100% va 340/400 = 85% bir xil ko'rinardi.
   */
  assert.equal(rateOrNull(1, 1), null, "bitta kuzatuvdan foiz chiqarilmaydi");
  assert.equal(rateOrNull(9, 10), 90);
  assert.match(formatRate(1, 1), /namuna yetarli emas/);
  assert.match(formatRate(9, 10), /90%/);
});

test("ishonch darajasi namuna hajmiga bog‘liq va HECH QACHON “yuqori” emas", () => {
  assert.equal(confidenceFor(3).level, "insufficient");
  assert.equal(confidenceFor(20).level, "low");
  assert.equal(confidenceFor(500).level, "moderate");
  // Kuzatuv tajriba emas — eng yuqori daraja "o'rtacha".
  assert.match(confidenceFor(500).note, /Sababiyat ISBOTLANMAGAN/);
});

test("natijalar bo‘yicha taqsimot to‘g‘ri yig‘iladi", () => {
  const observations: PatternObservation[] = [
    { strategyKey: "acknowledge_then_value", intentKey: "price_amount", objectionKind: "PRICE", stage: "offer_sent", outcome: "payment_confirmed", conversationId: "c1" },
    { strategyKey: "acknowledge_then_value", intentKey: "price_amount", objectionKind: "PRICE", stage: "offer_sent", outcome: "dropoff", conversationId: "c2" },
    { strategyKey: "acknowledge_then_value", intentKey: "price_amount", objectionKind: "PRICE", stage: "offer_sent", outcome: "unknown", conversationId: "c2" },
  ];

  const [stats] = aggregatePatterns(observations, { observationWindowDays: 7 });
  assert.equal(stats.sampleN, 3);
  assert.equal(stats.conversationN, 2, "bitta suhbatning ikki kuzatuvi ikki mijoz emas");
  assert.equal(stats.paymentConfirmedN, 1);
  assert.equal(stats.unknownN, 1, "noma’lum natija YASHIRILMAYDI");
  assert.equal(stats.confidence, "insufficient");
});
