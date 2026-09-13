import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mergeTimeline,
  toModelTurns,
  listExplainedTemplateKeys,
  assistantTexts,
  type TimelineEvent,
} from "../src/lib/sales/timeline-merge.ts";
import {
  classifyAttachment,
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  UNKNOWN_ATTACHMENT_QUESTION,
} from "../src/lib/sales/flow/attachment-intent.ts";
import {
  isSuccessfulOutcome,
  isFunnelProgress,
  SALE_CONFIRMED_OUTCOMES,
  FUNNEL_PROGRESS_OUTCOMES,
} from "../src/lib/sales/outcome.ts";

const style = readFileSync("src/lib/sales/style.ts", "utf8");
const engine = readFileSync("src/lib/sales/flow/engine.ts", "utf8");

/* ============ 1. "Hi" NING HAQIQIY SABABI (audit A) ==================== */

test("o‘zbekcha so‘zlar salomlashuv deb sanalmaydi", () => {
  /*
   * AUDIT TOPILMASI: `matchedPhrases()` `includes()` ishlatardi va
   * "yaxshi", "yaxshimisiz", "shior", "tanishib", "chiqdi" —
   * hammasining ichida "hi" bor. Jonli profilda salomlashish
   * ulushi 42% ga chiqib ketgan, eng yuqori ibora "hi" bo‘lgan,
   * prompt esa modelga AYNAN "hi" bilan boshlashni buyurgan.
   *
   * Lug‘atdan "hi" ni olib tashlash yetarli emas edi — sabab
   * qidirish USULIDA.
   */
  assert.match(style, /function matchedPhrases/);
  assert.ok(!/lowerText\.includes\(normalizeForMatch\(phrase\)\)/.test(style),
    "substring qidiruv qolmasin");
  // Manbada regex qo'sh backslash bilan yozilgan, shuning uchun
  // shaklning o'zini emas, unicode xossa sinfi ishlatilganini
  // tekshiramiz. Haqiqiy xatti-harakat quyidagi testda.
  assert.ok(style.includes("p{L}"), "so‘z chegarasi ishlatilsin");
});

test("so‘z chegarasi regexi haqiqatan ishlaydi", () => {
  // Modulning o'zini yuklay olmaymiz (server import zanjiri), lekin
  // qoidaning o'zi shu — uni mustaqil tekshiramiz.
  const boundary = (text: string, phrase: string) =>
    new RegExp(`(?:^|[^\\p{L}\\p{N}])${phrase}(?:[^\\p{L}\\p{N}]|$)`, "u").test(text);

  for (const word of ["yaxshi", "yaxshimisiz", "shior", "tanishib", "chiqdi"]) {
    assert.equal(boundary(word, "hi"), false, `${word} salomlashuv emas`);
  }
  assert.equal(boundary("hi", "hi"), true);
  assert.equal(boundary("hi aka", "hi"), true);
  assert.equal(boundary("assalomu alaykum", "assalomu alaykum"), true);
});

/* ========== 2. YAGONA TIMELINE (master spec 1, audit B) ================ */

const event = (over: Partial<TimelineEvent>): TimelineEvent => ({
  id: "e1",
  actor: "customer",
  text: "matn",
  at: "2026-09-14T10:00:00Z",
  telegramMessageId: null,
  delivered: true,
  messageType: "text",
  templateKey: null,
  ...over,
});

test("AI javoblari tarixga TUSHADI", () => {
  /*
   * AUDIT TOPILMASI: kontekst faqat `sales_messages` dan o'qilardi,
   * AI javoblari esa `sales_outbound_log` da. Ya'ni AI o'zining
   * oldingi javoblarini ko'rmasdi va takror tekshiruvi BO'SH
   * ro'yxat olardi — Phase 1 ning asosiy himoyasi amalda o'lik edi.
   */
  const merged = mergeTimeline(
    [event({ id: "m1", actor: "customer", text: "narxi qancha", at: "2026-09-14T10:00:00Z" })],
    [event({ id: "o1", actor: "ai", text: "38 ming so‘m", at: "2026-09-14T10:01:00Z" })],
    10,
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[1].actor, "ai");
  assert.deepEqual(assistantTexts(merged), ["38 ming so‘m"]);
});

test("vaqt bo‘yicha tartiblanadi, manbadan qat’i nazar", () => {
  const merged = mergeTimeline(
    [
      event({ id: "m2", text: "ikkinchi", at: "2026-09-14T10:02:00Z" }),
      event({ id: "m1", text: "birinchi", at: "2026-09-14T10:00:00Z" }),
    ],
    [event({ id: "o1", actor: "ai", text: "o‘rtada", at: "2026-09-14T10:01:00Z" })],
    10,
  );
  assert.deepEqual(merged.map((e) => e.text), ["birinchi", "o‘rtada", "ikkinchi"]);
});

test("bot xabarining echo’si IKKI marta ko‘rinmaydi", () => {
  // Bot yuborgan xabar Telegram orqali qaytib kelib, chiquvchi
  // sifatida ham yozilishi mumkin.
  const merged = mergeTimeline(
    [event({ id: "m1", actor: "human", text: "38 ming so‘m", telegramMessageId: 555 })],
    [event({ id: "o1", actor: "ai", text: "38 ming so‘m", telegramMessageId: 555 })],
    10,
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].actor, "ai", "kelib chiqishi aniq variant qoladi");
});

test("inson bir xil qisqa javobni ikki marta yozsa IKKALASI qoladi", () => {
  // Dedupe FAQAT telegram id bo'yicha. Matn bo'yicha birlashtirish
  // haqiqiy tarixni buzardi: "xo'p" ni ikki marta yozish normal.
  const merged = mergeTimeline(
    [
      event({ id: "m1", actor: "human", text: "xo‘p", telegramMessageId: 1, at: "2026-09-14T10:00:00Z" }),
      event({ id: "m2", actor: "human", text: "xo‘p", telegramMessageId: 2, at: "2026-09-14T10:01:00Z" }),
    ],
    [],
    10,
  );
  assert.equal(merged.length, 2);
});

test("YETKAZILMAGAN AI javobi “aytilgan” deb hisoblanmaydi", () => {
  // Simulated yoki xato bilan tugagan urinishni tarixga qo'yish
  // modelga yolg'on kontekst berardi: u kerakli gapni "allaqachon
  // aytdim" deb takrorlamay qo'yardi.
  const merged = mergeTimeline(
    [],
    [
      event({ id: "o1", actor: "ai", text: "yuborilmagan", delivered: false }),
      event({ id: "o2", actor: "ai", text: "yuborilgan", delivered: true, at: "2026-09-14T10:02:00Z" }),
    ],
    10,
  );
  const turns = toModelTurns(merged);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, "yuborilgan");
});

test("yuborilmagan kanonik shablon “yuborilgan” deb belgilanmaydi", () => {
  // Aks holda mijoz uni umuman olmay qolardi.
  const events = [
    event({ id: "o1", actor: "ai", templateKey: "canonical_benefits", delivered: false }),
    event({ id: "o2", actor: "ai", templateKey: "price_offer", delivered: true }),
  ];
  const keys = listExplainedTemplateKeys(events);
  assert.deepEqual(keys, ["price_offer"]);
});

test("fallback shablonlari “tushuntirilgan mavzu” emas", () => {
  const keys = listExplainedTemplateKeys([
    event({ id: "o1", actor: "ai", templateKey: "fallback:missing_knowledge", delivered: true }),
  ]);
  assert.deepEqual(keys, []);
});

test("joriy xabar tarixdan CHIQARILADI", () => {
  // Kiruvchi xabar avval bazaga yoziladi, keyin generatorga yana
  // `message` sifatida beriladi — chiqarilmasa ikki marta borardi.
  assert.match(engine, /excludeMessageId/);
  assert.match(engine, /currentMessageId: input\.messageId/);
});

test("takror tekshiruvi endi TIMELINE dan oziqlanadi", () => {
  // Phase 1 da u `history` dan olardi va u yerda AI javoblari yo'q edi.
  assert.match(engine, /const previousReplies = timeline\.assistantTexts/);
  assert.ok(
    !/previousReplies = history[\s\S]{0,80}role === "assistant"/.test(engine),
    "eski, bo‘sh manba qolmasin",
  );
});

/* =========== 3. BIRIKMA ≠ CHEK (master spec 6, audit C) ================ */

const attachment = (over: Partial<Parameters<typeof classifyAttachment>[0]> = {}) =>
  classifyAttachment({
    messageType: "photo",
    caption: null,
    stage: "new",
    paymentStatus: "none",
    ...over,
  });

test("matnda “chek” bo‘lsa — chek", () => {
  for (const caption of ["chek", "to‘ladim mana chek", "pul o‘tkazdim"]) {
    const result = attachment({ caption });
    assert.equal(result.kind, "payment_evidence", caption);
    assert.equal(result.treatAsPayment, true);
  }
});

test("matnda “rasm” bo‘lsa — PORTRET, chek emas", () => {
  // Auditda ko'rilgan eng ko'p holat: mijozlar maqola uchun surat
  // yuboradi va u chek deb belgilanardi.
  for (const caption of ["rasmim", "mana suratim", "3x4 rasm"]) {
    const result = attachment({ caption });
    assert.equal(result.kind, "portrait", caption);
    assert.equal(result.treatAsPayment, false);
  }
});

test("anketa xatosi skrinshoti chek emas", () => {
  const result = attachment({ caption: "anketa saqlanmayapti, xato chiqyapti" });
  assert.equal(result.kind, "technical_screenshot");
  assert.equal(result.treatAsPayment, false);
});

test("diplom/sertifikat hujjati chek emas", () => {
  const result = attachment({ caption: "diplomim", messageType: "document" });
  assert.equal(result.kind, "achievement_document");
  assert.equal(result.treatAsPayment, false);
});

test("to‘lov kutilayotgan bosqichda matnsiz rasm — chek", () => {
  const result = attachment({ stage: "waiting_payment", paymentStatus: "requested" });
  assert.equal(result.kind, "payment_evidence");
  assert.equal(result.treatAsPayment, true);
  assert.match(result.reason, /bosqich/);
});

test("ANKETA bosqichida matnsiz rasm — portret", () => {
  // To'lov hali so'ralmagan, ya'ni chek bo'lishi MUMKIN EMAS.
  for (const stage of ["need_full_name", "intake_link_sent", "waiting_intake"] as const) {
    const result = attachment({ stage });
    assert.equal(result.kind, "portrait", stage);
    assert.equal(result.treatAsPayment, false);
  }
});

test("SHUBHADA taxmin qilinmaydi", () => {
  // Noto'g'ri "chek" deb belgilash "bilmayman" dan qimmatroq.
  const result = attachment({ stage: "benefits_sent" });
  assert.equal(result.kind, "unknown");
  assert.equal(result.treatAsPayment, false);
  assert.ok(UNKNOWN_ATTACHMENT_QUESTION.includes("?"), "aniqlashtiruvchi savol bo‘lsin");
});

test("to‘langan mijozning rasmi qayta chek bo‘lmaydi", () => {
  const result = attachment({ stage: "paid", paymentStatus: "paid" });
  assert.equal(result.treatAsPayment, false);
});

test("har birikma turining yorlig‘i bor", () => {
  for (const kind of ATTACHMENT_KINDS) assert.ok(ATTACHMENT_KIND_LABELS[kind], kind);
});

/* ========= 4. SOTUV TA'RIFI (2-faza 30-band, audit F) ================== */

test("to‘lov SO‘RALGANI sotuv emas", () => {
  assert.equal(isSuccessfulOutcome("payment_requested"), false);
  assert.equal(isSuccessfulOutcome("application_sent"), false);
});

test("“to‘ladim” degan MATN sotuv emas", () => {
  // `paid` ni mijozning matni qo'zg'atishi mumkin; matn moliyaviy
  // tasdiq emas.
  assert.equal(isSuccessfulOutcome("paid"), false);
});

test("faqat TASDIQLANGAN to‘lov sotuv", () => {
  assert.deepEqual([...SALE_CONFIRMED_OUTCOMES], ["completed"]);
  assert.equal(isSuccessfulOutcome("completed"), true);
});

test("voronka siljishi ALOHIDA o‘lchov", () => {
  assert.ok(FUNNEL_PROGRESS_OUTCOMES.includes("application_sent"));
  assert.ok(FUNNEL_PROGRESS_OUTCOMES.includes("payment_requested"));
  assert.equal(isFunnelProgress("application_sent"), true);
  assert.equal(isFunnelProgress("dropped"), false);
  assert.equal(isFunnelProgress("unknown"), false);
});
