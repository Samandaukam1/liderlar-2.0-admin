import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeConfidence,
  findUnsupportedNumbers,
  isMissingKnowledge,
  MIN_KNOWLEDGE_SCORE,
  scoreKnowledge,
  selectKnowledge,
  selectPatterns,
  tokenize,
  type RetrievableKnowledge,
  type RetrievablePattern,
} from "../src/lib/sales/retrieval.ts";
import {
  buildRetrievalQuery,
  buildStyleInstructions,
  buildTestChatMessages,
  buildTestChatSystemPrompt,
  type TestChatTurn,
} from "../src/lib/sales/test-chat-prompt.ts";
import { analyzeStyle, type StyleProfile } from "../src/lib/sales/style.ts";
import { guessIntentFromText } from "../src/lib/sales/intents.ts";
import { hasPermission } from "../src/lib/permissions.ts";

const ROOT = new URL("..", import.meta.url).pathname;

/* ------------------------------- fixtures ------------------------------- */

const knowledge: RetrievableKnowledge[] = [
  {
    id: "k-price",
    category: "price",
    question: "Narxi qancha?",
    answer: "Profil joylash narxi 38 ming so‘m.",
    tags: ["narx"],
    confidence: 0.9,
  },
  {
    id: "k-benefit",
    category: "service_fact",
    question: "Nima foydasi bor?",
    answer: "Profilingiz saytda chiqadi va sertifikat beriladi.",
    tags: ["sertifikat"],
    confidence: 0.8,
  },
  {
    id: "k-objection",
    category: "objection",
    question: "Qimmat ekan",
    answer: "Bir marta to‘lanadi va profil doimiy qoladi.",
    tags: [],
    confidence: 0.7,
  },
  {
    id: "k-application",
    category: "application",
    question: "Ariza qanday topshiriladi?",
    answer: "Ariza havolasi orqali to‘ldiriladi.",
    tags: ["ariza"],
    confidence: 0.6,
  },
];

const patterns: RetrievablePattern[] = [
  {
    id: "p-price-a",
    intentKey: "PRICE_QUESTION",
    intentLabel: "Narx qancha",
    customerExample: "narxi qancha?",
    responseExample: "38 ming so‘m, bir martalik to‘lov.",
    frequency: 73,
    successCount: 28,
    successRate: 38.4,
  },
  {
    id: "p-price-b",
    intentKey: "PRICE_QUESTION",
    intentLabel: "Narx qancha",
    customerExample: "qancha turadi?",
    responseExample: "Narxi 38 ming so‘m.",
    frequency: 41,
    successCount: 9,
    successRate: 22,
  },
  {
    id: "p-price-c",
    intentKey: "PRICE_QUESTION",
    intentLabel: "Narx qancha",
    customerExample: "nech pul?",
    responseExample: "Narxlar ro‘yxatini yuboraman.",
    frequency: 12,
    successCount: 0,
    successRate: null,
  },
  {
    id: "p-cert",
    intentKey: "CERTIFICATE",
    intentLabel: "Sertifikat",
    customerExample: "sertifikat bormi?",
    responseExample: "Ha, sertifikat beriladi.",
    frequency: 5,
    successCount: 1,
    successRate: 20,
  },
];

/* ==================== 1. TASDIQLANGAN BILIM RETRIEVAL ==================== */

test("savolga mos bilim topiladi, mos kelmagani tashlanadi", () => {
  const intent = guessIntentFromText("Assalomu alaykum, narxi qancha?");
  assert.equal(intent?.key, "PRICE_QUESTION");

  const selection = selectKnowledge(knowledge, {
    query: "Assalomu alaykum, narxi qancha?",
    intentKey: intent?.key ?? null,
  });

  assert.equal(selection.empty, false);
  assert.equal(selection.items[0].item.id, "k-price");
  // Ariza haqidagi bilim narx savoliga biriktirilmasligi kerak.
  assert.ok(!selection.items.some((entry) => entry.item.id === "k-application"));
});

test("chegara bor: tasodifiy bilim biriktirilmaydi", () => {
  const selection = selectKnowledge(knowledge, {
    query: "bugun havo qanday",
    intentKey: null,
  });
  assert.equal(selection.empty, true);
  assert.equal(selection.items.length, 0);
});

test("turkum mosligi ballga qo‘shiladi", () => {
  const queryTokens = tokenize("narxi qancha");
  const withIntent = scoreKnowledge(knowledge[0], queryTokens, "PRICE_QUESTION");
  const withoutIntent = scoreKnowledge(knowledge[0], queryTokens, null);

  assert.ok(withIntent.score > withoutIntent.score);
  assert.ok(withIntent.reasons.some((r) => r.includes("turkum mos")));
  assert.ok(withIntent.score >= MIN_KNOWLEDGE_SCORE);
});

test("tokenizatsiya ma’nosiz so‘zlarni tashlaydi", () => {
  const tokens = tokenize("Assalomu alaykum, men uchun narxi qancha?");
  assert.ok(tokens.includes("narxi"));
  assert.ok(!tokens.includes("men"));
  assert.ok(!tokens.includes("uchun"));
  assert.ok(!tokens.includes("assalomu"));
});

test("faqat TASDIQLANGAN material o‘qiladi", () => {
  // Filtr baza so'rovida yashaydi — manba darajasida qo'riqlanadi.
  const source = readFileSync(join(ROOT, "src/lib/sales/repository.ts"), "utf8");
  const block = source.slice(source.indexOf("export async function listApprovedKnowledge"));
  assert.match(block.slice(0, 800), /\.eq\("status", "approved"\)/);

  const patternsBlock = source.slice(source.indexOf("export async function listApprovedPatterns"));
  assert.match(patternsBlock.slice(0, 300), /status: "approved"/);

  // Sinov generatori aynan shu ikki funksiyani chaqiradi.
  const chat = readFileSync(join(ROOT, "src/lib/sales/test-chat.ts"), "utf8");
  assert.match(chat, /listApprovedKnowledge\(\)/);
  assert.match(chat, /listApprovedPatterns\(\)/);
  assert.ok(!chat.includes("listKnowledge("), "qoralama bilim o‘qilmasligi kerak");
});

/* ==================== 2. JAVOB SHABLONLARI RETRIEVAL ===================== */

test("shu niyatdagi shablonlar olinadi, boshqasi olinmaydi", () => {
  const selected = selectPatterns(patterns, { intentKey: "PRICE_QUESTION" });
  assert.equal(selected.length, 3);
  assert.ok(selected.every((pattern) => pattern.intentKey === "PRICE_QUESTION"));
});

test("shablonlar NATIJA bo‘yicha saralanadi, noma’lum oxirida", () => {
  const selected = selectPatterns(patterns, { intentKey: "PRICE_QUESTION" });
  assert.deepEqual(selected.map((p) => p.id), ["p-price-a", "p-price-b", "p-price-c"]);
  // Eng ko'p ishlatilgani (73) tasodifan birinchi; natijasi noma'lum
  // variant esa chastotasidan qat'i nazar OXIRIDA.
  assert.equal(selected[selected.length - 1].successRate, null);
});

test("niyat aniqlanmasa shablon biriktirilmaydi", () => {
  assert.deepEqual(selectPatterns(patterns, { intentKey: null }), []);
});

/* ========================== 3. USLUB QO‘LLANISHI ========================= */

function styleFrom(samples: Array<{ text: string; ageDays: number }>): StyleProfile {
  const now = new Date("2026-09-07T12:00:00.000Z");
  return analyzeStyle(
    samples.map((sample) => ({
      text: sample.text,
      sentAt: new Date(now.getTime() - sample.ageDays * 86_400_000).toISOString(),
      direction: "outgoing" as const,
      conversationId: "c1",
    })),
    { now },
  ).profile;
}

test("uslub profili KO‘RSATMAGA aylanadi", () => {
  const profile = styleFrom([
    { text: "Assalomu alaykum! Sizga narxlarni yuboraman, ariza qoldiring.", ageDays: 1 },
    { text: "Hurmatli mijoz, sizning arizangiz qabul qilindi.", ageDays: 2 },
  ]);

  const lines = buildStyleInstructions(profile);
  const joined = lines.join("\n");
  assert.match(joined, /“siz”/);
  assert.match(joined, /Lotin yozuvida/);
  assert.ok(lines.length >= 3);
});

test("namuna yetmagan o‘lchovdan qoida yasalmaydi", () => {
  const profile = styleFrom([{ text: "Ha", ageDays: 1 }]);
  const joined = buildStyleInstructions(profile).join("\n");
  // Juftlik konteksti yo'q => "qisqa yozsa qisqa javob ber" chiqmasligi kerak.
  assert.ok(!joined.includes("Mijoz qisqa yozsa"));
  // Ko'p savolli namuna yo'q => ro'yxat qoidasi ham chiqmaydi.
  assert.ok(!joined.includes("ro‘yxat qilib yoz"));
});

test("uslub profili yo‘q bo‘lsa ko‘rsatma ham yo‘q", () => {
  assert.deepEqual(buildStyleInstructions(null), []);
});

test("promt uslub, bilim va shablonni birlashtiradi", () => {
  const profile = styleFrom([
    { text: "Assalomu alaykum! Sizga yuboraman, ariza qoldiring.", ageDays: 1 },
  ]);
  const selection = selectKnowledge(knowledge, {
    query: "narxi qancha",
    intentKey: "PRICE_QUESTION",
  });

  const prompt = buildTestChatSystemPrompt({
    knowledge: selection.items,
    patterns: selectPatterns(patterns, { intentKey: "PRICE_QUESTION" }),
    style: profile,
    missingKnowledge: false,
  });

  assert.match(prompt, /TASDIQLANGAN BILIM/);
  assert.match(prompt, /38 ming so‘m/);
  assert.match(prompt, /YOZISH USLUBI/);
  // Shablonlar OHANG namunasi — ko'chirish taqiqlanadi.
  assert.match(prompt, /KO‘CHIRMA/);
  assert.match(prompt, /so‘zma-so‘z ko‘chirma/);
});

/* ========================= 4. SUHBAT KONTEKSTI =========================== */

test("kontekst modelga to‘liq uzatiladi", () => {
  const history: TestChatTurn[] = [
    { role: "customer", text: "Narxi qancha?" },
    { role: "assistant", text: "38 ming so‘m." },
  ];
  const messages = buildTestChatMessages(history, "Qimmat ekan.");

  assert.deepEqual(messages, [
    { role: "user", content: "Narxi qancha?" },
    { role: "assistant", content: "38 ming so‘m." },
    { role: "user", content: "Qimmat ekan." },
  ]);
});

test("e’tiroz oldingi savol bilan birga qidiriladi", () => {
  const history: TestChatTurn[] = [
    { role: "customer", text: "Narxi qancha?" },
    { role: "assistant", text: "38 ming so‘m." },
  ];
  // "Qimmat ekan" o'zi mavzusiz — kontekstsiz hech qanday bilimga ulanmasdi.
  const query = buildRetrievalQuery(history, "Qimmat ekan.");
  assert.ok(query.includes("Narxi qancha?"));
  assert.ok(query.includes("Qimmat ekan."));

  const selection = selectKnowledge(knowledge, {
    query,
    intentKey: guessIntentFromText("Qimmat ekan.")?.key ?? null,
  });
  assert.equal(selection.empty, false);
  assert.ok(selection.items.some((entry) => entry.item.id === "k-objection"));
});

test("e’tiroz niyat sifatida tanilади", () => {
  assert.equal(guessIntentFromText("Qimmat ekan.")?.key, "OBJECTION_TOO_EXPENSIVE");
  assert.equal(guessIntentFromText("O‘ylab ko‘raman")?.key, "OBJECTION_THINKING");
});

/* ======================== 5. MISSING_KNOWLEDGE =========================== */

test("material topilmasa MISSING_KNOWLEDGE bo‘ladi", () => {
  const selection = selectKnowledge(knowledge, { query: "ofisingiz qayerda", intentKey: null });
  const selected = selectPatterns(patterns, { intentKey: null });
  assert.equal(isMissingKnowledge(selection.items, selected), true);
});

test("bittasi topilsa ham MISSING_KNOWLEDGE emas", () => {
  const selection = selectKnowledge(knowledge, {
    query: "narxi qancha",
    intentKey: "PRICE_QUESTION",
  });
  assert.equal(isMissingKnowledge(selection.items, []), false);
  assert.equal(isMissingKnowledge([], selectPatterns(patterns, { intentKey: "CERTIFICATE" })), false);
});

test("bilim yo‘qligida promt FAKT AYTISHNI taqiqlaydi", () => {
  const prompt = buildTestChatSystemPrompt({
    knowledge: [],
    patterns: [],
    style: null,
    missingKnowledge: true,
  });
  assert.match(prompt, /tasdiqlangan bilim YO‘Q/);
  assert.match(prompt, /HECH QANDAY aniq fakt aytma/);
  assert.match(prompt, /aniqlab, xabar beraman/);
});

test("ishonch retrieval kuchidan hisoblanadi", () => {
  // Hech narsa topilmadi — ishonch nol.
  assert.equal(
    computeConfidence({
      intentResolved: false,
      intentKnown: false,
      knowledgeCount: 0,
      patternCount: 0,
      hasStyleProfile: false,
    }),
    0,
  );

  const weak = computeConfidence({
    intentResolved: true,
    intentKnown: true,
    knowledgeCount: 0,
    patternCount: 0,
    hasStyleProfile: false,
  });
  const strong = computeConfidence({
    intentResolved: true,
    intentKnown: true,
    knowledgeCount: 3,
    patternCount: 3,
    hasStyleProfile: true,
  });
  assert.ok(strong > weak);
  assert.equal(strong, 1);
  assert.ok(weak < 0.5);
});

/* ====================== 6. GALLYUTSINATSIYA TO‘SIG‘I ===================== */

test("manbada yo‘q son ushlanadi", () => {
  const allowed = ["Profil joylash narxi 38 ming so‘m."];
  assert.deepEqual(findUnsupportedNumbers("Narxi 38 ming so‘m.", allowed), []);
  assert.deepEqual(findUnsupportedNumbers("Narxi 45 ming so‘m.", allowed), ["45"]);
});

test("son ichma-ich moslashtirilmaydi", () => {
  // "5000" ni "500000" ichidan topib "tasdiqlangan" deb ko'rsatish —
  // aynan shu xato eng xavfli edi.
  assert.deepEqual(findUnsupportedNumbers("5 000 so‘m", ["500 000 so‘m"]), ["5 000"]);
  assert.deepEqual(findUnsupportedNumbers("500 000 so‘m", ["500000 so‘m"]), []);
});

test("ro‘yxat raqami va bir xonali son fakt deb hisoblanmaydi", () => {
  assert.deepEqual(findUnsupportedNumbers("1. Birinchi\n2. Ikkinchi", []), []);
  assert.deepEqual(findUnsupportedNumbers("2 kun ichida tayyor", []), []);
  // Lekin ikki xonali qiymat tekshiriladi.
  assert.deepEqual(findUnsupportedNumbers("14 kun ichida tayyor", []), ["14"]);
});

test("promt fakt to‘qishni ochiq taqiqlaydi", () => {
  const prompt = buildTestChatSystemPrompt({
    knowledge: [],
    patterns: [],
    style: null,
    missingKnowledge: false,
  });
  assert.match(prompt, /O‘YLAB TOPMA/);
  assert.match(prompt, /narx, muddat, sana, foiz/);
});

test("generator javobni YARATILGANDAN KEYIN ham tekshiradi", () => {
  const source = readFileSync(join(ROOT, "src/lib/sales/test-chat.ts"), "utf8");
  assert.match(source, /findUnsupportedNumbers\(reply, allowedTexts\)/);
  assert.match(source, /unsupportedNumbers/);
});

/* ===================== 7. TELEGRAM'GA HECH NARSA KETMAYDI ================ */

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * CHAQIRUV shakli qidiriladi, so'zning o'zi emas: sahifada adminга
 * "sendMessage himoyasi joyida" deb YOZILGAN va bu foydali matn —
 * uni o'chirish tekshiruvni kuchaytirmaydi, hujjatni yo'qotadi.
 */
const OUTBOUND = "sendMessage|sendPhoto|sendDocument|copyMessage|forwardMessage|answerCallbackQuery";
const OUTBOUND_CALL = new RegExp(
  `(?:\\b(?:${OUTBOUND})\\s*\\()|(?:["'\`/](?:${OUTBOUND})["'\`])`,
);

test("sinov modullari Telegram’ga umuman tegmaydi", () => {
  for (const file of [
    "src/lib/sales/test-chat.ts",
    "src/lib/sales/test-chat-prompt.ts",
    "src/lib/sales/retrieval.ts",
    "src/app/(admin)/ai-sotuv/sinov/page.tsx",
    "src/app/(admin)/ai-sotuv/sinov/test-chat.tsx",
  ]) {
    const code = stripComments(readFileSync(join(ROOT, file), "utf8"));
    assert.ok(!OUTBOUND_CALL.test(code), `${file} da outbound metod CHAQIRILYAPTI`);
    assert.ok(!code.includes("telegram-sales-api"), `${file} transportni import qilyapti`);
    assert.ok(!code.includes("api.telegram.org"), file);
  }
});

test("mavjud avto-javob himoyasi OLIB TASHLANMAGAN", () => {
  const api = readFileSync(join(ROOT, "src/lib/sales/telegram-sales-api.ts"), "utf8");
  assert.match(api, /SalesAutoReplyBlockedError/);
  assert.match(api, /ALLOWED_SALES_BOT_METHODS/);
  assert.match(api, /export function assertAllowedSalesMethod/);
});

/* ==================== 8. RUXSATSIZ ADMIN KIRA OLMAYDI =================== */

test("sinov chat sales.learn talab qiladi", () => {
  // Ko'rish ruxsati yetarli emas: har xabar pullik AI chaqiruvi.
  assert.equal(hasPermission(["viewer"], "sales.view"), true);
  assert.equal(hasPermission(["viewer"], "sales.learn"), false);
  assert.equal(hasPermission(["moderator"], "sales.learn"), false);
  assert.equal(hasPermission(["analyst"], "sales.learn"), false);
  assert.equal(hasPermission(["editor"], "sales.view"), false);

  assert.equal(hasPermission(["admin"], "sales.learn"), true);
  assert.equal(hasPermission(["super_admin"], "sales.learn"), true);
});

test("server action ruxsatni O‘ZI qayta tekshiradi", () => {
  // UI da tugmani yashirish himoya emas — action mustaqil tekshirishi shart.
  const actions = readFileSync(join(ROOT, "src/lib/actions/sales.ts"), "utf8");
  const block = actions.slice(actions.indexOf("export async function sendTestChatMessageAction"));
  assert.match(block.slice(0, 400), /await requirePermission\("sales\.learn"\)/);

  const page = readFileSync(join(ROOT, "src/app/(admin)/ai-sotuv/sinov/page.tsx"), "utf8");
  assert.match(page, /await requirePermission\("sales\.view"\)/);
  assert.match(page, /hasPermission\(ctx\.roles, "sales\.learn"\)/);
});

test("kontekst va xabar uzunligi cheklangan", () => {
  const actions = readFileSync(join(ROOT, "src/lib/actions/sales.ts"), "utf8");
  assert.match(actions, /history: z\.array\(testChatTurnSchema\)\.max\(20\)/);
  assert.match(actions, /message: z\.string\(\)\.trim\(\)\.min\(1[^)]*\)\.max\(2000\)/);
});
