import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  detectReferral,
  isMoneyTemplate,
  mentionsMoney,
  MONEY_TEMPLATE_KEYS,
  REFERRAL_SOURCES,
} from "../src/lib/sales/flow/referral.ts";
import { resolveTransition, REFERRAL_TRANSITIONS } from "../src/lib/sales/flow/stages.ts";
import { getTemplate } from "../src/lib/sales/flow/templates.ts";
import { authorizeOutbound, type OutboundContext } from "../src/lib/sales/flow/outbound-guard.ts";

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/* ===================================================================== *
 * TANISHNI ANIQLASH
 * ===================================================================== */

test("tanish nomidan yozgan odam aniqlanadi", () => {
  const cases: [string, string][] = [
    ["Diyorbek Niyatullayevich nomidan yozayapman", "diyorbek_niyatullayevich"],
    ["diyorbek niyatullayev aka yubordi", "diyorbek_niyatullayevich"],
    ["Assalomu alaykum, Shohruh Kamolov aytdi sizga yozing deb", "shohruh_kamolov"],
    ["shoxrux kamolovdan keldim", "shohruh_kamolov"],
    ["men O'zak jamoasidanman", "ozak_jamoasi"],
    ["ozak jamoasidan yozayapman", "ozak_jamoasi"],
  ];

  for (const [text, expected] of cases) {
    const found = detectReferral(text);
    assert.ok(found, `topilmadi: "${text}"`);
    assert.equal(found.source, expected, `noto'g'ri manba: "${text}"`);
  }
});

test("o‘zbekcha apostrof variantlari ham tutiladi", () => {
  /*
   * Telegram klaviaturasi, iPhone tuzatishi va veb forma "o'" ni
   * uch xil belgi bilan beradi. Bittasi tutilmasa qoida jimgina
   * ishlamay qolardi.
   */
  for (const text of ["O‘zak jamoasidanman", "O`zak jamoasidan", "Oʻzak jamoasi"]) {
    assert.ok(detectReferral(text), `tutilmadi: ${text}`);
  }
});

test("oddiy nomzod tasodifan imtiyozli bo‘lib qolmaydi", () => {
  /*
   * ENG QIMMAT XATO SHU YO'NALISHDA: begona odam bepul maqola
   * olib ketadi. Shuning uchun ism yolg'iz yetarli emas.
   */
  const notReferrals = [
    "Mening ismim Diyorbek",
    "Men Aziz Niyatullayevichman",
    "Kamolov Aziz",
    "Bu o'zak masala",
    "Shohruh ismli do'stim aytdi",
    "salom",
    "",
  ];
  for (const text of notReferrals) {
    assert.equal(detectReferral(text), null, `noto'g'ri tutildi: "${text}"`);
  }
});

test("har bir manbaning yorlig‘i va iboralari bor", () => {
  assert.ok(REFERRAL_SOURCES.length >= 3);
  for (const source of REFERRAL_SOURCES) {
    assert.ok(source.label.trim().length > 0, `${source.key}: yorliq yo'q`);
    assert.ok(source.phrases.length > 0, `${source.key}: ibora yo'q`);
    for (const phrase of source.phrases) {
      assert.equal(phrase, phrase.toLowerCase(), `"${phrase}" kichik harfda emas`);
    }
  }
});

/* ===================================================================== *
 * FAQAT ISM SO'RALADI
 * ===================================================================== */

test("imtiyozli suhbat narxni CHETLAB O‘TIB ism so‘raydi", () => {
  const transition = resolveTransition("new", "other", "inbound", true);
  assert.ok(transition, "o'tish topilmadi");
  assert.equal(transition.to, "need_full_name", "darhol ism bosqichiga o'tmadi");

  for (const key of transition.templates) {
    assert.equal(isMoneyTemplate(key), false, `narx/to'lov shabloni yuborilyapti: ${key}`);
  }
  assert.ok(
    transition.templates.includes("request_full_name_with_samples"),
    "ism so'ralmayapti",
  );
});

test("imtiyozli o‘tishlarning HECH BIRIDA pul shabloni yo‘q", () => {
  for (const transition of REFERRAL_TRANSITIONS) {
    for (const key of transition.templates) {
      assert.equal(
        isMoneyTemplate(key),
        false,
        `${transition.from}|${transition.intent} -> ${key}`,
      );
    }
  }
});

test("oddiy suhbatda narx qadami JOYIDA qoladi", () => {
  /*
   * Imtiyoz istisno bo'lishi kerak. Qoida hammaga tarqalib
   * ketsa, bot hech kimdan pul so'ramay qo'yardi.
   */
  const normal = resolveTransition("new", "other", "inbound", false);
  assert.ok(normal);
  assert.ok(
    normal.templates.some((key) => isMoneyTemplate(key)),
    "oddiy kiruvchi suhbatda narx yuborilmayapti",
  );

  const outbound = resolveTransition("article_decision", "yes", "inbound", false);
  assert.ok(outbound?.templates.includes("payment_details"));
});

test("imtiyozli suhbatda to‘lov ma’lumoti o‘tishdan olib tashlangan", () => {
  const referral = resolveTransition("article_decision", "yes", "inbound", true);
  assert.ok(referral);
  assert.ok(!referral.templates.includes("payment_details"), "karta ma'lumoti ketyapti");
});

/* ===================================================================== *
 * YUBORISH DARVOZASI — OXIRGI KAFOLAT
 * ===================================================================== */

const baseContext = (over: Partial<OutboundContext> = {}): OutboundContext => ({
  conversationId: "c1",
  businessConnectionId: "bc1",
  chatId: 555,
  stage: "offer_sent",
  expectedStages: [],
  kind: "template",
  templateKey: "price_offer",
  body: "matn",
  autoReplyEnabled: true,
  aiEnabled: true,
  connectionEnabled: true,
  connectionCanReply: true,
  rollout: { mode: "full", allowlistChatIds: [], percentage: 100 },
  rolloutBucket: 0,
  optedOut: false,
  referral: false,
  ...over,
});

test("imtiyozli suhbatda pul shabloni DARVOZADAN o‘tmaydi", () => {
  for (const key of MONEY_TEMPLATE_KEYS) {
    const decision = authorizeOutbound(baseContext({ referral: true, templateKey: key }));
    assert.equal(decision.allowed, false, `${key} o'tib ketdi`);
    if (!decision.allowed) assert.equal(decision.reason, "referral_no_payment");
  }
});

test("taqiq SINOV rejimida ham ishlaydi", () => {
  /*
   * Sinov rejimi Telegram tekshiruvlarini o'tkazib yuboradi.
   * Taqiq pastda tursa, admin sinovda "narx yuborildi" deb
   * ko'rib, qoida ishlayapti deb o'ylardi.
   */
  const decision = authorizeOutbound(
    baseContext({ referral: true, templateKey: "payment_details", simulated: true }),
  );
  assert.equal(decision.allowed, false);
});

test("imtiyozli suhbatda pulga aloqasiz shablon O‘TADI", () => {
  // Taqiq faqat pul matniga tegishli — bot jim qolmasligi kerak.
  const decision = authorizeOutbound(
    baseContext({ referral: true, templateKey: "request_full_name_with_samples" }),
  );
  assert.equal(decision.allowed, true);
});

test("oddiy suhbatda narx shabloni o‘tadi", () => {
  const decision = authorizeOutbound(baseContext({ templateKey: "price_offer" }));
  assert.equal(decision.allowed, true);
});

/* ===================================================================== *
 * MODEL YOZGAN JAVOBDAGI PUL GAPI
 * ===================================================================== */

test("narx aytilgan javob pul gapi deb taniladi", () => {
  const moneyTexts = [
    "Kirish badali 38 ming so'm",
    "Narxi 100 000 so'm",
    "To'lovni Uzcard 5614686500416261 ga yuboring",
    "Hozir chegirma bor",
    "Kartaga o'tkazasiz",
  ];
  for (const text of moneyTexts) {
    assert.equal(mentionsMoney(text), true, `tutilmadi: "${text}"`);
  }
});

test("«bepul» pul so‘rash deb hisoblanmaydi", () => {
  /*
   * "bepul" ichida "pul" bor, lekin ma'nosi TESKARI. Qism-satr
   * bilan qidirsak, foydalar matnidagi "mutlaqo bepul nashr"
   * jumlasi ham to'silib, mijoz javobsiz qolardi.
   */
  assert.equal(mentionsMoney("Bu xizmat mutlaqo bepul"), false);
  assert.equal(mentionsMoney("Maqola qanday yoziladi?"), false);
  assert.equal(mentionsMoney("Ismingizni yozib yuboring"), false);
  assert.equal(mentionsMoney(""), false);
});

/* ===================================================================== *
 * DVIGATEL ULANISHI
 * ===================================================================== */

test("dvigatel manbani suhbat qatoriga BIR MARTA yozadi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /referral_source/);
  assert.match(engine, /\.is\("referral_source", null\)/);
  assert.match(engine, /conversation\.referralSource == null/);
});

test("bilim javobidagi pul gapi to‘xtatiladi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.match(engine, /referralConversation && mentionsMoney\(body\)/);
  assert.ok(getTemplate("referral_no_payment_reply"), "o'rnini bosadigan shablon yo'q");
});

test("eslatmalar ham imtiyozni hisobga oladi", () => {
  const runner = src("src/lib/sales/flow/followup-runner.ts");
  assert.match(runner, /referral: conversation\.referral_source != null/);
});

test("o‘rnini bosuvchi javobda pul gapi yo‘q", () => {
  const body = getTemplate("referral_no_payment_reply")!.body;
  assert.equal(mentionsMoney(body), false, "javobning o'zi pul haqida gapiryapti");
});

test("imtiyozli salomlashuvda narx yo‘q", () => {
  const body = getTemplate("referral_greeting")!.body;
  assert.equal(mentionsMoney(body), false);
});

test("panel imtiyozli suhbatni ko‘rsatadi", () => {
  const page = src("src/app/(admin)/ai-sotuv/suhbatlar/[id]/page.tsx");
  assert.match(page, /referralSource/);
  assert.match(page, /REFERRAL_SOURCE_LABELS/);
});
