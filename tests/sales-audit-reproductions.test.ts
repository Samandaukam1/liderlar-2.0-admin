import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyMessageIntent,
  looksLikePersonName,
  pendingActionForStage,
  type IntentContext,
} from "../src/lib/sales/flow/message-intent.ts";
import { decideKnowledgeGap } from "../src/lib/sales/flow/knowledge-gap-gate.ts";
import { buildConversationalReply } from "../src/lib/sales/flow/conversational-reply.ts";
import { isRepeatedReply } from "../src/lib/sales/flow/repeat-guard.ts";
import { classifyAttachment } from "../src/lib/sales/flow/attachment-intent.ts";
import { validateFullName } from "../src/lib/sales/flow/full-name.ts";
import { categoryForCancellation } from "../src/lib/sales/flow/case-escalation-rules.ts";
import type { SalesStage } from "../src/lib/sales/flow/stages.ts";

/*
 * AUDIT REPRODUKSIYALARI — ANONIM FIXTURELAR.
 *
 * Matnlar jonli suhbatlardan olingan XULQ namunalari; ism,
 * telefon, karta va havola YO'Q. Hech bir test Telegram'ga
 * chiqmaydi: bu yerda faqat sof modullar ishlaydi.
 */

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function turn(
  stage: SalesStage,
  over: Partial<IntentContext> = {},
  paymentRequired = true,
): IntentContext {
  return {
    stage,
    pendingUserAction: pendingActionForStage(stage, paymentRequired),
    hasAttachment: false,
    hasHistory: true,
    ...over,
  };
}

function gapFor(text: string, context: IntentContext) {
  const intent = classifyMessageIntent(text, context);
  return {
    intent,
    gate: decideKnowledgeGap({
      intent,
      modelFoundNoKnowledge: true,
      text,
      answeredInConversation: false,
    }),
  };
}

/* ===================================================================== *
 * A. MAQOLASI CHIQQAN MIJOZNING TUZATISH SO'ROVI
 * ===================================================================== */

test("A. tuzatish so‘rovi F.I.SH. deb yozilmaydi", () => {
  /*
   * Jonli xato: «shu joyi ai notori qib qoyibdi» panelda
   * F.I.Sh. bo‘lib saqlangan va shu nom bilan YANGI ANKETA
   * yaratilgan.
   */
  const text = "shu joyi ai notori qib qoyibdi";

  // Eski tekshiruv buni ism deb qabul qilardi — sabab shu.
  assert.equal(validateFullName(text).ok, true, "fixture eskirgan");

  assert.equal(looksLikePersonName(text), false, "hali ham ism deb qabul qilinyapti");
  const { intent } = gapFor(text, turn("need_full_name"));
  assert.notEqual(intent.intent, "form_data");
  assert.notEqual(intent.intent, "identity_data");
});

test("A2. anketa bor bo‘lsa YANGISI yaratilmaydi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /if \(conversation\.intakeId != null\)[\s\S]{0,400}?yangisi yaratilmadi/);
  assert.match(engine, /content_correction/);
});

test("A3. tasdiqlangan ism noaniq gap bilan almashtirilmaydi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /customer_full_name: conversation\.customerFullName \?\? name\.fullName/);
});

test("A4. bitta javob ketma-ket takrorlanmaydi", () => {
  /*
   * Jonli xato: bir xil mazmun to‘rt daqiqada YETTI marta
   * yuborilgan.
   */
  const body = "Havoladagi savollarga javob yozib yuboring va biz ko‘rib chiqamiz.";
  assert.equal(isRepeatedReply({ body, recentBodies: [body] }), true);
  assert.equal(isRepeatedReply({ body, recentBodies: [] }), false);
});

test("A5. HAVOLA bo‘lgan javob takror deb to‘silmaydi", () => {
  // Mijoz havolani qaytadan so‘rashi mumkin (6-band).
  const body = "Mana havola: https://liderlar.uz/anketa/xxx — to‘ldirib yuboring.";
  assert.equal(isRepeatedReply({ body, recentBodies: [body] }), false);
});

test("A6. burst bitta turn sifatida ko‘riladi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /hasNewerIncoming\(/);
  assert.match(engine, /yangiroq xabar bor/);
});

/* ===================================================================== *
 * B. IMTIYOZLI MIJOZDAN CHEK SO'RALGAN
 * ===================================================================== */

test("B. «Royxatdan o‘tdim endichi» ism sifatida yozilmaydi", () => {
  const text = "Royxatdan oʻtdim endichi";
  assert.equal(validateFullName(text).ok, true, "fixture eskirgan");
  assert.equal(looksLikePersonName(text), false);
});

test("B2. imtiyozli mijozga TO‘LOV ESLATMASI yubormaydi", () => {
  /*
   * Jonli xato: panelda «pul so‘ralmaydi» deb turgan mijozga
   * «To‘lov chekini shu yerga yuboring» degan xabar ketgan.
   * Shablonlar to‘silgan edi, bosqichdan kelib chiqadigan
   * eslatma esa to‘silmagan.
   */
  assert.equal(pendingActionForStage("waiting_payment", false), "none");
  assert.equal(pendingActionForStage("waiting_payment", true), "send_payment_receipt");

  const reply = buildConversationalReply({
    intent: "acknowledgement",
    pendingUserAction: "send_payment_receipt",
    hasHistory: true,
    alreadyGreeted: true,
    paymentRequired: false,
  });
  assert.ok(reply);
  assert.ok(!/chek|to‘lov|tolov/i.test(reply), `to‘lov so‘ralyapti: ${reply}`);
});

test("B3. imtiyozli mijoz TO‘LOV BOSQICHIGA o‘tmaydi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /const paymentRequired = conversation\.referralSource == null;/);
  assert.match(engine, /paymentRequired \? "waiting_payment" : "intake_submitted"/);
  assert.match(engine, /paymentRequired\s*\?\s*\{ payment_status: "requested" \}\s*:\s*\{\}/);
});

test("B4. «Ha toldirdim» CHEK deb o‘qilmaydi", () => {
  /*
   * Jonli xato: anketa topshirilgandan keyin «Ha toldirdim»
   * kelganda bot «Chek qabul qilindi» degan.
   *
   * "to‘ldirdim" — ANKETANI to‘ldirdim; "to‘ladim" — PUL
   * to‘ladim. Bir harf, butunlay boshqa ma’no.
   */
  const { intent } = gapFor("Ha toldirdim", turn("waiting_payment"));
  assert.notEqual(intent.intent, "payment_receipt_reference");
  assert.equal(intent.referencedObject, "intake");

  const reply = buildConversationalReply({
    intent: intent.intent,
    pendingUserAction: "send_payment_receipt",
    hasHistory: true,
    alreadyGreeted: true,
  });
  assert.ok(reply);
  assert.ok(!/chek qabul/i.test(reply), `soxta chek tasdig‘i: ${reply}`);
});

test("B5. «Xop» chek tasdig‘i emas", () => {
  const { intent } = gapFor("Xop", turn("waiting_payment"));
  assert.notEqual(intent.intent, "payment_receipt_reference");
});

test("B6. «Qanaqa chek» bilim bo‘shlig‘i emas", () => {
  const { intent, gate } = gapFor("Qanaqa chek", turn("waiting_payment"));
  assert.equal(intent.intent, "clarification");
  assert.equal(gate.decision, "none");
});

/* ===================================================================== *
 * C va D. TAVSIYA BILAN KELGAN MIJOZGA NARX YUBORILGAN
 * ===================================================================== */

test("C+D. tavsiya nomi, salom va ism turli tartibda kelsa ham ish to‘g‘ri", () => {
  /*
   * Jonli xato: mijoz «salom», «tavsiya», «tavsiya beruvchi
   * ismi» ni KETMA-KET uchta xabarda yuborgan. Bot
   * birinchisiga javoban butun onboardingni — narx bilan —
   * jo‘natgan; imtiyoz uchinchi xabarda aniqlangan.
   *
   * Burst birlashtirish shuni yopadi: javobni oxirgi xabar
   * ishi beradi va u butun kontekstni ko‘radi.
   */
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /hasNewerIncoming\(conversation\.id, input\.messageId\)/);
});

test("C+D2. ism va tavsiya xabariga CTA bilan javob berilmaydi", () => {
  const reply = buildConversationalReply({
    intent: "identity_data",
    pendingUserAction: "none",
    hasHistory: true,
    alreadyGreeted: true,
  });
  assert.ok(reply);
  // Eslatma yoki narx so'rovi bo'lmasin.
  assert.ok(!/chek|to‘lov|narx/i.test(reply));
});

test("C+D3. «Qanday qilib a’zo bo‘lsam bo‘ladi» — jarayon savoli", () => {
  const { intent } = gapFor("Qanday qilib a'zo bo'lsam bo'ladi", turn("new"));
  assert.equal(intent.needsKnowledge, true);
  assert.equal(intent.intent, "process_question");
});

/* ===================================================================== *
 * E. ARIZA NATIJASI SAVOLI INDEKSLASHGA BURILGAN
 * ===================================================================== */

test("E. «Qachon javobi chiqadi» — HOLAT savoli, bilim emas", () => {
  /*
   * Jonli xato: bot Google/Yandexda ko‘rinish «odatda 3–7
   * kun» deb javob bergan. Mijoz indekslash haqida umuman
   * so‘ramagan edi.
   */
  const { intent, gate } = gapFor("Qachon javobi chiqadi", turn("waiting_intake"));
  assert.equal(intent.intent, "status_question");
  assert.equal(intent.needsKnowledge, false, "bilim bazasiga yuborilyapti");
  assert.equal(gate.decision, "case_escalation");
});

/* ===================================================================== *
 * F. BEKOR QILISH YO'QOLGAN
 * ===================================================================== */

test("F. bekor qilish MINNATDORCHILIK bilan birga kelganda yo‘qolmaydi", () => {
  /*
   * Jonli xato: «Чикармела ккмас» + «Рахмат» dan keyin bot
   * «Arzimaydi. Shartlar bilan tanishib chiqqach ayting»
   * degan — savdo davom etgan.
   */
  for (const text of ["Чикармела ккмас", "Chiqarmang kerakmas", "Bekor qiling", "chiqarmela kkmas rahmat"]) {
    const { intent, gate } = gapFor(text, turn("waiting_intake"));
    assert.equal(intent.intent, "cancellation", `"${text}" -> ${intent.intent}`);
    assert.equal(gate.decision, "case_escalation", `"${text}" topshiriq yaratmadi`);
  }
});

test("F2. bekor qilishga SOTUV shabloni berilmaydi", () => {
  const reply = buildConversationalReply({
    intent: "cancellation",
    pendingUserAction: "review_offer",
    hasHistory: true,
    alreadyGreeted: true,
  });
  // Javob matnini dvigatel topshiriq natijasiga qarab qo'yadi.
  assert.equal(reply, null);

  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /handleCancellation\(/);
  assert.match(engine, /cancelPendingFollowups\(\s*context\.conversation\.id,\s*"mijoz bekor qilishni so‘radi"/);
  assert.equal(categoryForCancellation("article"), "content_correction");
});

test("F3. «Rahmat» ga CTA qo‘shilmaydi", () => {
  const reply = buildConversationalReply({
    intent: "thanks",
    pendingUserAction: "review_offer",
    hasHistory: true,
    alreadyGreeted: true,
  });
  assert.ok(reply);
  assert.ok(!/tanishib chiq|chek|ism/i.test(reply), `CTA qo‘shilgan: ${reply}`);
});

/* ===================================================================== *
 * G. «..» VA «🆗» GA SHARTLARNI O'QISH TALABI
 * ===================================================================== */

test("G. shovqin va emoji bilim bo‘shlig‘i emas", () => {
  for (const text of ["..", "🆗", "?", "."]) {
    const { gate } = gapFor(text, turn("waiting_intake"));
    assert.equal(gate.decision, "none", `"${text}" -> ${gate.decision}`);
  }
});

test("G2. «Qanaqa shart» — aniqlashtirish, bilim bo‘shlig‘i emas", () => {
  const { intent, gate } = gapFor("Qanaqa shart", turn("offer_sent"));
  assert.equal(intent.intent, "clarification");
  assert.equal(gate.decision, "none");
});

/* ===================================================================== *
 * H. ASOSIY QO'SHILISH SAVOLI YO'QOLGAN
 * ===================================================================== */

test("H. qo‘shilish savoli HAQIQIY bilim savoli deb taniladi", () => {
  const { intent } = gapFor("Qanday man xam o'zimni qo'ysam bolad", turn("new"));
  assert.equal(intent.needsKnowledge, true);
});

/* ===================================================================== *
 * I. INSON SO'RAGAN ISMNI BOT QAYTA SO'RAGAN
 * ===================================================================== */

test("I. inson yuritgan suhbat QAYTA ONBOARDING qilinmaydi", () => {
  /*
   * Jonli xato: inson ism so‘ragan, mijoz F.I.Sh. yuborgan,
   * bot esa qaytadan salomlashib ismni so‘ragan.
   *
   * Sabab: `sales_stage` ustuni hali ham `new` edi — bot bu
   * suhbatni birinchi marta ko‘rayotgan edi, mijoz uchun esa
   * bu yangi suhbat emas.
   */
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /hadPriorHumanContact\(conversation\)/);
  assert.match(engine, /eski suhbat — onboarding ssenariysi ishga tushirilmadi/);
  assert.match(engine, /outgoing_count/);
});

test("I2. haqiqiy ism turli shakllarda saqlanadi", () => {
  /*
   * Qo‘shimchaga qattiq bog‘lanmaydi: «Dilnoza Sobir» ham
   * ism, kirill va apostrofli variantlar ham.
   */
  for (const name of [
    "Dilnoza Sobir",
    "Karimov Aziz",
    "O‘tkirbek Qodirov",
    "Нодира Юсупова",
    "Aliyev Sardor Baxtiyorovich",
  ]) {
    assert.equal(looksLikePersonName(name), true, `"${name}" rad etildi`);
  }
});

/* ===================================================================== *
 * MEDIA VA CHEK
 * ===================================================================== */

test("oddiy portret rasm CHEK deb qabul qilinmaydi", () => {
  const attachment = classifyAttachment({
    messageType: "photo",
    caption: "Mana rasmim",
    stage: "waiting_intake",
    paymentStatus: "none",
  });
  assert.equal(attachment.treatAsPayment, false);

  const { intent } = gapFor("Mana", turn("waiting_intake", {
    hasAttachment: true,
    attachmentIsPayment: false,
  }));
  assert.notEqual(intent.intent, "payment_receipt_reference");
});

test("chek javobi faqat TASNIF chek deganda beriladi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /attachmentIsPayment/);
  assert.match(engine, /classifyAttachment\(\{[\s\S]{0,200}?caption: trimmed/);
});

test("chek javobi TO‘LOV TASDIG‘I emas", () => {
  const reply = buildConversationalReply({
    intent: "payment_receipt_reference",
    pendingUserAction: "send_payment_receipt",
    hasHistory: true,
    alreadyGreeted: true,
  });
  assert.ok(reply);
  assert.ok(!/tasdiqlandi|tasdiqlangan/i.test(reply));
});
