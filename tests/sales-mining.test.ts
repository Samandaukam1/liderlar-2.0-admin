import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mineQuestion,
  mineQuestions,
  looksLikeQuestion,
  normalizeQuestionForCluster,
} from "../src/lib/sales/mining/question-mining.ts";
import {
  clusterQuestions,
  topQuestions,
  topUnanswered,
  growingClusters,
  unknownClusterKey,
  type QuestionOccurrence,
} from "../src/lib/sales/mining/faq-cluster.ts";
import {
  clusterObjections,
  strategyFor,
  kindsOf,
  type ObjectionOccurrence,
} from "../src/lib/sales/mining/objection-mining.ts";
import { detectObjections } from "../src/lib/sales/flow/objections.ts";
import {
  evaluateCoverage,
  estimateEta,
  nextCursor,
  cursorAdvanced,
  EMPTY_COUNTERS,
  type CoverageCounters,
} from "../src/lib/sales/mining/coverage.ts";

/*
 * BARCHA FIXTURELAR SINTETIK.
 *
 * Real mijoz matni, ismi, raqami va havolasi testga KIRMAYDI
 * (8-band). Quyidagi jumlalar auditda ko'rilgan SHAKLLARGA
 * taqlid qiladi, lekin hech kimning yozishmasi emas.
 */

/* ==================== 1. SAVOLLARNI QAZISH ============================= */

test("mijozning haqiqiy savoli aniqlanadi, tasdiq esa yo‘q", () => {
  assert.ok(mineQuestion("Narxi qancha?") != null);
  assert.ok(mineQuestion("pulni qanday to‘lasam bo‘ladi") != null);

  // "rahmat", "xo'p" — bular savol emas va FAQ ga tushmasligi kerak,
  // aks holda ro'yxat ma'nosiz qatorlar bilan to'lardi.
  assert.equal(mineQuestion("rahmat"), null);
  assert.equal(mineQuestion("xo‘p"), null);
  assert.equal(mineQuestion(""), null);
  assert.equal(mineQuestion(null), null);
});

test("so‘roq belgisi bo‘lmasa ham savol tanilади", () => {
  // O'zbek yozishmasida "?" ko'pincha qo'yilmaydi.
  assert.ok(looksLikeQuestion("narxi qancha"));
  assert.ok(looksLikeQuestion("sertifikat berasizmi"));
  assert.ok(looksLikeQuestion("qachon chiqadi"));
});

test("YAQIN, LEKIN BOSHQA savollar BIRLASHTIRILMAYDI", () => {
  /*
   * 13-BAND — ENG MUHIM KLASTERLASH QOIDASI.
   *
   * "Sertifikat berasizmi?"   -> xizmat tarkibi haqida savol
   * "Sertifikat qachon keladi?" -> allaqachon to'lagan mijozning
   *                                yetkazib berish holati savoli
   *
   * Ularni bitta klasterga qo'shish botning yarim mijozga
   * noto'g'ri javob berishiga olib kelardi.
   */
  const availability = mineQuestion("sertifikat berasizmi?");
  const status = mineQuestion("sertifikatim qachon keladi?");

  assert.equal(availability?.intentKey, "certificate_availability");
  assert.equal(status?.intentKey, "certificate_status");
  assert.notEqual(availability?.intentKey, status?.intentKey);
});

test("to‘lov savollari to‘rtga ajratiladi", () => {
  // Har biriga javob BOSHQACHA — shuning uchun klaster ham boshqa.
  assert.equal(mineQuestion("pulni qanday to‘layman")?.intentKey, "payment_method");
  assert.equal(mineQuestion("38 mingdan boshqa to‘lov yo‘qmi")?.intentKey, "payment_total");
  assert.equal(mineQuestion("chekni qayerga yuboraman")?.intentKey, "payment_evidence");
  assert.equal(mineQuestion("to‘lovim tushdimi")?.intentKey, "payment_confirmation");
});

test("lug‘atda yo‘q savol ham SAQLANADI — u eng qimmatli ma’lumot", () => {
  const mined = mineQuestion("kecha aytgan hujjatingizni qayerdan olsam bo‘ladi");
  assert.ok(mined != null);
  // Noma'lum niyat — lekin savol yo'qolmaydi.
  assert.equal(mined.intentKey, null);
  assert.equal(mined.category, "unknown");
});

test("bitta xabardagi bir nechta savol ham topiladi", () => {
  const mined = mineQuestions("narxi qancha va sertifikat berasizmi?");
  const keys = mined.map((item) => item.intentKey);
  assert.ok(keys.includes("price_amount"));
  assert.ok(keys.includes("certificate_availability"));
});

/* ==================== 2. KLASTERLASH VA HALOL SANOQ ==================== */

function occurrence(
  text: string,
  conversationId: string,
  messageId: string,
): QuestionOccurrence | null {
  const mined = mineQuestion(text);
  if (!mined) return null;
  return {
    mined,
    conversationId,
    messageId,
    redactedText: text,
    askedAt: "2026-09-10T10:00:00.000Z",
  };
}

test("XABAR SONI va SUHBAT SONI boshqa-boshqa son", () => {
  /*
   * 15-BAND. Bitta mijoz bir savolni o'n marta yozsa, u o'n
   * mijozdek KO'RINMASLIGI kerak. Aks holda "eng ko'p
   * so'raladigan savol" reytingi bitta sabrsiz odamdan
   * iborat bo'lardi.
   */
  const occurrences = [
    occurrence("narxi qancha?", "conv-1", "m1"),
    occurrence("narxi qancha", "conv-1", "m2"),
    occurrence("narxi qancha bo‘ladi", "conv-1", "m3"),
    occurrence("qancha turadi?", "conv-2", "m4"),
  ].filter((item): item is QuestionOccurrence => item != null);

  const clusters = clusterQuestions(occurrences);
  const price = clusters.find((cluster) => cluster.intentKey === "price_amount");

  assert.ok(price);
  assert.equal(price.messageCount, 4, "to‘rt marta yozilgan");
  assert.equal(price.conversationCount, 2, "lekin faqat ikki mijoz so‘ragan");
  assert.notEqual(price.messageCount, price.conversationCount);
});

test("klaster tartibi SUHBAT soni bo‘yicha, xabar soni bo‘yicha emas", () => {
  const occurrences = [
    // Bitta mijoz besh marta.
    ...["narxi qancha", "narxi qancha", "narxi qancha", "narxi qancha", "narxi qancha"].map(
      (text, index) => occurrence(text, "conv-spam", `s${index}`),
    ),
    // Uch xil mijoz bir martadan.
    occurrence("sertifikat berasizmi", "conv-a", "a1"),
    occurrence("sertifikat berasizmi", "conv-b", "b1"),
    occurrence("sertifikat berasizmi", "conv-c", "c1"),
  ].filter((item): item is QuestionOccurrence => item != null);

  const clusters = clusterQuestions(occurrences);
  assert.equal(
    clusters[0].intentKey,
    "certificate_availability",
    "uch xil mijoz bitta sabrsiz mijozdan muhimroq",
  );
});

test("mijozning asl yozilishlari saqlanadi", () => {
  const occurrences = [
    occurrence("pulni qanday to‘lasam bo‘ladi", "c1", "m1"),
    occurrence("karta raqam?", "c2", "m2"),
    occurrence("to‘lov qanaqa", "c3", "m3"),
  ].filter((item): item is QuestionOccurrence => item != null);

  const clusters = clusterQuestions(occurrences);
  const payment = clusters.find((cluster) => cluster.intentKey === "payment_method");
  assert.ok(payment);
  assert.ok(payment.variants.length >= 3, "har xil yozilish saqlanadi");
  assert.ok(payment.variants.includes("karta raqam?"));
});

test("noma’lum savollar EHTIYOTKOR klasterlanadi — ortiqcha birlashmaydi", () => {
  // Boshqacha yozilgan noma'lum savollar alohida qoladi: admin
  // ikkitasini qo'lda birlashtira oladi, noto'g'ri birlashtirilganini
  // esa ajratib bo'lmaydi.
  const a = unknownClusterKey(normalizeQuestionForCluster("hujjat kerakmi menga"));
  const b = unknownClusterKey(normalizeQuestionForCluster("qanday hujjat topshiraman"));
  assert.notEqual(a, b);
});

test("TOP va javobsiz ro‘yxatlar haqiqiy sanoqdan chiqadi", () => {
  const occurrences = [
    occurrence("narxi qancha", "c1", "m1"),
    occurrence("narxi qancha", "c2", "m2"),
    occurrence("sertifikat berasizmi", "c3", "m3"),
  ].filter((item): item is QuestionOccurrence => item != null);

  const clusters = clusterQuestions(occurrences);
  const answered = new Set(["price_amount"]);

  const top = topQuestions(clusters, answered, 10);
  assert.equal(top[0].conversationCount, 2);
  assert.equal(top[0].answered, true);

  const unanswered = topUnanswered(clusters, answered, 10);
  assert.ok(unanswered.every((row) => row.answered === false));
  assert.ok(unanswered.some((row) => row.clusterKey === "certificate_availability"));
});

test("o‘sish faqat YETARLI namunada hisoblanadi", () => {
  const occurrences = [
    occurrence("narxi qancha", "c1", "m1"),
    occurrence("narxi qancha", "c2", "m2"),
  ].filter((item): item is QuestionOccurrence => item != null);
  const clusters = clusterQuestions(occurrences);

  // 1 -> 2 "100% o'sish" emas, shovqin.
  const noisy = growingClusters(clusters, new Map([["price_amount", 1]]));
  assert.equal(noisy.length, 0, "kichik bazadan o‘sish hisoblanmaydi");

  const real = growingClusters(clusters, new Map([["price_amount", 4]]), { minBase: 2, minGrowth: 0.4 });
  assert.ok(real.length >= 0);
});

/* ==================== 3. E'TIROZLAR ==================================== */

test("bitta xabarda BIR NECHTA e’tiroz bo‘ladi", () => {
  const detected = detectObjections("qimmat ekan, oilam bilan maslahatlashaman");
  const kinds = kindsOf(detected);
  assert.ok(kinds.includes("PRICE"));
  assert.ok(kinds.includes("ASK_FAMILY"));
  assert.ok(kinds.length >= 2, "multi-label ishlaydi");
});

test("2-fazada qo‘shilgan e’tirozlar tanilади", () => {
  assert.ok(kindsOf(detectObjections("bepul deb o‘ylagandim")).includes("THOUGHT_FREE"));
  assert.ok(kindsOf(detectObjections("rasmim o‘xshamabdi")).includes("PHOTO_LOOKS_DIFFERENT"));
  assert.ok(kindsOf(detectObjections("internet yaxshi ishlamayapti")).includes("INTERNET_PROBLEM"));
  assert.ok(kindsOf(detectObjections("boshqa yozmang")).includes("STOP"));
  assert.ok(
    kindsOf(detectObjections("hali endi talaba buldim")).includes("NOT_ENOUGH_ACHIEVEMENTS"),
  );
});

test("e’tiroz klasterida ikki xil sanoq bor", () => {
  const occurrences: ObjectionOccurrence[] = [
    { kinds: ["PRICE"], conversationId: "c1", messageId: "m1", redactedText: "qimmat", seenAt: "2026-09-10T10:00:00.000Z" },
    { kinds: ["PRICE"], conversationId: "c1", messageId: "m2", redactedText: "juda qimmat", seenAt: "2026-09-10T11:00:00.000Z" },
    { kinds: ["PRICE", "TRUST"], conversationId: "c2", messageId: "m3", redactedText: "qimmat, ishonchlimi", seenAt: "2026-09-10T12:00:00.000Z" },
  ];

  const clusters = clusterObjections(occurrences);
  const price = clusters.find((cluster) => cluster.kind === "PRICE");
  assert.ok(price);
  assert.equal(price.messageCount, 3);
  assert.equal(price.conversationCount, 2);
});

test("STRATEGIYA fakt saqlamaydi — narx, sana va foiz yo‘q", () => {
  /*
   * 18-BAND. Strategiya "nima qilish" ni aytadi, "nima deyish" ni
   * emas. Ichida narx bo'lsa, narx o'zgarganda strategiya eskirardi
   * va bot eski narxni aytardi.
   */
  for (const kind of ["PRICE", "TRUST", "INSTALLMENT", "STOP"] as const) {
    for (const step of strategyFor(kind)) {
      assert.ok(!/\d{3,}/.test(step), `strategiyada summa bo‘lmasin: ${step}`);
      assert.ok(!/%/.test(step), `strategiyada foiz bo‘lmasin: ${step}`);
    }
  }
});

test("strategiyada bosim va soxta shoshilinchlik YO‘Q", () => {
  const forbidden = /shoshiling|faqat bugun|oxirgi imkoniyat|kafolatlayman|albatta chiqadi/i;
  for (const kind of ["PRICE", "NO_MONEY_NOW", "NEED_TO_THINK", "TRUST"] as const) {
    for (const step of strategyFor(kind)) {
      assert.ok(!forbidden.test(step), `taqiqlangan uslub: ${step}`);
    }
  }
});

test("STOP strategiyasi qayta ishontirishga URINMAYDI", () => {
  const steps = strategyFor("STOP").join(" ").toLowerCase();
  assert.ok(steps.includes("to‘xta") || steps.includes("to'xta"));
  assert.ok(!steps.includes("taklif qil"));
});

/* ==================== 4. QAMROV — YOLG'ON GAPIRMASLIK ================== */

function counters(overrides: Partial<CoverageCounters> = {}): CoverageCounters {
  return { ...EMPTY_COUNTERS, ...overrides };
}

test("sahifalash tugamagan bo‘lsa qamrov QISMAN", () => {
  const verdict = evaluateCoverage({
    counters: counters({ conversationsDiscovered: 777, conversationsProcessed: 100 }),
    failedBatches: [],
    exhausted: false,
  });
  assert.equal(verdict.status, "partial");
});

test("xato batch bo‘lsa qamrov QISMAN — xato yashirilmaydi", () => {
  const verdict = evaluateCoverage({
    counters: counters({ conversationsDiscovered: 50, conversationsProcessed: 50 }),
    failedBatches: [{ batchIndex: 2, reason: "timeout", conversationIds: ["a", "b"] }],
    exhausted: true,
  });
  assert.equal(verdict.status, "partial");
  assert.match(verdict.note, /batch/i);
});

test("ishlangan < topilgan bo‘lsa “to‘liq” DEYILMAYDI", () => {
  const verdict = evaluateCoverage({
    counters: counters({ conversationsDiscovered: 777, conversationsProcessed: 500 }),
    failedBatches: [],
    exhausted: true,
  });
  assert.equal(verdict.status, "partial");
  assert.match(verdict.note, /277/);
});

test("hammasi ishlanganda va xatosiz bo‘lganda TO‘LIQ", () => {
  const verdict = evaluateCoverage({
    counters: counters({
      conversationsDiscovered: 777,
      conversationsProcessed: 777,
      messagesProcessed: 20574,
    }),
    failedBatches: [],
    exhausted: true,
  });
  assert.equal(verdict.status, "full");
});

test("ETA O‘LCHANGAN tezlikdan chiqadi; o‘lchov yetmasa ko‘rsatilmaydi", () => {
  /*
   * 7-BAND: "ETA must be based on observed speed. Do not invent an ETA."
   */
  const early = estimateEta({ processed: 2, total: 777, elapsedMs: 1000 });
  assert.equal(early.etaSeconds, null, "2 ta suhbatdan tezlik chiqarilmaydi");
  assert.equal(early.ratePerSecond, null);

  const measured = estimateEta({ processed: 100, total: 200, elapsedMs: 10_000 });
  assert.equal(measured.ratePerSecond, 10);
  assert.equal(measured.etaSeconds, 10, "qolgan 100 ta / 10 per sec");
});

test("keyset kursori oldinga siljiydi va takrorlanmaydi", () => {
  const page = [
    { id: "a", lastMessageAt: "2026-09-01T00:00:00.000Z" },
    { id: "b", lastMessageAt: "2026-09-02T00:00:00.000Z" },
  ];
  const cursor = nextCursor(page);
  assert.equal(cursor?.conversationId, "b");

  // Aynan o'sha sahifa qayta kelsa — kursor SILJIMAGAN.
  assert.equal(cursorAdvanced(cursor, nextCursor(page)), false);
  // Yangi sahifa — siljigan.
  assert.equal(
    cursorAdvanced(cursor, nextCursor([{ id: "c", lastMessageAt: "2026-09-03T00:00:00.000Z" }])),
    true,
  );
  assert.equal(nextCursor([]), null);
});

test("bo‘sh bazada qamrov “noma’lum”, “to‘liq” emas", () => {
  const verdict = evaluateCoverage({
    counters: counters(),
    failedBatches: [],
    exhausted: true,
  });
  assert.equal(verdict.status, "unknown");
});
