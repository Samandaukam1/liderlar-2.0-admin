import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isSuccessfulOutcome,
  isFunnelProgress,
  SALE_CONFIRMED_OUTCOMES,
  FUNNEL_PROGRESS_OUTCOMES,
  detectOutcome,
} from "../src/lib/sales/outcome.ts";
import type { DialogMessage } from "../src/lib/sales/dialog.ts";

const followupRunner = readFileSync("src/lib/sales/flow/followup-runner.ts", "utf8");
const engine = readFileSync("src/lib/sales/flow/engine.ts", "utf8");
const queueStore = readFileSync("src/lib/sales/queue/queue-store.ts", "utf8");
const miner = readFileSync("src/lib/sales/mining/miner.ts", "utf8");
const learningRun = readFileSync("src/lib/sales/mining/learning-run.ts", "utf8");

/* ==================== FOLLOW-UP: ATOMIK CLAIM ========================= */

test("follow-up YUBORISHDAN OLDIN atomik claim qiladi", () => {
  /*
   * 28-BAND. Ilgari runner `pending` ni o'qib, yuborib, keyin
   * `sent` qilardi. O'qish bilan yozish orasidagi oynada ikkinchi
   * cron ham o'sha yozuvni ko'rib, MIJOZGA IKKI MARTA bir xil
   * eslatma yuborardi.
   *
   * Claim `status = 'pending'` shartli UPDATE bo'lishi SHART:
   * shartsiz update poygani hal qilmaydi.
   */
  const claimIndex = followupRunner.indexOf('status: "claimed"');
  const sendIndex = followupRunner.indexOf("sendSalesMessage(");
  assert.ok(claimIndex > 0, "claim bor");
  assert.ok(sendIndex > 0, "yuborish bor");
  assert.ok(claimIndex < sendIndex, "CLAIM yuborishdan OLDIN bo‘lishi shart");

  // Shartli UPDATE: boshqa worker ulgurgan bo'lsa qator qaytmaydi.
  assert.match(followupRunner, /\.eq\("status",\s*"pending"\)/);
  assert.match(followupRunner, /claimed\.length === 0/);
});

test("claim bo‘shatish FAQAT o‘z tokeni bilan", () => {
  // Lease tugab ish boshqa workerga o'tgan bo'lsa, kechikkan
  // worker yangi holatni bosib yubormasligi kerak.
  assert.match(followupRunner, /\.eq\("claim_token",\s*claimToken\)/);
});

test("to‘lagan mijozga TO‘LOV ESLATMASI ketmaydi", () => {
  assert.match(followupRunner, /paymentConfirmed && isPaymentFollowup/);
  assert.match(followupRunner, /to‘lov tasdiqlangan/);
});

test("mijoz javob yozgan bo‘lsa eskirgan eslatma YUBORILMAYDI", () => {
  assert.match(followupRunner, /last_incoming_at/);
  assert.match(followupRunner, /eslatma eskirgan/);
});

test("yuborishdan oldin opt-out va inson nazorati QAYTA tekshiriladi", () => {
  assert.match(followupRunner, /human_required_at/);
  assert.match(followupRunner, /optedOut:/);
});

test("TIMEOUT “yuborildi” ham, “yuborilmadi” ham DEYILMAYDI", () => {
  /*
   * 29-BAND. Telegram xabarni qabul qilgan, lekin javob bizga
   * yetmagan bo'lishi mumkin. Ko'r-ko'rona qayta yuborish
   * mijozga ikki marta bir xil xabar borishiga olib keladi.
   */
  assert.match(followupRunner, /timeoutLike/);
  // Holat shartli yoziladi: timeout bo'lsa `unknown`, aks holda `failed`.
  assert.match(followupRunner, /timeoutLike \? "unknown" : "failed"/);
  assert.match(followupRunner, /qayta yuborilmadi/);
});

test("lease qaytarish faqat YETKAZILISHI aniq bo‘lmagan yozuvlarni tegmaydi", () => {
  // `delivery_state = 'pending'` sharti: `unknown` bo'lgan yozuv
  // avtomatik qayta yuborilmaydi.
  assert.match(followupRunner, /\.eq\("delivery_state",\s*"pending"\)/);
});

/* ==================== NAVBAT: XABAR YO'QOLMAYDI ======================= */

test("qulf band bo‘lganda xabar NAVBATGA tushadi, tashlanmaydi", () => {
  /*
   * 27-BAND. Ilgari `if (!token) return null;` turardi va
   * webhook 200 berardi — xabar jimgina yo'qolardi.
   */
  assert.match(engine, /if \(!token\) \{/);
  assert.match(engine, /enqueueJob\(\{/);
  assert.match(engine, /lock_busy|qulfi band/);
  assert.ok(
    !/if \(!token\) return null;\s*\n\s*try \{/.test(engine),
    "eski “jimgina tashlash” yo‘li qolmasin",
  );
});

test("takroriy Telegram update ikkinchi ish YARATMAYDI", () => {
  // Unikal indeks buzilishi (23505) XATO EMAS — u idempotentlik.
  assert.match(queueStore, /23505/);
  assert.match(queueStore, /duplicate: true/);
});

test("ish olish SHARTLI update bilan — ikki worker bir ishni olmaydi", () => {
  assert.match(queueStore, /\.eq\("status", candidate\.state\)/);
  assert.match(queueStore, /if \(!updated \|\| updated\.length === 0\) continue;/);
});

test("lease muddati o‘tgan ish qaytariladi", () => {
  assert.match(queueStore, /\.eq\("status", "claimed"\)/);
  assert.match(queueStore, /\.lt\("lease_expires_at"/);
});

/* ==================== MINER: HALOL QAMROV ============================= */

test("miner QAT'IY LIMIT ishlatmaydi — keyset sahifalash bor", () => {
  /*
   * 6-BAND: "Do NOT use a fixed LIMIT and claim everything was
   * processed."
   */
  assert.match(miner, /fetchConversationPage/);
  assert.match(miner, /last_message_at\.gt\./, "keyset sharti bor");
  assert.match(miner, /and\(last_message_at\.eq\./, "bir xil vaqtli qatorlar ham qamraladi");
});

test("miner N+1 so‘rov qilmaydi", () => {
  // Bir sahifadagi barcha suhbatning xabarlari BITTA so'rovda.
  assert.match(miner, /\.in\("conversation_id", \[\.\.\.conversationIds\]\)/);
});

test("miner butun tarixni XOTIRAGA OLMAYDI", () => {
  assert.match(miner, /MAX_MESSAGES_PER_CONVERSATION/);
  assert.match(miner, /timeBudget/);
});

test("kursor siljimasa sahifalash TO‘XTAYDI — cheksiz sikl yo‘q", () => {
  assert.match(miner, /cursorAdvanced/);
  assert.match(miner, /kursor siljimadi/);
});

test("xato batch yugurishni to‘xtatmaydi, lekin YASHIRILMAYDI", () => {
  assert.match(miner, /failedBatches\.push/);
  assert.match(miner, /evaluateCoverage/);
});

test("qazish natijasi HAR DOIM qoralama, avtomatik faollashmaydi", () => {
  /*
   * 43-BAND: "Full rebuild must not auto-activate results."
   */
  assert.match(learningRun, /status: "draft"/);
  assert.match(learningRun, /is_active: false/);
  assert.match(learningRun, /approved: false/);
  assert.ok(
    !/is_active: true[\s\S]{0,200}persistStyleDraft/.test(learningRun),
    "qoralama saqlashda faollashtirish yo‘q",
  );
});

test("hal qilingan ziddiyat keyingi yugurishda QAYTA OCHILMAYDI", () => {
  assert.match(learningRun, /=== "open"/);
});

test("avtomatik tasnif faqat BO‘SH turni to‘ldiradi", () => {
  // `.eq("fact_kind", "unclassified")` — odam qo'ygan tur
  // ustidan yozilmaydi.
  assert.match(learningRun, /\.eq\("fact_kind", "unclassified"\)/);
});

/* ==================== NATIJA SEMANTIKASI ============================== */

test("“to‘lov so‘raldi” SOTUV EMAS", () => {
  assert.equal(isSuccessfulOutcome("payment_requested"), false);
  assert.equal(isSuccessfulOutcome("application_sent"), false);
  assert.ok(!SALE_CONFIRMED_OUTCOMES.includes("payment_requested"));
  assert.ok(FUNNEL_PROGRESS_OUTCOMES.includes("payment_requested"));
});

test("mijozning “to‘ladim” matni SOTUV EMAS", () => {
  assert.equal(isSuccessfulOutcome("paid"), false);
});

test("faqat TASDIQLANGAN yakun sotuv", () => {
  assert.equal(isSuccessfulOutcome("completed"), true);
  assert.deepEqual([...SALE_CONFIRMED_OUTCOMES], ["completed"]);
});

test("voronka siljishi sotuvdan ALOHIDA sanaladi", () => {
  assert.equal(isFunnelProgress("payment_requested"), true);
  assert.equal(isFunnelProgress("completed"), true);
  assert.equal(isFunnelProgress("dropped"), false);
});

test("noma’lum natija NOMA’LUM bo‘lib qoladi", () => {
  const messages: DialogMessage[] = [
    {
      id: "m1",
      direction: "incoming",
      messageType: "text",
      text: "salom",
      sentAt: "2026-09-14T10:00:00.000Z",
    },
  ];
  const result = detectOutcome(messages, { now: new Date("2026-09-14T11:00:00.000Z") });
  assert.equal(result.outcome, "unknown");
  assert.equal(result.confident, false, "taxmin qilinmaydi");
});

/* ==================== MAXFIYLIK JONLI YO'LDA ========================== */

test("XOM ANKETA HAVOLASI outbound jurnalga yozilmaydi", () => {
  /*
   * 33-BAND. Mijoz TO'LIQ havolani oladi (aks holda xizmat
   * ishlamaydi), lekin jurnalda token qolmaydi.
   */
  assert.match(engine, /logBody: redactPii\(intakeLink\)\.text/);
  assert.match(engine, /body: input\.logBody \?\? input\.body/);
});

test("jonli yo‘lda xotiraga yoziladigan savol REDAKSIYADAN o‘tadi", () => {
  // 32-band: live inference path ham redaksiyalanadi.
  assert.match(engine, /redactPii\(input\.text\)\.text/);
});

test("uslub namunalari FAKT MANBAI emas", () => {
  /*
   * 38-BAND. Ilgari `patterns.map(p => p.responseExample)` ruxsat
   * etilgan raqamlar to'plamiga qo'shilardi — ya'ni bir yil oldingi
   * "38 ming" bugun ham "tasdiqlangan" bo'lib ko'rinardi.
   */
  const testChat = readFileSync("src/lib/sales/test-chat.ts", "utf8");
  assert.ok(
    !/allowedTexts = \[[\s\S]{0,200}patterns\.map/.test(testChat),
    "namunalar ruxsat etilgan raqam manbaiga qo‘shilmaydi",
  );
  assert.match(testChat, /verifiedFactTexts/);
});

/* ==================== YETKAZISH VA BOSQICH TARTIBI ==================== */

test("ANIQ yetkazish xatosida bosqich ORQAGA qaytariladi", () => {
  /*
   * 29-BAND. Bosqich yuborishdan oldin suriladi (avtorizatsiya
   * yangi bosqichni kutadi), lekin Telegram aniq xato qaytarsa
   * mijoz hech narsa olmagan — u hali eski bosqichda. Bosqichni
   * oldinga qoldirish suhbatni mijoz KO'RMAGAN holatga o'tkazardi.
   */
  assert.match(engine, /const allFailed = /);
  assert.match(engine, /bosqich .* qaytarildi|qaytarildi/);
  // Yetkazilmagan qadamga eslatma rejalashtirilmaydi.
  assert.match(engine, /allFailed && !isRePrompt/);
});

test("NOMA’LUM yetkazish qaytarilmaydi ham, qayta yuborilmaydi ham", () => {
  assert.match(engine, /anyUnknown/);
  assert.match(engine, /qayta yuborilmadi/);
});

test("siyosat rad etgani XATO deb sanalmaydi", () => {
  // Rollout o'chiq bo'lsa biz ATAYLAB jim qolamiz — bu yetkazish
  // xatosi emas va bosqichni qaytarmasligi kerak.
  assert.match(engine, /outcome !== "refused"/);
});

test("yuborish natijasi to‘rt holatga ajratilgan", () => {
  assert.match(engine, /export type SendOutcome = "sent" \| "refused" \| "failed" \| "unknown"/);
  assert.match(engine, /deliveryUnknown/);
});
