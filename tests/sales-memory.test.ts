import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_MEMORY,
  applyMemoryUpdate,
  advancePaymentState,
  canAsk,
  parseMemory,
  alreadyExplained,
  isPaymentConfirmed,
  type ConversationMemory,
} from "../src/lib/sales/memory/conversation-memory.ts";
import {
  buildRollingSummary,
  missingCriticalKeys,
  needsSummary,
} from "../src/lib/sales/memory/rolling-summary.ts";
import { buildMemoryBlock } from "../src/lib/sales/memory/memory-block.ts";
import {
  decideGreeting,
  greetingInstruction,
  startsWithGreeting,
  stripGreeting,
  SESSION_GAP_HOURS,
} from "../src/lib/sales/flow/greeting-policy.ts";

const NOW = new Date("2026-09-14T12:00:00.000Z");

/* ==================== XOTIRA ========================================== */

test("javob berilgan mavzu ESLAB QOLINADI", () => {
  const memory = applyMemoryUpdate(EMPTY_MEMORY, {
    answeredTopic: "price_amount",
    now: NOW,
  });
  assert.ok(alreadyExplained(memory, "price_amount"));
  assert.ok(!alreadyExplained(memory, "certificate_availability"));
});

test("javobsiz savol SAQLANADI va javob berilganda o‘chadi", () => {
  let memory = applyMemoryUpdate(EMPTY_MEMORY, {
    pendingQuestion: {
      text: "sertifikat qachon keladi",
      askedAt: NOW.toISOString(),
      intentKey: "certificate_status",
    },
    now: NOW,
  });
  assert.equal(memory.pendingQuestions.length, 1);

  memory = applyMemoryUpdate(memory, {
    resolvedQuestionIntent: "certificate_status",
    now: NOW,
  });
  assert.equal(memory.pendingQuestions.length, 0, "javob berilgan savol ro‘yxatda qolmaydi");
});

test("bir savol IKKI MARTA javobsizlar ro‘yxatiga tushmaydi", () => {
  const question = {
    text: "narxi qancha",
    askedAt: NOW.toISOString(),
    intentKey: "price_amount",
  };
  let memory = applyMemoryUpdate(EMPTY_MEMORY, { pendingQuestion: question, now: NOW });
  memory = applyMemoryUpdate(memory, { pendingQuestion: question, now: NOW });
  assert.equal(memory.pendingQuestions.length, 1);
});

test("TASDIQLANGAN TO‘LOV hech qachon orqaga qaytmaydi", () => {
  /*
   * 26-BAND. Bu eng ko'p ishonch yo'qotadigan xato bo'lardi:
   * pul o'tkazgan mijozdan yana to'lov so'rash.
   */
  const confirmed = advancePaymentState("none", "confirmed", { authorized: true });
  assert.equal(confirmed, "confirmed");

  // Keyingi "chek keldi" signali holatni ORQAGA SURMAYDI.
  assert.equal(advancePaymentState(confirmed, "evidence_received"), "confirmed");
  assert.equal(advancePaymentState(confirmed, "requested"), "confirmed");
});

test("VAKOLATSIZ “confirmed” QABUL QILINMAYDI", () => {
  /*
   * 30-BAND: "to'ladim" matni ham, chek skrinshoti ham moliyaviy
   * tasdiq EMAS. Faqat vakolatli admin tasdiqlay oladi.
   */
  assert.equal(advancePaymentState("evidence_received", "confirmed"), "evidence_received");
  assert.equal(advancePaymentState("customer_claimed", "confirmed"), "customer_claimed");
});

test("to‘lov holati faqat OLDINGA siljiydi", () => {
  assert.equal(advancePaymentState("none", "requested"), "requested");
  assert.equal(advancePaymentState("evidence_received", "requested"), "evidence_received");
  assert.equal(advancePaymentState("requested", "customer_claimed"), "customer_claimed");
});

test("faqat `confirmed` haqiqiy to‘lov", () => {
  assert.equal(isPaymentConfirmed("confirmed"), true);
  assert.equal(isPaymentConfirmed("evidence_received"), false);
  assert.equal(isPaymentConfirmed("customer_claimed"), false);
  assert.equal(isPaymentConfirmed("under_review"), false);
});

test("QAYTA SO‘RASH TAQIQLARI ishlaydi", () => {
  const paid = applyMemoryUpdate(EMPTY_MEMORY, {
    paymentStatus: "confirmed",
    paymentAuthorized: true,
    fullName: "Sinov Nomzod",
    intakeStatus: "submitted",
    now: NOW,
  });

  assert.equal(canAsk(paid, "payment").allowed, false, "to‘lagan odamdan to‘lov so‘ralmaydi");
  assert.equal(canAsk(paid, "intake").allowed, false, "anketa to‘ldirgandan qayta so‘ralmaydi");
  assert.equal(canAsk(paid, "full_name").allowed, false, "ism ma’lum");
  assert.equal(canAsk(paid, "photo").allowed, true, "rasm hali kelmagan — so‘rash mumkin");
});

test("chek kelgan mijozdan ham to‘lov qayta so‘ralmaydi", () => {
  const memory = applyMemoryUpdate(EMPTY_MEMORY, {
    paymentStatus: "evidence_received",
    now: NOW,
  });
  assert.equal(canAsk(memory, "payment").allowed, false);
});

test("OPT-OUT va INSON NAZORATI faqat yoqiladi", () => {
  let memory = applyMemoryUpdate(EMPTY_MEMORY, { optOut: true, now: NOW });
  assert.equal(memory.optOut, true);
  // Keyingi yangilash uni O'CHIRA OLMAYDI — bu ataylab.
  memory = applyMemoryUpdate(memory, { leadTemperature: "hot", now: NOW });
  assert.equal(memory.optOut, true);
});

test("nosoz xotira javobni to‘xtatmaydi", () => {
  assert.deepEqual(parseMemory("buzuq").pendingQuestions, []);
  assert.equal(parseMemory(null).paymentStatus, "none");
  assert.equal(parseMemory({ paymentStatus: "yolg‘on" }).paymentStatus, "none");
});

/* ==================== AYLANMA XULOSA ================================== */

function richMemory(): ConversationMemory {
  return applyMemoryUpdate(EMPTY_MEMORY, {
    customerGoal: "maqola chiqarmoqchi",
    paymentStatus: "confirmed",
    paymentAuthorized: true,
    intakeStatus: "submitted",
    optOut: true,
    humanTakeover: true,
    pendingQuestion: {
      text: "sertifikat qachon",
      askedAt: NOW.toISOString(),
      intentKey: "certificate_status",
    },
    promise: { text: "rasmni qayta ko‘ramiz", promisedAt: NOW.toISOString(), fulfilled: false, dueAt: null },
    followupPreference: "ishdan keyin",
    publicationStatus: "on_hold",
    supportStatus: "open",
    lastCta: "anketani to‘ldiring",
    now: NOW,
  });
}

test("XULOSA kritik holatlarning BIRORTASINI yo‘qotmaydi", () => {
  /*
   * 25-BAND. Xulosa siqadi, lekin quyidagilar YO'QOLMASLIGI shart:
   * to'lov, opt-out, shikoyat, so'ralgan vaqt, javobsiz savol,
   * va'da, nashr to'xtatilishi, insonga o'tkazish va oxirgi CTA.
   */
  const memory = richMemory();
  const summary = buildRollingSummary({
    memory,
    summarizedMessageCount: 0,
    totalMessages: 60,
  });

  assert.deepEqual(missingCriticalKeys(memory, summary), [], "hech bir kritik holat yo‘qolmadi");
});

test("XULOSA FAKT TO‘QIMAYDI — faqat xotiradagi qiymat chiqadi", () => {
  const summary = buildRollingSummary({
    memory: EMPTY_MEMORY,
    summarizedMessageCount: 0,
    totalMessages: 30,
  });
  // Bo'sh xotirada "mijoz qiziqqan" kabi taxminiy gap paydo bo'lmasin.
  assert.ok(!/qiziq|ehtimol|ko‘rinadi|taxmin/i.test(summary.text));
  // To'lov holati esa HAR DOIM yoziladi.
  assert.match(summary.text, /To‘lov holati/);
});

test("tasdiqlangan to‘lov xulosada ALOHIDA ogohlantirish beradi", () => {
  const summary = buildRollingSummary({
    memory: richMemory(),
    summarizedMessageCount: 0,
    totalMessages: 60,
  });
  assert.match(summary.text, /TASDIQLANGAN/);
  assert.match(summary.text, /qayta to‘lov so‘ralmaydi/);
});

test("qisqa suhbatga xulosa kerak emas", () => {
  assert.equal(needsSummary({ totalMessages: 8, summarizedMessageCount: 0 }), false);
  assert.equal(needsSummary({ totalMessages: 40, summarizedMessageCount: 0 }), true);
  // Yaqinda siqilgan bo'lsa qayta siqilmaydi.
  assert.equal(needsSummary({ totalMessages: 40, summarizedMessageCount: 36 }), false);
});

/* ==================== KONTEKST BLOKI ================================== */

test("kontekst bloki QAYTA SO‘RASH TAQIQLARINI ochiq yozadi", () => {
  const block = buildMemoryBlock({
    memory: richMemory(),
    stage: "paid",
    summary: null,
    greetingInstruction: "Bu suhbat DAVOM ETYAPTI — qayta salomlashma.",
  });

  assert.match(block, /QAYTA SO‘RAMA/);
  assert.match(block, /to‘lov so‘rash/);
  assert.match(block, /anketa so‘rash/);
  assert.match(block, /JAVOBSIZ SAVOLLAR/);
  assert.match(block, /BAJARILMAGAN VA’DALAR/);
  assert.match(block, /TO‘XTATILGAN/);
});

/* ==================== SALOMLASHISH ==================================== */

test("birinchi murojaatda SALOMLASHADI", () => {
  const decision = decideGreeting(
    { greetedAt: null, sessionStartedAt: null, lastCustomerMessageAt: null },
    NOW,
  );
  assert.equal(decision.shouldGreet, true);
});

test("DAVOM ETAYOTGAN suhbatda QAYTA SALOMLASHMAYDI", () => {
  /*
   * AUDIT: bot jurnalidagi ketma-ket BESH javobning hammasi
   * salom bilan boshlangan.
   */
  const decision = decideGreeting(
    {
      greetedAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
      sessionStartedAt: null,
      lastCustomerMessageAt: null,
    },
    NOW,
  );
  assert.equal(decision.shouldGreet, false);
  assert.match(greetingInstruction(decision, null), /qayta salomlashma/i);
});

test("uzoq tanaffusdan keyin sessiya yangilanadi", () => {
  const decision = decideGreeting(
    {
      greetedAt: new Date(NOW.getTime() - (SESSION_GAP_HOURS + 1) * 3600 * 1000).toISOString(),
      sessionStartedAt: null,
      lastCustomerMessageAt: null,
    },
    NOW,
  );
  assert.equal(decision.shouldGreet, true);
  assert.equal(decision.sessionReset, true);
});

test("salomlashish faqat BOSHIDA tanilади", () => {
  assert.ok(startsWithGreeting("Assalomu alaykum! Narxi 38 000 so‘m."));
  assert.ok(startsWithGreeting("Salom, qanday yordam bera olaman?"));
  // Matn o'rtasidagi "salom" — salomlashish emas.
  assert.ok(!startsWithGreeting("Hamkasbingiz salom yo‘lladi."));
});

test("ortiqcha salom KESILADI, mazmun SAQLANADI", () => {
  const stripped = stripGreeting("Assalomu alaykum! Sertifikat ham taqdim etiladi.");
  assert.equal(stripped, "Sertifikat ham taqdim etiladi.");
  assert.ok(!startsWithGreeting(stripped));
});

test("faqat salomdan iborat javob YO‘Q QILINMAYDI", () => {
  // Bo'sh javob yuborishdan ko'ra salomni qoldirish yaxshiroq.
  const stripped = stripGreeting("Assalomu alaykum");
  assert.notEqual(stripped, "");
});
