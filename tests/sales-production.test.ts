import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  detectObjections,
  mergeObjections,
  primaryObjection,
  OBJECTION_KINDS,
  OBJECTION_LABELS,
} from "../src/lib/sales/flow/objections.ts";
import { computeLeadScore } from "../src/lib/sales/flow/lead-score.ts";
import { detectOptOut, OPT_OUT_REPLY } from "../src/lib/sales/flow/optout.ts";
import {
  decideRollout,
  parseRollout,
  ROLLOUT_MODES,
  newRolloutBucket,
} from "../src/lib/sales/flow/rollout.ts";
import {
  buildFallback,
  isFillerMessage,
  MAX_FALLBACKS_BEFORE_HUMAN,
  FALLBACK_REASONS,
} from "../src/lib/sales/flow/fallback.ts";
import { detectHandoff, buildHandoffSummary } from "../src/lib/sales/flow/handoff.ts";
import { detectMinor, MINOR_GUIDANCE } from "../src/lib/sales/flow/minor.ts";
import { checkReplyQuality, buildCorrectionInstruction } from "../src/lib/sales/flow/reply-quality.ts";
import { buildSalesContextBlock, needsSummary } from "../src/lib/sales/flow/sales-context.ts";
import { authorizeOutbound, type OutboundContext } from "../src/lib/sales/flow/outbound-guard.ts";

/* =================== 1. HECH QACHON JIM QOLMASLIK ====================== */

test("har bir jim qolish sababiga JAVOB matni bor", () => {
  // 3-band: model yiqilsa ham, bilim topilmasa ham mijoz javob oladi.
  for (const reason of FALLBACK_REASONS) {
    const fallback = buildFallback({ reason, stage: "offer_sent", previousFallbackCount: 0 });
    assert.ok(fallback.body.trim().length > 20, `${reason}: javob bo‘sh`);
  }
});

test("fallback matni FAKT o‘ylab topmaydi", () => {
  // Bilim yo'q bo'lgani uchun fallback ishlayapti — unda narx, muddat
  // yoki kafolat bo'lishi mantiqan mumkin emas.
  for (const reason of FALLBACK_REASONS) {
    for (let i = 0; i < 4; i += 1) {
      const { body } = buildFallback({ reason, stage: "new", previousFallbackCount: i });
      assert.ok(!/\d{4,}/.test(body), `${reason}: raqam bor — ${body}`);
      assert.ok(!/kafolat|albatta chiqa|100%/iu.test(body), `${reason}: kafolat bor`);
    }
  }
});

test("fallback TAKRORLANMAYDI — variantlar navbat bilan", () => {
  // Bir xil matn ikki marta kelsa, bu javob emas, avtojavob bo‘lib
  // ko‘rinadi va mijoz suhbatni tashlab ketadi.
  const first = buildFallback({ reason: "missing_knowledge", stage: "new", previousFallbackCount: 0 });
  const second = buildFallback({ reason: "missing_knowledge", stage: "new", previousFallbackCount: 1 });
  assert.notEqual(first.body, second.body);
});

test("uchinchi fallback’dan keyin odamga o‘tadi", () => {
  // "Tekshirib yozaman" ni cheksiz takrorlash aldashdan farq qilmaydi.
  const before = buildFallback({
    reason: "missing_knowledge",
    stage: "new",
    previousFallbackCount: MAX_FALLBACKS_BEFORE_HUMAN - 2,
  });
  assert.equal(before.requiresHuman, false);

  const at = buildFallback({
    reason: "missing_knowledge",
    stage: "new",
    previousFallbackCount: MAX_FALLBACKS_BEFORE_HUMAN - 1,
  });
  assert.equal(at.requiresHuman, true);
  assert.match(at.body, /hamkasbim/);
});

test("“xa”, “ok”, “hmm” javobsiz qoldirilmaydi", () => {
  for (const filler of ["xa", "ok", "hmm", "xo'p", "👍", "да", "+"]) {
    assert.equal(isFillerMessage(filler), true, filler);
  }
  // Mazmunli qisqa xabar filler EMAS — u bilim bazasiga borishi kerak.
  for (const real of ["narxi?", "qancha", "sertifikat", "qachon chiqadi"]) {
    assert.equal(isFillerMessage(real), false, real);
  }
});

/* ======================== 2. E'TIROZLAR ================================ */

test("“qimmat ekan” e’tiroz deb tanilади", () => {
  const found = detectObjections("38 ming qimmat ekan");
  assert.ok(found.some((o) => o.kind === "PRICE"));
});

test("bitta xabarda BIR NECHTA e’tiroz bo‘lishi mumkin", () => {
  const found = detectObjections("qimmat ekan, ishonchlimi o'zi? sertifikat ham berasizmi?");
  const kinds = found.map((o) => o.kind);
  assert.ok(kinds.includes("PRICE"));
  assert.ok(kinds.includes("TRUST"));
  assert.ok(kinds.includes("CERTIFICATE"));
});

test("e’tiroz bo‘lmasa BO‘SH ro‘yxat — “OTHER” o‘ylab topilmaydi", () => {
  assert.deepEqual(detectObjections("salom"), []);
  assert.deepEqual(detectObjections(""), []);
  assert.deepEqual(detectObjections(null), []);
});

test("eski e’tiroz saqlanadi", () => {
  // Mijoz narx haqida bir marta aytgan bo'lsa, keyin boshqa mavzuga
  // o'tsa ham o'sha e'tiroz suhbatning haqiqati bo'lib qoladi.
  const merged = mergeObjections(["PRICE"], detectObjections("ishonchlimi?"));
  assert.ok(merged.includes("PRICE"));
  assert.ok(merged.includes("TRUST"));
});

test("har e’tiroz turining yorlig‘i bor", () => {
  for (const kind of OBJECTION_KINDS) {
    assert.ok(OBJECTION_LABELS[kind], kind);
  }
});

test("eng muhim e’tiroz tanlanadi", () => {
  // Ishonchsizlik narxdan muhimroq: ishonmagan odam arzon bo'lsa ham
  // to'lamaydi.
  assert.equal(primaryObjection(["PRICE", "TRUST"]), "TRUST");
  assert.equal(primaryObjection(["CERTIFICATE", "PRICE"]), "PRICE");
  assert.equal(primaryObjection([]), null);
});

/* ======================= 3. LEAD HARORATI ============================== */

const baseScore = {
  stage: "new" as const,
  text: null,
  previousScore: 0,
  previousReasons: [] as string[],
  hasPaymentEvidence: false,
  unansweredFollowups: 0,
  optedOut: false,
};

test("narx so‘ragan mijoz isiydi va SABABI yoziladi", () => {
  const result = computeLeadScore({ ...baseScore, text: "narxi qancha?" });
  assert.ok(result.score > 0);
  assert.ok(result.reasons.some((r) => r.includes("narx")));
});

test("ball MIJOZGA ko‘rsatilmaydi — faqat sabablari bilan saqlanadi", () => {
  // Ball chatga chiqmasligini kod darajasida tekshiramiz: dvigatel
  // uni hech qanday yuboriladigan matnga qo'shmaydi.
  const engine = readFileSync("src/lib/sales/flow/engine.ts", "utf8");
  assert.ok(
    !/body:[^\n]*leadScore|body:[^\n]*lead_score/.test(engine),
    "ball xabar matniga qo‘shilmasin",
  );
});

test("anketa to‘ldirgan odam sovuq bo‘la olmaydi", () => {
  // Bosqich balli POL: salbiy signallar uni pastga tushirmaydi.
  const result = computeLeadScore({
    ...baseScore,
    stage: "intake_submitted",
    previousScore: 0,
    text: "hozir pulim yo'q",
  });
  assert.notEqual(result.temperature, "cold");
});

test("chek yuborgan mijoz to‘lovga tayyor", () => {
  const result = computeLeadScore({ ...baseScore, hasPaymentEvidence: true });
  assert.equal(result.temperature, "payment_ready");
});

test("opt-out qilgan mijoz sovuq va balli nol", () => {
  const result = computeLeadScore({ ...baseScore, stage: "intake_submitted", optedOut: true });
  assert.equal(result.temperature, "cold");
  assert.equal(result.score, 0);
});

test("bir sabab ikki marta ball bermaydi", () => {
  const once = computeLeadScore({ ...baseScore, text: "narxi qancha?" });
  const twice = computeLeadScore({
    ...baseScore,
    text: "narxi qancha?",
    previousScore: once.score,
    previousReasons: once.reasons,
  });
  assert.equal(twice.score, once.score);
});

/* ========================== 4. OPT-OUT ================================= */

test("“yozmang” aniq tanilади", () => {
  for (const text of [
    "boshqa yozmang",
    "bezovta qilmang",
    "meni tinch qo'ying",
    "stop",
    "не пишите",
  ]) {
    assert.equal(detectOptOut(text).optedOut, true, text);
  }
});

test("“kerak emas” opt-out EMAS", () => {
  // U ko'pincha taklifning o'ziga tegishli, aloqaga emas. Opt-out deb
  // o'qish suhbatni noo'rin tugatardi.
  assert.equal(detectOptOut("kerak emas").optedOut, false);
  assert.equal(detectOptOut("hozircha kerak emas").optedOut, false);
});

test("opt-out javobida SAVOL yo‘q", () => {
  // Savol javob kutadi, javob kutish esa aloqani davom ettirish degani.
  assert.ok(!OPT_OUT_REPLY.includes("?"));
  assert.match(OPT_OUT_REPLY, /uzr/i);
});

test("opt-out qilgan mijozga HECH NARSA yuborilmaydi", () => {
  const context: OutboundContext = {
    conversationId: "c1",
    businessConnectionId: "bc1",
    chatId: 1,
    stage: "offer_sent",
    expectedStages: [],
    kind: "template",
    templateKey: "x",
    body: "matn",
    autoReplyEnabled: true,
    aiEnabled: true,
    connectionEnabled: true,
    connectionCanReply: true,
    rollout: { mode: "full", allowlistChatIds: [], percentage: 100 },
    rolloutBucket: 0,
    optedOut: true,
  };
  const decision = authorizeOutbound(context);
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "opted_out");

  // Sinov rejimi ham chetlab o‘tolmaydi: sinov va jonli yo‘l bitta
  // funksiyadan o‘tadi.
  const simulated = authorizeOutbound({ ...context, simulated: true });
  assert.equal(simulated.allowed, false);
});

/* ========================== 5. ROLLOUT ================================= */

const rolloutBase = {
  chatId: 100,
  bucket: 5,
  simulated: false,
};

test("standart rejim — O‘CHIQ", () => {
  assert.equal(parseRollout(undefined).mode, "off");
  assert.equal(parseRollout({}).mode, "off");
  assert.equal(parseRollout({ mode: "nonsense" }).mode, "off");
  // Nosoz qiymat botni jim qoldiradi — noto'g'ri javobdan xavfsizroq.
  assert.equal(
    decideRollout({ settings: parseRollout(null), ...rolloutBase }).allowed,
    false,
  );
});

test("allowlist FAQAT ro‘yxatdagilarga javob beradi", () => {
  const settings = parseRollout({ mode: "allowlist", allowlistChatIds: ["100", "200"] });
  assert.equal(decideRollout({ settings, ...rolloutBase, chatId: 100 }).allowed, true);
  assert.equal(decideRollout({ settings, ...rolloutBase, chatId: 999 }).allowed, false);
});

test("foizli chiqarish BARQAROR — bir suhbat doim bir tomonda", () => {
  // Har xabarda tasodif olinsa, mijoz bir xabariga javob olib,
  // ikkinchisiga olmay qolardi.
  const settings = parseRollout({ mode: "percentage", percentage: 10 });
  for (let i = 0; i < 50; i += 1) {
    assert.equal(decideRollout({ settings, ...rolloutBase, bucket: 5 }).allowed, true);
    assert.equal(decideRollout({ settings, ...rolloutBase, bucket: 42 }).allowed, false);
  }
});

test("raqami yo‘q suhbat foizli qamrovga KIRMAYDI", () => {
  // "Noma'lum" ni "kiradi" deb o'qish foizni ma'nosiz qilardi.
  const settings = parseRollout({ mode: "percentage", percentage: 100 });
  assert.equal(decideRollout({ settings, ...rolloutBase, bucket: null }).allowed, false);
});

test("barqaror raqam 0–99 oralig‘ida", () => {
  for (let i = 0; i < 200; i += 1) {
    const bucket = newRolloutBucket();
    assert.ok(Number.isInteger(bucket) && bucket >= 0 && bucket <= 99);
  }
});

test("har rejimning yorlig‘i bor va off birinchi", () => {
  assert.equal(ROLLOUT_MODES[0], "off");
});

/* ====================== 6. ODAMGA O'TKAZISH ============================ */

test("odam so‘ralsa darhol o‘tkaziladi", () => {
  for (const text of ["operator bilan gaplashmoqchiman", "menejer chaqiring", "jonli odam"]) {
    assert.ok(detectHandoff(text), text);
  }
});

test("pul qaytarish va shikoyat AI’ga qoldirilmaydi", () => {
  assert.equal(detectHandoff("pulimni qaytaring")?.trigger, "refund_dispute");
  assert.equal(detectHandoff("shikoyat qilaman")?.trigger, "complaint");
  assert.equal(detectHandoff("sudga beraman")?.trigger, "legal");
});

test("oddiy savol o‘tkazishni qo‘zg‘atmaydi", () => {
  assert.equal(detectHandoff("narxi qancha?"), null);
  assert.equal(detectHandoff("sertifikat berasizmi?"), null);
});

test("xulosa KEYINGI QADAMNI aytadi", () => {
  // Holat tavsifining o'zi ishni bajarmaydi — koordinator nima
  // qilishini bilishi kerak.
  const summary = buildHandoffSummary({
    customerName: "Karimov Aziz",
    region: "Toshkent",
    stage: "waiting_payment",
    temperature: "payment_ready",
    objections: ["PRICE"],
    explained: ["price_offer"],
    lastCustomerQuestion: "kartaga o'tkazsam bo'ladimi?",
    trigger: "refund_dispute",
    paymentStatus: "evidence_received",
    intakeSubmitted: true,
  });
  assert.match(summary, /KARIMOV AZIZ|Karimov Aziz/);
  assert.match(summary, /Tavsiya:/);
  assert.match(summary, /chek kelgan/);
  assert.ok(summary.includes("kartaga o'tkazsam"));
});

/* ==================== 7. VOYAGA YETMAGANLAR =========================== */

test("maktab o‘quvchisi tanilади", () => {
  assert.equal(detectMinor("men 9-sinfda o'qiyman").isMinor, true);
  assert.equal(detectMinor("16 yoshdaman").isMinor, true);
  assert.equal(detectMinor("maktab o'quvchisiman").isMinor, true);
});

test("kattalar voyaga yetmagan deb belgilanmaydi", () => {
  assert.equal(detectMinor("25 yoshdaman").isMinor, false);
  assert.equal(detectMinor("salom").isMinor, false);
});

test("ko‘rsatmada ota-onadan yashirish TAQIQLANADI", () => {
  assert.match(MINOR_GUIDANCE, /yashirishga HECH QACHON undama/);
  assert.match(MINOR_GUIDANCE, /bosim/);
});

/* ====================== 8. JAVOB SIFATI ================================ */

const qualityBase = {
  unsupportedNumbers: [] as string[],
  discountApproved: true,
  paymentStatus: "none",
};

test("kafolat va’dalari BLOKLANADI", () => {
  const cases: Array<[string, string]> = [
    ["Google'da birinchi o'rinda chiqishingizni kafolatlaymiz", "guaranteed_ranking"],
    ["Wikipediyaga albatta qo'shib beramiz", "guaranteed_wikipedia"],
    ["Ko'k belgi albatta olasiz", "guaranteed_verification"],
    ["Grantni yutishingiz kafolatlanadi", "guaranteed_admission"],
  ];
  for (const [body, violation] of cases) {
    const result = checkReplyQuality({ ...qualityBase, body });
    assert.equal(result.ok, false, body);
    assert.ok(result.blocked.includes(violation as never), `${body} -> ${result.blocked}`);
  }
});

test("halol javob bloklanmaydi", () => {
  // Naqsh tor bo‘lishi kerak: “Google’da chiqishi mumkin” — rost gap.
  const ok = checkReplyQuality({
    ...qualityBase,
    body: "Maqola internetda ochiq bo‘ladi va qidiruv tizimlari uni ko‘rishi mumkin.",
  });
  assert.equal(ok.ok, true, `bloklandi: ${ok.blocked}`);
});

test("to‘qilgan chegirma bloklanadi, tasdiqlangani o‘tadi", () => {
  const invented = checkReplyQuality({
    ...qualityBase,
    discountApproved: false,
    body: "Siz uchun maxsus chegirma qilamiz.",
  });
  assert.equal(invented.ok, false);

  const approved = checkReplyQuality({
    ...qualityBase,
    discountApproved: true,
    body: "Hozirda chegirma amal qilmoqda.",
  });
  assert.equal(approved.ok, true);
});

test("to‘lov tasdiqlandi deyish faqat HAQIQATAN to‘langanda mumkin", () => {
  const lying = checkReplyQuality({
    ...qualityBase,
    paymentStatus: "evidence_received",
    body: "To‘lovingiz tasdiqlandi, rahmat!",
  });
  assert.equal(lying.ok, false);
  assert.ok(lying.blocked.includes("payment_confirmed_claim"));

  const truthful = checkReplyQuality({
    ...qualityBase,
    paymentStatus: "paid",
    body: "To‘lovingiz tasdiqlandi, rahmat!",
  });
  assert.equal(truthful.ok, true);
});

test("manbada yo‘q son javobni bloklaydi", () => {
  const result = checkReplyQuality({
    ...qualityBase,
    body: "Narxi 250 000 so‘m.",
    unsupportedNumbers: ["250000"],
  });
  assert.equal(result.ok, false);
});

test("o‘zini odam deb ko‘rsatish bloklanadi", () => {
  const result = checkReplyQuality({ ...qualityBase, body: "Men bot emasman, tirik odamman." });
  assert.equal(result.ok, false);
});

test("to‘qilgan shoshilinchlik ogohlantiradi", () => {
  const result = checkReplyQuality({ ...qualityBase, body: "Faqat bugun! Tezroq to‘lang!" });
  assert.ok(result.warnings.includes("fake_urgency") || result.blocked.includes("fake_urgency" as never));
});

test("tuzatish ko‘rsatmasi aniq taqiqlarni sanaydi", () => {
  const instruction = buildCorrectionInstruction(["guaranteed_ranking", "invented_discount"]);
  assert.match(instruction, /Kafolat berma/);
  assert.match(instruction, /chegirma o‘ylab topma/);
});

/* ======================= 9. SUHBAT XOTIRASI =========================== */

test("kontekst TAKRORLAMASLIKNI aniq aytadi", () => {
  // 12-band: anketa to'ldirgan odamdan anketa so'rash ishonchni
  // bir zumda yo'qotadi.
  const block = buildSalesContextBlock({
    customer: { fullName: "Aziz", region: null, telegramUsername: null, isMinor: false },
    conversation: {
      stage: "intake_submitted",
      summary: null,
      openQuestion: "qachon chiqadi?",
      pendingPromise: null,
      explained: ["price_offer"],
    },
    sales: { temperature: "hot", objections: ["PRICE"], lastCta: null, followupPending: false },
    transaction: {
      intakeSubmitted: true,
      intakeLinkSent: true,
      paymentStatus: "none",
      paymentEvidenceReceived: false,
    },
  });
  assert.match(block, /TO‘LDIRILGAN — qayta so‘rama/);
  assert.match(block, /ALLAQACHON TUSHUNTIRILGAN/);
  assert.match(block, /JAVOBSIZ SAVOLI/);
});

test("to‘langan mijozdan to‘lov so‘ralmaydi", () => {
  const block = buildSalesContextBlock({
    customer: { fullName: null, region: null, telegramUsername: null, isMinor: false },
    conversation: { stage: "paid", summary: null, openQuestion: null, pendingPromise: null, explained: [] },
    sales: { temperature: "payment_ready", objections: [], lastCta: null, followupPending: false },
    transaction: {
      intakeSubmitted: true,
      intakeLinkSent: true,
      paymentStatus: "paid",
      paymentEvidenceReceived: true,
    },
  });
  assert.match(block, /to‘lov so‘rama/);
});

test("chek kelgan, lekin tasdiqlanmagan holat ANIQ aytiladi", () => {
  const block = buildSalesContextBlock({
    customer: { fullName: null, region: null, telegramUsername: null, isMinor: false },
    conversation: { stage: "payment_review", summary: null, openQuestion: null, pendingPromise: null, explained: [] },
    sales: { temperature: "payment_ready", objections: [], lastCta: null, followupPending: false },
    transaction: {
      intakeSubmitted: true,
      intakeLinkSent: true,
      paymentStatus: "evidence_received",
      paymentEvidenceReceived: true,
    },
  });
  assert.match(block, /to‘landi deb ayta olmaysan/);
});

test("voyaga yetmagan mijozda ko‘rsatma qo‘shiladi", () => {
  const block = buildSalesContextBlock({
    customer: { fullName: null, region: null, telegramUsername: null, isMinor: true },
    conversation: { stage: "new", summary: null, openQuestion: null, pendingPromise: null, explained: [] },
    sales: { temperature: "cold", objections: [], lastCta: null, followupPending: false },
    transaction: {
      intakeSubmitted: false,
      intakeLinkSent: false,
      paymentStatus: "none",
      paymentEvidenceReceived: false,
    },
  });
  assert.ok(block.includes(MINOR_GUIDANCE));
});

test("uzun suhbat siqiladi, qisqasi siqilmaydi", () => {
  assert.equal(needsSummary({ totalMessages: 8, summarizedMessageCount: 0 }), false);
  assert.equal(needsSummary({ totalMessages: 40, summarizedMessageCount: 0 }), true);
  assert.equal(needsSummary({ totalMessages: 40, summarizedMessageCount: 36 }), false);
});
