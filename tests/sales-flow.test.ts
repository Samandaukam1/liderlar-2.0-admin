import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  isForwardTransition,
  resolveTransition,
  SALES_STAGES,
  SALES_STAGE_LABELS,
  TERMINAL_STAGES,
} from "../src/lib/sales/flow/stages.ts";
import { classifyReply, isPaymentEvidenceType } from "../src/lib/sales/flow/classify.ts";
import {
  inferGender,
  MIN_NAME_TOKENS,
  validateFullName,
} from "../src/lib/sales/flow/full-name.ts";
import { getTemplate, SALES_TEMPLATES } from "../src/lib/sales/flow/templates.ts";
import {
  authorizeOutbound,
  isOutboundAuthorized,
  type OutboundContext,
} from "../src/lib/sales/flow/outbound-guard.ts";
import {
  INITIAL_SIMULATION_STATE,
  simulateConversation,
  simulateStep,
} from "../src/lib/sales/flow/simulate.ts";
import { normalizeForIntent } from "../src/lib/sales/text-normalize.ts";
import {
  MIN_KNOWLEDGE_SCORE,
  scoreKnowledge,
  selectKnowledge,
  tokenize,
  type RetrievableKnowledge,
} from "../src/lib/sales/retrieval.ts";
import { hasPermission } from "../src/lib/permissions.ts";

const ROOT = new URL("..", import.meta.url).pathname;

/* ======================== 1. HOLAT MASHINASI ============================ */

test("ssenariy new dan boshlanib ariza tasdig‘iga o‘tadi", () => {
  const transition = resolveTransition("new", "other");
  assert.equal(transition?.to, "application_confirm");
  assert.deepEqual(transition?.templates, ["application_confirm"]);
});

test("“ha” foydalar savoliga, “yo‘q” rad javobiga olib boradi", () => {
  assert.equal(resolveTransition("application_confirm", "yes")?.to, "benefits_question");
  assert.equal(resolveTransition("application_confirm", "no")?.to, "declined");
});

test("bosqich faqat OLDINGA suriladi — takroriy “ha” sakratmaydi", () => {
  assert.equal(isForwardTransition("new", "application_confirm"), true);
  // Bir xil xabar ikki marta kelsa: o'sha bosqichga qaytish taqiqlangan.
  assert.equal(isForwardTransition("application_confirm", "application_confirm"), false);
  // Orqaga ketish ham taqiqlangan.
  assert.equal(isForwardTransition("offer_sent", "application_confirm"), false);
  // Ssenariydan chiqish (rad etish) har bosqichda mumkin.
  assert.equal(isForwardTransition("offer_sent", "declined"), true);
});

test("barcha bosqichlarning yorlig‘i bor", () => {
  for (const stage of SALES_STAGES) {
    assert.ok(SALES_STAGE_LABELS[stage], stage);
  }
  assert.deepEqual([...TERMINAL_STAGES], ["paid", "declined", "completed"]);
});

/* ===================== 2. NIYAT TASNIFI (YES/NO/LATER) ================== */

test("tasdiq shakllari YES deb taniladi", () => {
  for (const text of ["ha", "xa", "ha shunaqa", "to‘g‘ri", "albatta", "xo‘p", "хуш", "ok"]) {
    assert.equal(classifyReply(text).intent, "yes", text);
  }
});

test("inkor shakllari NO deb taniladi", () => {
  for (const text of ["yo‘q", "yoq", "юк", "kerak emas", "qiziqmayman"]) {
    assert.equal(classifyReply(text).intent, "no", text);
  }
});

test("“keyinroq” LATER, tasdiq emas", () => {
  for (const text of ["keyinroq", "o‘ylab ko‘raman", "keyin yozaman", "maslahatlashaman"]) {
    assert.equal(classifyReply(text).intent, "later", text);
  }
});

test("tanishdim / tanishmadim ajratiladi", () => {
  assert.equal(classifyReply("tanishdim").intent, "reviewed");
  assert.equal(classifyReply("ha tanishdim").intent, "reviewed");
  assert.equal(classifyReply("o‘qidim").intent, "reviewed");
  // "tanishmadim" ichida "tanishdim" YO'Q, lekin o'xshash — inkor
  // shakli tasdiqdan oldin tekshirilishi shart.
  assert.equal(classifyReply("tanishmadim").intent, "not_reviewed");
  assert.equal(classifyReply("hali ko‘rmadim").intent, "not_reviewed");
});

test("ma’lumot so‘rash NEED_INFO", () => {
  for (const text of ["ma’lumot bering", "tushuntirib bering", "bilmayman", "batafsil"]) {
    assert.equal(classifyReply(text).intent, "need_info", text);
  }
});

test("“хуш” bilim emas — xo‘p ga normallashadi", () => {
  // Bilim bazasiga "хуш" degan xizmat kiritilmagan; u faqat variant.
  assert.equal(normalizeForIntent("хуш"), "xo'p");
  assert.equal(classifyReply("хуш").intent, "yes");
  // Xom matn o'zgarmaydi — normalizatsiya faqat tasnif uchun.
  assert.equal(classifyReply("хуш").normalized, "xo'p");
});

test("so‘z chegarasi: “haq” tasdiq emas", () => {
  assert.notEqual(classifyReply("haqiqatan bilmayman").intent, "yes");
});

test("chek turlari to‘lov isboti deb qabul qilinadi", () => {
  assert.equal(isPaymentEvidenceType("photo"), true);
  assert.equal(isPaymentEvidenceType("document"), true);
  assert.equal(isPaymentEvidenceType("text"), false);
});

/* ======================= 3. TO‘LIQ F.I.Sh. TEKSHIRUVI =================== */

test("bitta so‘z F.I.Sh. sifatida QABUL QILINMAYDI", () => {
  const result = validateFullName("Maryam");
  assert.equal(result.ok, false);
  assert.equal(MIN_NAME_TOKENS, 2);
});

test("to‘liq F.I.Sh. qabul qilinadi va bosh harfga keltiriladi", () => {
  const result = validateFullName("ravshanova maryam rasulovna");
  assert.equal(result.ok, true);
  assert.equal(result.fullName, "Ravshanova Maryam Rasulovna");
  assert.equal(result.tokens.length, 3);
});

test("ortiqcha so‘zlar tashlanadi", () => {
  const result = validateFullName("ismim Ravshanova Maryam");
  assert.equal(result.ok, true);
  assert.equal(result.fullName, "Ravshanova Maryam");
});

test("jins otasining ismidan aniqlanadi, aniqlanmasa NULL", () => {
  assert.equal(inferGender(["Ravshanova", "Maryam", "Rasulovna"]), "female");
  assert.equal(inferGender(["Qurbonnazarov", "Jaxongir", "Baxtiyorovich"]), "male");
  assert.equal(inferGender(["Kim", "Anna"]), null);
  // TAXMIN QILINMAYDI: noto'g'ri jins rasm promtini buzadi.
  assert.equal(validateFullName("Kim Anna").gender, null);
});

/* ========================= 4. AYNAN SHABLONLAR ========================== */

test("shablonlar migratsiya seed'i bilan HARFMA-HARF bir xil", () => {
  // Ikki manba ajralib ketsa, bazadagi matn koddagisidan farq qilardi
  // va "aynan yuborilsin" talabi jimgina buzilardi.
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260907200000_sales_flow_v02.sql"),
    "utf8",
  );
  for (const template of SALES_TEMPLATES) {
    assert.ok(sql.includes(`$tpl$${template.body}$tpl$`), `seed'da yo‘q yoki farq qiladi: ${template.key}`);
    assert.ok(sql.includes(`('${template.key}',`), `kalit seed'da yo‘q: ${template.key}`);
  }
});

test("aynan yuboriladigan matnlar AI tomonidan qayta yozilmaydi", () => {
  for (const template of SALES_TEMPLATES) {
    assert.equal(template.isExact, true, template.key);
  }
});

test("foydalar matni to‘liq va o‘zgartirilmagan", () => {
  const body = getTemplate("benefits_full")!.body;
  assert.ok(body.includes("Qidiruv tizimlarida ko‘rinish"));
  assert.ok(body.includes("AdabiyotX platformasidagi eksklyuziv imkoniyatlar"));
  assert.ok(body.includes("https://liderlar.uz/ommaviy_ofertasi"));
  assert.ok(body.includes("Liderlar.uz | Instagram | @uzlye_rasmiy"));
});

test("narx matnida chegirma va ikkala summa bor", () => {
  const body = getTemplate("price_offer")!.body;
  assert.ok(body.includes("100 000 so’mni"));
  assert.ok(body.includes("38 MING SO'M"));
});

test("to‘lov matnida karta va egasining ismi bor", () => {
  const body = getTemplate("payment_details")!.body;
  assert.ok(body.includes("5614686500416261"));
  assert.ok(body.includes("JAXONGIR QURBONNAZAROV"));
  assert.ok(body.includes("CHEGIRMADAGI 38 MING SO'M"));
});

/* ==================== 5. OUTBOUND RUXSATI (XAVFSIZLIK) ================== */

const baseContext = (over: Partial<OutboundContext> = {}): OutboundContext => ({
  conversationId: "c1",
  businessConnectionId: "bc1",
  chatId: 555,
  stage: "offer_sent",
  expectedStages: ["offer_sent"],
  kind: "template",
  templateKey: "price_offer",
  body: "matn",
  autoReplyEnabled: true,
  aiEnabled: true,
  connectionEnabled: true,
  connectionCanReply: true,
  ...over,
});

test("hamma shart bajarilganda ruxsat beriladi", () => {
  const decision = authorizeOutbound(baseContext());
  assert.equal(decision.allowed, true);
  assert.ok(decision.allowed && isOutboundAuthorized(decision.authorization));
});

test("inson qo‘lga olgan bo‘lsa AI JIM — sozlama yoqiq bo‘lsa ham", () => {
  const decision = authorizeOutbound(baseContext({ aiEnabled: false }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "human_takeover");
});

test("avto-javob o‘chiq bo‘lsa yuborilmaydi", () => {
  const decision = authorizeOutbound(baseContext({ autoReplyEnabled: false }));
  assert.equal(decision.allowed === false && decision.reason, "auto_reply_disabled");
});

test("kutilmagan bosqichda yuborilmaydi", () => {
  const decision = authorizeOutbound(baseContext({ stage: "paid" }));
  assert.equal(decision.allowed === false && decision.reason, "unexpected_stage");
});

test("ulanish yoki javob huquqi yo‘q bo‘lsa yuborilmaydi", () => {
  assert.equal(
    authorizeOutbound(baseContext({ connectionEnabled: false })).allowed === false &&
      authorizeOutbound(baseContext({ connectionEnabled: false })).allowed,
    false,
  );
  const noRights = authorizeOutbound(baseContext({ connectionCanReply: false }));
  assert.equal(noRights.allowed === false && noRights.reason, "no_reply_rights");
});

test("bo‘sh matn yuborilmaydi", () => {
  const decision = authorizeOutbound(baseContext({ body: "   " }));
  assert.equal(decision.allowed === false && decision.reason, "empty_body");
});

test("soxta ruxsat obyektini yasab bo‘lmaydi", () => {
  // Muhr — modul ichidagi Symbol; tashqaridan takrorlab bo'lmaydi.
  assert.equal(isOutboundAuthorized({ seal: Symbol("sales.outbound.authorized") }), false);
  assert.equal(isOutboundAuthorized({ seal: "sales.outbound.authorized" }), false);
  assert.equal(isOutboundAuthorized({}), false);
  assert.equal(isOutboundAuthorized(null), false);
});

test("sinov rejimida ruxsat beriladi, lekin muhr “simulated” bo‘ladi", () => {
  const decision = authorizeOutbound(
    baseContext({ simulated: true, autoReplyEnabled: false, connectionCanReply: false }),
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.allowed && decision.authorization.simulated, true);
  // Inson nazorati sinovda ham kuchda.
  const takeover = authorizeOutbound(baseContext({ simulated: true, aiEnabled: false }));
  assert.equal(takeover.allowed === false && takeover.reason, "human_takeover");
});

/* ===================== 6. SIMULYATSIYA (TO‘LIQ SSENARIY) ================ */

test("to‘liq ssenariy: salom → ariza → foydalar → oferta → maqola → F.I.Sh.", () => {
  const run = simulateConversation([
    { text: "salom" },
    { text: "ha" },
    { text: "yo‘q" },
    { text: "tanishdim" },
    { text: "ha" },
    { text: "Ravshanova Maryam Rasulovna" },
  ]);

  const stages = run.steps.map((step) => step.stageAfter);
  assert.deepEqual(stages, [
    "application_confirm",
    "benefits_question",
    "offer_sent",
    "article_decision",
    "need_full_name",
    "intake_link_sent",
  ]);
  assert.equal(run.finalStage, "intake_link_sent");
  assert.equal(run.fullName, "Ravshanova Maryam Rasulovna");

  // Foydalar bosqichida to'rtta xabar ketadi: tushunarli, foydalar,
  // oferta chorlovi, narx.
  const benefitsStep = run.steps[2];
  assert.deepEqual(
    benefitsStep.sent.map((m) => m.templateKey),
    ["understood", "benefits_full", "benefits_review_prompt", "price_offer"],
  );
  assert.deepEqual(benefitsStep.scheduledFollowups, ["offer_review (7 daqiqa)"]);
});

test("mijoz javob berishi kutilayotgan follow-up'ni BEKOR qiladi", () => {
  // 7 daqiqalik follow-up rejalashtirildi...
  const first = simulateStep(
    { stage: "benefits_question", fullName: null, pendingFollowups: [] },
    { text: "yo‘q" },
  );
  assert.deepEqual(first.state.pendingFollowups, ["offer_review"]);

  // ...mijoz 7 daqiqa to'lmasdan javob berdi — eskisi bekor bo'ladi.
  const second = simulateStep(first.state, { text: "tanishdim" });
  assert.deepEqual(second.step.cancelledFollowups, ["offer_review"]);
  assert.equal(second.step.stageAfter, "article_decision");
});

test("tanishmadim → 5 daqiqalik follow-up", () => {
  const result = simulateStep(
    { stage: "offer_sent", fullName: null, pendingFollowups: [] },
    { text: "tanishmadim" },
  );
  assert.equal(result.step.stageAfter, "waiting_offer_review");
  assert.deepEqual(
    result.step.sent.map((m) => m.templateKey),
    ["review_later"],
  );
  assert.deepEqual(result.step.scheduledFollowups, ["article_decision (5 daqiqa)"]);
});

test("maqola: yo‘q → rad, keyinroq → 1 soatlik follow-up", () => {
  const declined = simulateStep(
    { stage: "article_decision", fullName: null, pendingFollowups: [] },
    { text: "yo‘q" },
  );
  assert.equal(declined.step.stageAfter, "declined");
  assert.deepEqual(
    declined.step.sent.map((m) => m.templateKey),
    ["declined"],
  );

  const later = simulateStep(
    { stage: "article_decision", fullName: null, pendingFollowups: [] },
    { text: "o‘ylab ko‘raman" },
  );
  assert.equal(later.step.stageAfter, "followup_later");
  assert.deepEqual(later.step.scheduledFollowups, ["article_decision_later (60 daqiqa)"]);
  // "Keyinroq" da xabar yuborilmaydi — faqat follow-up rejalashadi.
  assert.equal(later.step.sent.length, 0);
});

test("bitta so‘z F.I.Sh. rad etiladi va bosqich o‘zgarmaydi", () => {
  const result = simulateStep(
    { stage: "need_full_name", fullName: null, pendingFollowups: [] },
    { text: "Maryam" },
  );
  assert.equal(result.step.intent, "other");
  assert.equal(result.step.stageAfter, "need_full_name");
  assert.deepEqual(
    result.step.sent.map((m) => m.templateKey),
    ["request_full_name_again"],
  );
});

test("to‘liq F.I.Sh. anketa havolasi va ko‘rsatmani beradi", () => {
  const result = simulateStep(
    { stage: "need_full_name", fullName: null, pendingFollowups: [] },
    { text: "Ravshanova Maryam Rasulovna" },
  );
  assert.equal(result.step.stageAfter, "intake_link_sent");
  // Havola KO'RSATMADAN OLDIN ketadi.
  assert.equal(result.step.sent[0].templateKey, null);
  assert.equal(result.step.sent[1].templateKey, "intake_instructions");
  assert.ok(result.step.notes.some((n) => n.includes("jins: female")));
});

test("chek yuborilsa payment_review bosqichiga o‘tadi", () => {
  const photo = simulateStep(
    { stage: "waiting_payment", fullName: null, pendingFollowups: [] },
    { text: "chek", messageType: "photo" },
  );
  assert.equal(photo.step.intent, "payment_evidence");
  assert.equal(photo.step.stageAfter, "payment_review");

  const pdf = simulateStep(
    { stage: "waiting_payment", fullName: null, pendingFollowups: [] },
    { text: "chek.pdf", messageType: "document" },
  );
  assert.equal(pdf.step.stageAfter, "payment_review");
});

test("takroriy xabar bosqichni ikki marta surmaydi", () => {
  let state = INITIAL_SIMULATION_STATE;
  const first = simulateStep(state, { text: "ha" });
  state = first.state;
  const second = simulateStep(state, { text: "ha" });
  // Ikkinchisi "yes" bilan keyingi qadamga o'tadi, lekin AYNI bosqichga
  // qaytmaydi — bu idempotentlikning UI tarafdagi ko'rinishi.
  assert.equal(first.step.stageAfter, "application_confirm");
  assert.equal(second.step.stageAfter, "benefits_question");
  const third = simulateStep(second.state, { text: "ha" });
  assert.notEqual(third.step.stageAfter, "application_confirm");
});

test("simulyator Telegram'ga chiqmaydi — modulda yuborish yo‘li YO‘Q", () => {
  const source = readFileSync(join(ROOT, "src/lib/sales/flow/simulate.ts"), "utf8");
  assert.ok(!source.includes("telegram"));
  assert.ok(!source.includes("sendSalesMessage"));
  assert.ok(!source.includes("supabase"));
  // Kafolat bayroqqa emas, kod tuzilishiga tayanadi.
  assert.ok(!/\bfetch\s*\(/.test(source));
});

/* =============== 7. QO‘LDA BILIM: USTUVORLIK VA MANBA ================== */

const manual = (over: Partial<RetrievableKnowledge> = {}): RetrievableKnowledge => ({
  id: "m1",
  category: "faq",
  question: "Indekslanish qancha vaqt oladi?",
  answer: "Odatda bu jarayon 3–7 kun oladi.",
  tags: ["indekslanish"],
  confidence: 1,
  sourceType: "manual",
  priority: 100,
  ...over,
});

const extracted = (over: Partial<RetrievableKnowledge> = {}): RetrievableKnowledge => ({
  id: "a1",
  category: "faq",
  question: "Indekslanish qancha vaqt oladi?",
  answer: "Bir necha kun ichida indekslanadi.",
  tags: ["indekslanish"],
  confidence: 1,
  sourceType: "ai_extracted",
  priority: 0,
  ...over,
});

test("qo‘lda kiritilgan bilim AI ajratganidan USTUN turadi", () => {
  const selection = selectKnowledge([extracted(), manual()], {
    query: "indekslanish qancha vaqt oladi",
    intentKey: null,
  });
  assert.equal(selection.items[0].item.id, "m1");
  assert.ok(selection.items[0].reasons.some((r) => r.includes("qo‘lda")));
});

test("ustuvorlik ALOQASIZ bilimni ichkariga kiritmaydi", () => {
  // Eng nozik xato shu bo'lardi: priority=100 tufayli har savolga
  // qo'lda kiritilgan bilim yopishib qolishi.
  const irrelevant = manual({
    id: "m2",
    question: "Sertifikat qachon keladi?",
    answer: "Sertifikatni birozdan so‘ng yuboramiz.",
    tags: ["sertifikat"],
    category: "service_fact",
  });
  const selection = selectKnowledge([irrelevant], {
    query: "ofisingiz qayerda joylashgan",
    intentKey: null,
  });
  assert.equal(selection.empty, true);
});

test("moslik bali ustuvorlikdan ALOHIDA hisoblanadi", () => {
  const tokens = tokenize("indekslanish qancha vaqt oladi");
  const scoredManual = scoreKnowledge(manual(), tokens, null);
  const scoredAi = scoreKnowledge(extracted(), tokens, null);

  // Moslik deyarli teng (bir xil savol), lekin umumiy bal farq qiladi.
  assert.ok(scoredManual.relevance >= MIN_KNOWLEDGE_SCORE);
  assert.ok(scoredManual.score > scoredAi.score);
  assert.ok(scoredManual.score > scoredManual.relevance);
  assert.equal(scoredAi.score, scoredAi.relevance);
});

/* ================= 8. MIGRATSIYA VA SEED KAFOLATLARI =================== */

const MANUAL_MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260907190000_sales_manual_knowledge.sql"),
  "utf8",
);
const FLOW_MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260907200000_sales_flow_v02.sql"),
  "utf8",
);

test("qo‘lda bilim uchun manba suhbat majburiy EMAS, AI uchun majburiy", () => {
  assert.match(MANUAL_MIGRATION, /alter column source_conversation_id drop not null/);
  // Izlanuvchanlik AI oqimida saqlanadi.
  assert.match(
    MANUAL_MIGRATION,
    /source_type = 'manual' or source_conversation_id is not null/,
  );
});

test("uchta bilim seed qilingan va “хуш” kiritilmagan", () => {
  assert.ok(MANUAL_MIGRATION.includes("manual:post-article:announcement-template"));
  assert.ok(MANUAL_MIGRATION.includes("manual:certificate:sent-shortly"));
  assert.ok(MANUAL_MIGRATION.includes("manual:indexing:3-7-days"));
  assert.ok(MANUAL_MIGRATION.includes("3–7 kun oladi"));
  // Post shabloni universal fakt emasligi ochiq yozilgan.
  assert.ok(MANUAL_MIGRATION.includes("universal fakt emas"));
  // "хуш" bilim sifatida kiritilmagan — faqat izohda tushuntirilgan.
  assert.ok(!/insert into public\.sales_knowledge[\s\S]*\$txt\$хуш/.test(MANUAL_MIGRATION));
});

test("3–7 kun bilimi real qidiruvda topiladi", () => {
  // Fikstura MIGRATSIYADAGI haqiqiy trigger matnidan olinadi: seed
  // o‘zgarsa test ham u bilan birga o‘zgaradi va ular ajralib ketmaydi.
  const triggerLine = MANUAL_MIGRATION.split("\n").find((line) =>
    line.includes("Maqolam Google’da nega chiqmayapti?"),
  );
  assert.ok(triggerLine, "seed'dagi indekslanish triggeri topilmadi");
  const trigger = triggerLine!.trim().replace(/^'|',$/g, "");

  const seeded = manual({ question: trigger });
  for (const question of [
    "Maqolam Google’da nega chiqmayapti?",
    "Yandexda ko‘rinmayapti",
    "Indekslanish qancha vaqt oladi?",
    "Maqola qachon qidiruvda chiqadi?",
  ]) {
    const selection = selectKnowledge([seeded], { query: question, intentKey: null });
    assert.equal(selection.empty, false, question);
    assert.ok(selection.items[0].item.answer.includes("3–7 kun"), question);
  }
});

test("0.2 migratsiyasi mavjud ma’lumotni buzmaydi", () => {
  assert.ok(!/drop table/i.test(FLOW_MIGRATION));
  assert.ok(!/drop column/i.test(FLOW_MIGRATION));
  assert.ok(!/truncate/i.test(FLOW_MIGRATION));
  assert.ok(!/rename/i.test(FLOW_MIGRATION));
});

test("avto-javob standart holatda O‘CHIQ", () => {
  // Kod deploy bo‘lgani bilan bot jim qoladi — yoqishni admin qiladi.
  assert.match(FLOW_MIGRATION, /"autoReplyEnabled": false/);
  const settings = readFileSync(join(ROOT, "src/lib/sales/settings.ts"), "utf8");
  assert.match(settings, /autoReplyEnabled: false/);
  // Nosoz qiymat ham yoqmaydi: faqat aniq `true`.
  assert.match(settings, /raw\.autoReplyEnabled === true/);
});

test("follow-up navbati bazada, setTimeout ishlatilmaydi", () => {
  assert.ok(FLOW_MIGRATION.includes("sales_followups"));
  for (const file of collectFlowFiles()) {
    const code = readFileSync(file, "utf8");
    assert.ok(!/setTimeout\s*\(/.test(code), `${file} da setTimeout uchradi`);
  }
});

function collectFlowFiles(): string[] {
  const dir = join(ROOT, "src/lib/sales/flow");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(dir, name));
}

/* ================== 9. MAVJUD ANKETA XIZMATI QAYTA ISHLATILDI =========== */

test("sotuv boti mavjud anketa xizmatini chaqiradi — yangi generator YO‘Q", () => {
  const engine = readFileSync(join(ROOT, "src/lib/sales/flow/engine.ts"), "utf8");
  assert.match(engine, /createIntakeWithLink/);
  assert.match(engine, /@\/lib\/intake\/intake-link-service/);
  // Parallel token generatori yozilmagan.
  assert.ok(!engine.includes("generateRawIntakeToken"));
  assert.ok(!engine.includes("candidate_intake_links"));

  // Server action ham xuddi shu xizmatdan foydalanadi.
  const actions = readFileSync(join(ROOT, "src/lib/actions/intakes.ts"), "utf8");
  assert.match(actions, /createIntakeLink/);
  assert.match(actions, /createIntakeRecord/);
  assert.ok(!actions.includes("generateRawIntakeToken"));
});

test("xom havola SAQLANMAYDI — faqat prefiks", () => {
  const service = readFileSync(join(ROOT, "src/lib/intake/intake-link-service.ts"), "utf8");
  assert.match(service, /token_hash: hashIntakeToken\(raw\)/);
  assert.match(service, /token_prefix: tokenPrefix\(raw\)/);
  assert.ok(!/token:\s*raw/.test(service));

  assert.match(FLOW_MIGRATION, /intake_link_prefix text/);
  assert.ok(!FLOW_MIGRATION.includes("intake_link_token"));
});

test("anketa topshirilishi sotuv oqimiga ulangan", () => {
  const submit = readFileSync(join(ROOT, "src/app/api/intake/submit/route.ts"), "utf8");
  assert.match(submit, /onIntakeSubmitted\(resolved\.intakeId\)/);
  // Xatosi topshirishni buzmasligi kerak.
  assert.ok(submit.includes("try {"));
});

/* ====================== 10. TAKRORLANISH VA QULF ======================== */

test("takroriy Telegram update ikkinchi javob yubormaydi", () => {
  const route = readFileSync(
    join(ROOT, "src/app/api/telegram-sales/webhook/route.ts"),
    "utf8",
  );
  // Oqim faqat YANGI saqlangan kiruvchi xabarda ishga tushadi.
  assert.match(route, /if \(!result\.stored \|\| !result\.conversationId\) return;/);
  assert.match(route, /parsed\.message\.direction !== "incoming"/);
});

test("bir suhbatni ikki worker bir vaqtda ishlamaydi", () => {
  const engine = readFileSync(join(ROOT, "src/lib/sales/flow/engine.ts"), "utf8");
  assert.match(engine, /claimConversation/);
  // Yagona UPDATE bilan atomik da'vo.
  assert.match(engine, /lock_token\.is\.null,lock_expires_at\.lt\./);
  assert.match(engine, /finally \{\s*await releaseConversation/);
});

/* ====================== 11. RUXSATLAR ================================== */

test("qo‘lda bilim qo‘shish sales.manage talab qiladi", () => {
  assert.equal(hasPermission(["viewer"], "sales.manage"), false);
  assert.equal(hasPermission(["analyst"], "sales.manage"), false);
  assert.equal(hasPermission(["moderator"], "sales.manage"), false);
  assert.equal(hasPermission(["admin"], "sales.manage"), true);

  const actions = readFileSync(join(ROOT, "src/lib/actions/sales.ts"), "utf8");
  for (const action of [
    "createManualKnowledgeAction",
    "archiveKnowledgeAction",
    "confirmPaymentAction",
    "setHumanTakeoverAction",
    "saveFlowSettingsAction",
  ]) {
    const block = actions.slice(actions.indexOf(`export async function ${action}`));
    assert.match(
      block.slice(0, 400),
      /await requirePermission\("sales\.manage"\)/,
      `${action} ruxsatni tekshirmayapti`,
    );
  }
});

test("cron marshruti sirsiz ishlamaydi", () => {
  const cron = readFileSync(
    join(ROOT, "src/app/api/cron/sales-followups/route.ts"),
    "utf8",
  );
  assert.match(cron, /if \(!secret\)/);
  assert.match(cron, /status: 503/);
  assert.match(cron, /Bearer \$\{secret\}/);
});
