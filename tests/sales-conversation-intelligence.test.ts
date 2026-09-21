import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyMessageIntent,
  EMPTY_INTENT_CONTEXT,
  pendingActionForStage,
  looksLikePersonName,
  isNoiseOnly,
  type IntentContext,
} from "../src/lib/sales/flow/message-intent.ts";
import { decideKnowledgeGap } from "../src/lib/sales/flow/knowledge-gap-gate.ts";
import { buildConversationalReply } from "../src/lib/sales/flow/conversational-reply.ts";
import {
  answerStatusQuestion,
  paymentStateFromColumn,
} from "../src/lib/sales/flow/status-answer.ts";
import {
  classifyHistoricalGap,
  QUEUE_CLASSIFICATIONS,
} from "../src/lib/sales/gaps/gap-classification.ts";
import { buildFallback } from "../src/lib/sales/flow/fallback.ts";
import { categoryForObject } from "../src/lib/sales/flow/case-escalation-rules.ts";
import { buildGapKey } from "../src/lib/sales/gaps/gap-key.ts";
import { tokenize } from "../src/lib/sales/retrieval.ts";

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function ctx(over: Partial<IntentContext> = {}): IntentContext {
  return { ...EMPTY_INTENT_CONTEXT, hasHistory: true, ...over };
}

/** Xabar bilim bazasiga BORMASLIGI kerak. */
function assertNotAQuestion(text: string, context = ctx()) {
  const result = classifyMessageIntent(text, context);
  assert.equal(
    result.needsKnowledge,
    false,
    `"${text}" bilim savoli deb topildi (${result.intent})`,
  );
  const gate = decideKnowledgeGap({
    intent: result,
    modelFoundNoKnowledge: true,
    text,
    answeredInConversation: false,
  });
  assert.equal(
    gate.decision,
    "none",
    `"${text}" javobsiz savollarga tushib ketdi (${gate.decision}: ${gate.reason})`,
  );
}

/* ===================================================================== *
 * A–E. ODDIY MULOQOT
 * ===================================================================== */

test("A. salomlashish javobsiz savol EMAS", () => {
  for (const text of [
    "Assalomu alaykum",
    "Assalomu aleykum",
    "Assalamu alaykum",
    "Assalomu alaykum yaxshimisiz",
    "Yaxshimisiz",
    "salom",
  ]) {
    assertNotAQuestion(text);
  }
});

test("B. minnatdorchilik javobsiz savol EMAS", () => {
  for (const text of [
    "Rahmat",
    "Raxmat",
    "Rahmat kattakon",
    "Raxmat kattakon",
    "Rahmat kottakon",
    "Aha rahmat",
    "Xop rahmat",
    "Hop rahmat",
  ]) {
    assertNotAQuestion(text);
  }
});

test("C. tan olish javobsiz savol EMAS", () => {
  for (const text of [
    "Hop",
    "Ho'p",
    "Aha hop",
    "Aha hup",
    "Aha xop",
    "Aha xo'p",
    "Axa",
    "Haa",
    "Tushunarli",
    "Aha tushunarli",
    "Maqul",
    "Bo'ldi",
    "Buldi",
    "Bulli",
    "Hozi",
    "Tanishdim",
    "Tanishib chiqdim",
    "Men tanishib chiqdim",
    "Tanishib chiqdm",
  ]) {
    assertNotAQuestion(text);
  }
});

test("D. tasdiq javobsiz savol EMAS", () => {
  for (const text of ["Ha", "Xa", "Mayli", "Albatta", "Roziman"]) {
    assertNotAQuestion(text);
  }
});

test("E. rad etish javobsiz savol EMAS", () => {
  for (const text of ["Yo'q", "Kerak emas", "Qiziqmayman"]) {
    assertNotAQuestion(text);
  }
});

/* ===================================================================== *
 * F–G. ISM
 * ===================================================================== */

test("F. F.I.Sh. so‘ralgandan keyingi ism — ANKETA MA’LUMOTI", () => {
  const context = ctx({ stage: "need_full_name", pendingUserAction: "send_full_name" });
  for (const name of [
    "Abdumajidova O‘g‘iloy Alisherovna",
    "Maxmatmurodova Shaxnoza Boysori qizi",
    "Maratova Gulruh Alisher qizi",
  ]) {
    const result = classifyMessageIntent(name, context);
    assert.equal(result.intent, "form_data", `"${name}" -> ${result.intent}`);
    assertNotAQuestion(name, context);
  }
});

test("G. kontekstsiz ism ham BILIM SAVOLI emas", () => {
  /*
   * 20-band: ismlar global bilim bazasiga umuman tushmasligi
   * kerak. Kontekst bo'lmasa ham u savolga aylanmaydi.
   */
  for (const name of [
    "Abdumajidova O‘g‘iloy Alisherovna",
    "Maratova Gulruh Alisher qizi",
  ]) {
    const result = classifyMessageIntent(name, ctx());
    assert.equal(result.intent, "identity_data");
    assertNotAQuestion(name);
  }
});

test("ism aniqlash SAVOLNI ism deb o‘qimaydi", () => {
  assert.equal(looksLikePersonName("Narxi qancha turadi"), false);
  assert.equal(looksLikePersonName("Maqola qachon chiqadi"), false);
  assert.equal(looksLikePersonName("Abdumajidova O‘g‘iloy Alisherovna"), true);
});

/* ===================================================================== *
 * H–J. KONTEKSTDAN HAL QILINADIGAN QISQA XABARLAR
 * ===================================================================== */

test("H. chek so‘ralgandan keyin rasm + «Mana» — CHEKKA ISHORA", () => {
  const result = classifyMessageIntent("Mana", ctx({
    stage: "waiting_payment",
    pendingUserAction: "send_payment_receipt",
    hasAttachment: true,
  }));
  assert.equal(result.intent, "payment_receipt_reference");
  assert.equal(result.referencedObject, "payment");
  assert.equal(result.needsKnowledge, false);
});

test("H2. chek javobida TO‘LOV TASDIQLANDI deyilmaydi", () => {
  /*
   * 18-band: chek kelgani — to'lov tasdig'i EMAS. Bu ikkisini
   * aralashtirish mijozga "to'lovingiz o'tdi" deb yolg'on
   * aytishga olib borardi.
   */
  const reply = buildConversationalReply({
    intent: "payment_receipt_reference",
    pendingUserAction: "send_payment_receipt",
    hasHistory: true,
    alreadyGreeted: true,
  });
  assert.ok(reply);
  assert.ok(!/tasdiqlandi|tasdiqlangan|o‘tdi|qabul qilindi va tasdiq/.test(reply));
  assert.match(reply, /tekshir/i);
});

test("I. anketa so‘ralgandan keyin «Yubordim» — BAJARDIM", () => {
  const result = classifyMessageIntent("Yubordim", ctx({
    stage: "waiting_intake",
    pendingUserAction: "submit_intake",
  }));
  assert.equal(result.intent, "action_confirmation");
  assert.equal(result.referencedObject, "intake");
  assertNotAQuestion("Yubordim", ctx({ stage: "waiting_intake", pendingUserAction: "submit_intake" }));
});

test("I2. to‘lov kutilayotganda «Yubordim» — CHEK", () => {
  const result = classifyMessageIntent("Yubordim", ctx({
    stage: "waiting_payment",
    pendingUserAction: "send_payment_receipt",
  }));
  assert.equal(result.intent, "payment_receipt_reference");
});

test("J. «Qildim», «Tashladim», «Tushdi» — BAJARDIM", () => {
  const context = ctx({ stage: "waiting_intake", pendingUserAction: "submit_intake" });
  for (const text of ["Qildim", "Tashladim", "Yubordm", "To'ldirdim"]) {
    const result = classifyMessageIntent(text, context);
    assert.ok(
      result.intent === "action_confirmation" || result.intent === "payment_receipt_reference",
      `"${text}" -> ${result.intent}`,
    );
    assertNotAQuestion(text, context);
  }
});

/* ===================================================================== *
 * K–M. KONTEKSTGA BOG'LIQ SAVOLLAR
 * ===================================================================== */

test("K. «Qancha?» — NARX SAVOLI, bilim kerak", () => {
  const result = classifyMessageIntent("Qancha?", ctx({ stage: "offer_sent" }));
  assert.equal(result.intent, "price_question");
  assert.equal(result.needsKnowledge, true);
  assert.equal(result.referencedObject, "price");
});

test("K2. narx savolining turli shakllari bir xil niyat beradi", () => {
  for (const text of ["Qancha turadi?", "Necha pul?", "Tolovi qancha", "Narxi?", "narxi qancha"]) {
    const result = classifyMessageIntent(text, ctx());
    assert.equal(result.intent, "price_question", `"${text}" -> ${result.intent}`);
  }
});

test("L. «Bo‘ldimi?» — HOLAT SAVOLI, bilim bazasiga BORMAYDI", () => {
  const result = classifyMessageIntent("Boldimi?", ctx({ stage: "intake_link_sent" }));
  assert.equal(result.intent, "status_question");
  assert.equal(result.needsKnowledge, false, "holat savoli global bilimga yuborilyapti");
  assert.equal(result.needsSystemState, true);
});

test("L2. holat savoli BILIM BO‘SHLIG‘I emas, TOPSHIRIQ", () => {
  const result = classifyMessageIntent("Maqolam tayyor bo‘ldimi?", ctx());
  const gate = decideKnowledgeGap({
    intent: result,
    modelFoundNoKnowledge: true,
    text: "Maqolam tayyor bo‘ldimi?",
    answeredInConversation: false,
  });
  assert.equal(gate.decision, "case_escalation");
  assert.equal(categoryForObject(result.referencedObject), "article_status");
});

test("M. «Endi nima qilishim kerak?» — keyingi qadam", () => {
  for (const text of ["Endi nima qilishim kerak?", "Keyinchi?", "Endi?"]) {
    const result = classifyMessageIntent(text, ctx({ stage: "offer_sent" }));
    assert.equal(result.intent, "continuation", `"${text}" -> ${result.intent}`);
    assertNotAQuestion(text, ctx({ stage: "offer_sent" }));
  }
});

/* ===================================================================== *
 * N–Q. SHOVQIN, KIRILL, IMLO
 * ===================================================================== */

test("N. faqat tinish belgisi — bilim bo‘shlig‘i EMAS", () => {
  for (const text of [".", "..", "?", "??", "!!!"]) {
    assert.equal(isNoiseOnly(text), true, `"${text}" shovqin deb tanilmadi`);
    assertNotAQuestion(text);
  }
});

test("N2. «?» kontekstda ANIQLASHTIRISH deb o‘qiladi", () => {
  const result = classifyMessageIntent("?", ctx({ hasHistory: true }));
  assert.equal(result.intent, "clarification");
});

test("O. faqat emoji — bilim bo‘shlig‘i EMAS", () => {
  for (const text of ["👍", "🙏", "😊😊"]) {
    assertNotAQuestion(text);
  }
});

test("P. KIRILL yozuv ham taniladi", () => {
  for (const text of [
    "хоп",
    "рахмат",
    "танишиб чикдим",
    "Тушунарли",
    "Юбордим",
    "ага хоп рахмат",
    "Хоп рахмат",
    "хоп булади",
  ]) {
    assertNotAQuestion(text);
  }
});

test("Q. imlo variantlari bir xil niyatga tushadi", () => {
  const variants = ["hop", "xop", "xo'p", "ho'p", "hup", "xup"];
  for (const text of variants) {
    const result = classifyMessageIntent(text, ctx());
    assert.ok(
      result.intent === "acknowledgement" || result.intent === "affirmation",
      `"${text}" -> ${result.intent}`,
    );
  }
});

/* ===================================================================== *
 * R–U. HAQIQIY SAVOLLAR
 * ===================================================================== */

test("R+S. haqiqiy savol bilim bazasiga BORADI", () => {
  for (const text of [
    "Sertifikat xalqaro bazada tekshiriladimi?",
    "Ensiklopediyaga kim qabul qilinadi?",
    "Qanday hujjat kerak?",
    "Maqola qanday yoziladi",
  ]) {
    const result = classifyMessageIntent(text, ctx());
    assert.equal(result.needsKnowledge, true, `"${text}" -> ${result.intent}`);
  }
});

test("T. javobi topilmagan haqiqiy savol BO‘SHLIQQA yoziladi", () => {
  const text = "Sertifikat xalqaro bazada tekshiriladimi?";
  const result = classifyMessageIntent(text, ctx());
  const gate = decideKnowledgeGap({
    intent: result,
    modelFoundNoKnowledge: true,
    text,
    answeredInConversation: false,
  });
  assert.equal(gate.decision, "knowledge_gap");
});

test("T2. bilim TOPILGAN bo‘lsa bo‘shliq yozilmaydi", () => {
  const text = "Sertifikat xalqaro bazada tekshiriladimi?";
  const gate = decideKnowledgeGap({
    intent: classifyMessageIntent(text, ctx()),
    modelFoundNoKnowledge: false,
    text,
    answeredInConversation: false,
  });
  assert.equal(gate.decision, "none");
});

test("T3. javob SUHBATDA berilgan bo‘lsa bo‘shliq yozilmaydi", () => {
  const text = "Sertifikat xalqaro bazada tekshiriladimi?";
  const gate = decideKnowledgeGap({
    intent: classifyMessageIntent(text, ctx()),
    modelFoundNoKnowledge: true,
    text,
    answeredInConversation: true,
  });
  assert.equal(gate.decision, "none");
});

test("U. shaxsiy holat — topshiriq, bilim emas", () => {
  for (const [text, expected] of [
    ["To‘lovim tushdimi?", "payment_check"],
    ["Maqolam tayyormi?", "article_status"],
    ["Anketam qabul bo‘ldimi?", "application_status"],
  ] as const) {
    const result = classifyMessageIntent(text, ctx());
    const gate = decideKnowledgeGap({
      intent: result,
      modelFoundNoKnowledge: true,
      text,
      answeredInConversation: false,
    });
    assert.equal(gate.decision, "case_escalation", `"${text}" -> ${gate.decision}`);
    assert.equal(categoryForObject(result.referencedObject), expected, `"${text}"`);
  }
});

/* ===================================================================== *
 * V. SHAXSIY JAVOB GLOBAL BILIMGA TUSHMAYDI
 * ===================================================================== */

test("V. shaxsiy holat javobi bilim bazasiga QO‘SHILMAYDI", () => {
  /*
   * 8-band. Taqiq KODDA bo'lishi shart: tugmani yashirish
   * yetarli emas, chunki server amali to'g'ridan-to'g'ri
   * chaqirilishi mumkin.
   */
  const actions = src("src/lib/actions/sales.ts");
  assert.match(actions, /gap\.kind === "case"/);
  assert.match(actions, /select\("id, question, status, kind, classification"\)/);

  const page = src("src/app/(admin)/ai-sotuv/savollar/page.tsx");
  assert.match(page, /!isCase/, "panel shaxsiy holatga javob formasini ko‘rsatyapti");
});

/* ===================================================================== *
 * W–Y. KONTEKST
 * ===================================================================== */

test("W. dvigatel javobdan OLDIN suhbat tarixini yuklaydi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /loadRecentHistory\(/);
  assert.match(engine, /buildRollingSummary|rolling-summary/);
  assert.match(engine, /classifyMessageIntent\(/);
});

test("X. mavzu almashsa savol o‘z niyatini oladi", () => {
  /*
   * To'lov haqida gaplashilgan bo'lsa ham, sertifikat savoli
   * to'lov konteksti bilan bo'yalib ketmasligi kerak.
   */
  const result = classifyMessageIntent(
    "Sertifikatni qayerdan olaman?",
    ctx({ stage: "waiting_payment", pendingUserAction: "send_payment_receipt" }),
  );
  assert.equal(result.needsKnowledge, true);
  assert.notEqual(result.referencedObject, "payment");
});

test("Y. eskirgan kontekst qisqa xabarni noto‘g‘ri bog‘lamaydi", () => {
  // Kutilayotgan harakat yo'q — "Mana" past ishonch bilan qoladi.
  const result = classifyMessageIntent("Mana", ctx({ stage: "new" }));
  assert.equal(result.confidence, "low");
  assert.equal(result.referencedObject, "none");
});

/* ===================================================================== *
 * Z–AC. BIRIKMA VA HOLAT
 * ===================================================================== */

test("Z. biriktirma bor bo‘lsa niyat shunga ishora qiladi", () => {
  const result = classifyMessageIntent("", ctx({
    hasAttachment: true,
    stage: "need_full_name",
    pendingUserAction: "send_full_name",
  }));
  assert.equal(result.intent, "attachment_reference");
});

test("AA. chek kelgan, lekin TASDIQLANMAGAN", () => {
  const answer = answerStatusQuestion("payment", {
    payment: "evidence_received",
    intakeCreated: true,
    intake: "submitted",
  });
  assert.ok(answer.answer);
  assert.ok(!/tasdiqlangan/.test(answer.answer), "tasdiqlanmagan to‘lov tasdiq deb aytilyapti");
  assert.match(answer.answer, /tekshiril/);
});

test("AA2. «to‘ladim» matni to‘lov tasdig‘i emas", () => {
  const answer = answerStatusQuestion("payment", {
    payment: "customer_claimed",
    intakeCreated: false,
    intake: "none",
  });
  assert.ok(answer.answer);
  assert.ok(!/tasdiqlangan/.test(answer.answer));
});

test("AA3. jadval va xotira lug‘atlari to‘g‘ri bog‘lanadi", () => {
  // 'paid' (ustun) va 'confirmed' (xotira) — bitta holat.
  assert.equal(paymentStateFromColumn("paid"), "confirmed");
  assert.equal(paymentStateFromColumn("evidence_received"), "evidence_received");
  assert.equal(paymentStateFromColumn(null), "none");
  assert.equal(paymentStateFromColumn("nomalum"), "none");
});

test("AB+AC. maqola holati TAXMIN QILINMAYDI", () => {
  /*
   * 11-band: maqola holati suhbat xotirasida turadi, xotira
   * esa modelning xulosasi bo'lishi mumkin. "Maqolangiz
   * chiqdi" deb aytish — o'ylab topilgan fakt.
   */
  const answer = answerStatusQuestion("article", {
    payment: "confirmed",
    intakeCreated: true,
    intake: "submitted",
  });
  assert.equal(answer.answer, null);
  assert.ok(answer.reason.length > 0);
});

/* ===================================================================== *
 * AD. TAKRORLAR
 * ===================================================================== */

test("AD. bir xil savol bitta qatorga yig‘iladi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /normalized_question/);
  assert.match(engine, /ask_count/);
  assert.match(engine, /buildGapKey\(question, intent\.intent\)/);
});

test("AD2. narx savolining barcha shakllari BITTA bo‘shliq", () => {
  /*
   * 29-band: ilgari "narxi qancha?", "qancha turadi?",
   * "necha pul?" uchta alohida qator bo'lardi va admin bitta
   * savolga uch marta javob yozishi kerak edi.
   */
  const keys = ["Narxi qancha?", "Qancha turadi?", "Necha pul?", "Tolovi qancha"].map((q) =>
    buildGapKey(q, classifyMessageIntent(q, ctx()).intent),
  );
  assert.equal(new Set(keys).size, 1, `birlashmadi: ${JSON.stringify(keys)}`);
});

test("AD3. TURLI savollar birlashib ketmaydi", () => {
  const a = buildGapKey("Sertifikat xalqaro bazada tekshiriladimi?", "knowledge_question");
  const b = buildGapKey("Ensiklopediyaga kim qabul qilinadi?", "knowledge_question");
  assert.notEqual(a, b);
});

test("AD4. tinish belgisi va so‘z tartibi kalitni bo‘lmaydi", () => {
  assert.equal(
    buildGapKey("Maqola narxi qancha", "knowledge_question"),
    buildGapKey("qancha maqola narxi?", "knowledge_question"),
  );
});

/* ===================================================================== *
 * AE–AF. POYGA VA TAKROR
 * ===================================================================== */

test("AE+AF. suhbat qulfi va navbat saqlanib qolgan", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /claimConversation/);
  assert.match(engine, /releaseConversation/);
  assert.match(engine, /enqueueJob/);
});

/* ===================================================================== *
 * AG–AH. ODAM TOPSHIRIG'I
 * ===================================================================== */

test("AG. topshiriq yaratilganda VA’DA beriladi", () => {
  const fallback = buildFallback({
    reason: "missing_knowledge",
    stage: "offer_sent",
    previousFallbackCount: 0,
    escalated: true,
  });
  assert.match(fallback.body, /yo‘naltirdim/);
});

test("AH. topshiriq YARATILMAGANDA va’da berilmaydi", () => {
  /*
   * 12-band — eng muhim halollik qoidasi. Ilgari bot har
   * holatda "tekshirib xabar beraman" derdi va orqada hech
   * narsa yaratilmasdi.
   */
  const fallback = buildFallback({
    reason: "missing_knowledge",
    stage: "offer_sent",
    previousFallbackCount: 0,
    escalated: false,
  });
  assert.ok(
    !/xabar beraman|yozib yuboraman|yo‘naltirdim|xabar beramiz/.test(fallback.body),
    `va'da berilib qolgan: ${fallback.body}`,
  );
});

test("AH2. standart holat — va’dasiz", () => {
  // `escalated` berilmasa, va'da BERILMAYDI.
  const fallback = buildFallback({
    reason: "missing_knowledge",
    stage: "offer_sent",
    previousFallbackCount: 0,
  });
  assert.ok(!/yo‘naltirdim/.test(fallback.body));
});

test("AG2. dvigatel va’dani topshiriq natijasiga BOG‘LAYDI", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /sendFallback\(context, "missing_knowledge", gap\.escalated\)/);
  assert.match(engine, /escalation\.created[\s\S]{0,120}escalationAcknowledgement/);
});

/* ===================================================================== *
 * AI–AJ. SOZLAMA VA QAMROV
 * ===================================================================== */

test("AI+AJ. avto-javob va qamrov darvozasi joyida", () => {
  const guard = src("src/lib/sales/flow/outbound-guard.ts");
  assert.match(guard, /auto_reply_disabled/);
  assert.match(guard, /decideRollout/);
});

/* ===================================================================== *
 * AK–AL. FAKT VA VA'DA
 * ===================================================================== */

test("AK. fallback matnlarida FAKT yo‘q", () => {
  for (const reason of ["missing_knowledge", "unsupported_numbers", "generation_failed"] as const) {
    for (const escalated of [true, false]) {
      const body = buildFallback({
        reason,
        stage: "offer_sent",
        previousFallbackCount: 0,
        escalated,
      }).body;
      assert.ok(!/\d{2,}/.test(body), `${reason}: matnda raqam bor — ${body}`);
      assert.ok(!/so‘m|som\b/.test(body), `${reason}: matnda narx bor`);
    }
  }
});

test("AL. promt modelga kelajakdagi va’dani TAQIQLAYDI", () => {
  const prompt = src("src/lib/sales/test-chat-prompt.ts");
  assert.match(prompt, /va’dani O‘ZING berma/);
});

/* ===================================================================== *
 * TARIXIY TOZALASH
 * ===================================================================== */

test("tarixiy axlat navbatdan chiqadi", () => {
  const garbage = [
    "Hop", "Assalomu alaykum", "Rahmat", "Tanishib chiqdim", "Aha hop",
    "Raxmat", ".", "Maqul", "хоп", "Ho’p", "рахмат", "Tanishdim",
    "Xop rahmat", "Tushunarli", "Axa", "??", "Qildim", "Юбордим",
    "Bulli", "Тушунарли", "хоп булади", "Tashladim",
    "Abdumajidova O‘g‘iloy Alisherovna",
  ];

  for (const text of garbage) {
    const verdict = classifyHistoricalGap(text);
    assert.equal(
      QUEUE_CLASSIFICATIONS.includes(verdict.classification),
      false,
      `"${text}" navbatda qolyapti (${verdict.classification})`,
    );
    assert.equal(verdict.archive, true, `"${text}" arxivlanmadi`);
  }
});

test("haqiqiy savol tozalashda YO‘QOLMAYDI", () => {
  for (const text of [
    "Sertifikat xalqaro bazada tekshiriladimi?",
    "Narxi qancha?",
    "Ensiklopediyaga kim qabul qilinadi?",
  ]) {
    const verdict = classifyHistoricalGap(text);
    assert.equal(verdict.classification, "real_knowledge_gap", `"${text}"`);
    assert.equal(verdict.archive, false);
  }
});

test("shubhali yozuv O‘CHIRILMAYDI, ko‘rib chiqishga qoladi", () => {
  /*
   * 23-band: shubhada arxivlash arzon, haqiqiy savolni
   * yo'qotish qimmat.
   */
  const verdict = classifyHistoricalGap("falon pismadon narsa");
  assert.equal(verdict.classification, "unknown_review");
  assert.equal(verdict.archive, false);
});

test("tozalash QAYTARILADI va hech narsa o‘chirilmaydi", () => {
  const service = src("src/lib/sales/gaps/reclassify-service.ts");
  assert.match(service, /previous_status/);
  assert.match(service, /update\.status = "archived"/);
  assert.ok(!/\.delete\(\)/.test(service), "tozalash qator o‘chiryapti");

  const migration = src("supabase/migrations/20260921160000_conversation_intelligence.sql");
  assert.ok(!/drop table|truncate|delete from/i.test(migration), "migratsiya buzuvchi");
});

/* ===================================================================== *
 * BOSQICHDAN KUTILAYOTGAN HARAKAT
 * ===================================================================== */

test("bosqich kutilayotgan harakatni ANIQ beradi", () => {
  assert.equal(pendingActionForStage("need_full_name"), "send_full_name");
  assert.equal(pendingActionForStage("waiting_payment"), "send_payment_receipt");
  assert.equal(pendingActionForStage("waiting_intake"), "submit_intake");
  assert.equal(pendingActionForStage("offer_sent"), "review_offer");
  assert.equal(pendingActionForStage("article_decision"), "decide_article");
  assert.equal(pendingActionForStage("paid"), "none");
});

test("muloqot javobi VORONKANI QAYTA BOSHLAMAYDI", () => {
  /*
   * 19-band: mijoz anketani yuborganidan keyin "Assalomu
   * alaykum, sizga qanday yordam beray?" javobi uning
   * qadamini o'chirib tashlaydi.
   */
  const reply = buildConversationalReply({
    intent: "greeting",
    pendingUserAction: "send_payment_receipt",
    hasHistory: true,
    alreadyGreeted: true,
  });
  assert.ok(reply);
  assert.ok(!/qanday yordam/.test(reply), `voronka qayta boshlandi: ${reply}`);
  assert.match(reply, /chek/i);
});

test("shovqinga javob YOZILMAYDI, agar kutilayotgan qadam bo‘lmasa", () => {
  const reply = buildConversationalReply({
    intent: "spam_or_noise",
    pendingUserAction: "none",
    hasHistory: true,
    alreadyGreeted: true,
  });
  assert.equal(reply, null);
});

/* ===================================================================== *
 * BILIM QIDIRUVI — KIRILL (17- va 26-band)
 * ===================================================================== */

test("kirillda yozilgan savol lotin bilim bilan UCHRASHADI", () => {
  /*
   * Ilgari qidiruv transliteratsiya qilmasdi: "нарх" hech
   * qachon "narx" bilan mos kelmasdi va javob bor bo'lsa ham
   * topilmasdi.
   */
  const cyrillic = tokenize("нархи қанча");
  const latin = tokenize("narxi qancha");
  assert.ok(
    cyrillic.some((token) => latin.includes(token)),
    `umumiy so'z yo'q: ${JSON.stringify(cyrillic)} vs ${JSON.stringify(latin)}`,
  );
});

test("apostrof variantlari qidiruvda birlashadi", () => {
  const a = tokenize("to‘lov qanday");
  const b = tokenize("to'lov qanday");
  assert.deepEqual(a, b);
});

test("«Tanishib chiqdim» ga TAKROR eslatma qaytarilmaydi", () => {
  /*
   * Mijoz ko'rib chiqqanini aytdi. "Shartlar bilan tanishib
   * chiqqach ayting" degan javob botning uni o'qimaganini
   * ko'rsatadi — bu 9- va 25-banddagi aynan o'sha nosozlik.
   */
  const result = classifyMessageIntent("Tanishib chiqdim", ctx({
    stage: "offer_sent",
    pendingUserAction: "review_offer",
  }));
  assert.equal(result.intent, "confirmation");

  const reply = buildConversationalReply({
    intent: result.intent,
    pendingUserAction: "review_offer",
    hasHistory: true,
    alreadyGreeted: true,
  });
  assert.ok(reply);
  assert.ok(
    !/tanishib chiq/i.test(reply),
    `bot o‘zi so‘ragan narsani qayta so‘rayapti: ${reply}`,
  );
});

test("«ko‘rdim» to‘lov kutilayotganda CHEK deb o‘qilmaydi", () => {
  // "ko'rdim" — ko'rib chiqdim, chek yubordim EMAS.
  const result = classifyMessageIntent("Ko‘rdim", ctx({
    stage: "waiting_payment",
    pendingUserAction: "send_payment_receipt",
  }));
  assert.notEqual(result.intent, "payment_receipt_reference");
});
