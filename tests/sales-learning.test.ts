import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_RECENCY_BUCKETS,
  ageInDays,
  bucketLabel,
  parseRecencyBuckets,
  recencyWeight,
  weightForDate,
} from "../src/lib/sales/recency.ts";
import { computeLearningProgress, percentOf, scopeNote } from "../src/lib/sales/progress.ts";
import { redactPii, containsPii, isRedacted, PII_PLACEHOLDERS } from "../src/lib/sales/redact.ts";
import { analyzeStyle, maskNumbers, type StyleSample } from "../src/lib/sales/style.ts";
import {
  buildTranscript,
  EXTRACTION_SYSTEM_PROMPT,
  knowledgeDedupeKey,
  normalizeExtraction,
  parseModelJson,
  transcriptHash,
  type TranscriptMessage,
} from "../src/lib/sales/knowledge.ts";
import { KNOWLEDGE_CATEGORIES } from "../src/lib/sales/types.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const NOW = new Date("2026-09-07T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

/* =========================== RECENCY OG‘IRLIKLARI ========================= */

test("og‘irliklar texnik topshiriqdagi jadvalga aynan mos", () => {
  const cases: Array<[number, number]> = [
    [0, 1.0],
    [7, 1.0],
    [8, 0.8],
    [30, 0.8],
    [31, 0.5],
    [90, 0.5],
    [91, 0.3],
    [180, 0.3],
    [181, 0.15],
    [3650, 0.15],
  ];
  for (const [age, expected] of cases) {
    assert.equal(recencyWeight(age), expected, `${age} kun`);
  }
});

test("sana bo‘yicha og‘irlik hisoblanadi", () => {
  assert.equal(weightForDate(daysAgo(2), NOW), 1.0);
  assert.equal(weightForDate(daysAgo(45), NOW), 0.5);
  assert.equal(weightForDate(daysAgo(400), NOW), 0.15);
  // Kelajakdagi sana 0 yosh beradi, minus emas.
  assert.equal(ageInDays(new Date(NOW.getTime() + 86_400_000), NOW), 0);
});

test("og‘irliklar konfiguratsiya orqali o‘zgaradi", () => {
  const custom = parseRecencyBuckets([
    { maxAgeDays: 14, weight: 1 },
    { maxAgeDays: null, weight: 0.5 },
  ]);
  assert.equal(custom.length, 2);
  assert.equal(recencyWeight(10, custom), 1);
  assert.equal(recencyWeight(100, custom), 0.5);
});

test("nosoz konfiguratsiya standart jadvalga qaytadi", () => {
  // Jimgina 0 og'irlik bilan ishlash uslub profilini bo'shatib qo'yardi.
  for (const bad of [
    null,
    [],
    "matn",
    [{ maxAgeDays: 7 }],
    [{ maxAgeDays: 7, weight: 5 }],
    [{ maxAgeDays: -1, weight: 0.5 }],
    [{ maxAgeDays: 7, weight: 0 }],
  ]) {
    assert.deepEqual(parseRecencyBuckets(bad), DEFAULT_RECENCY_BUCKETS, JSON.stringify(bad));
  }
});

test("bucket yorlig‘i oraliqni to‘g‘ri ko‘rsatadi", () => {
  const labels = DEFAULT_RECENCY_BUCKETS.map((b) => bucketLabel(b));
  assert.deepEqual(labels, ["0–7 kun", "8–30 kun", "31–90 kun", "91–180 kun", "181+ kun"]);
});

/* =========================== O‘RGANISH PROGRESSI ========================== */

test("progress maxraji bilan birga ko‘rsatiladi", () => {
  const progress = computeLearningProgress({ total: 420, learned: 187, pending: 233 });
  assert.equal(progress.label, "187 / 420");
  assert.equal(progress.percent, 44.5);
  assert.equal(progress.percentLabel, "44.5%");
});

test("maxraj 0 bo‘lsa foiz 0, bo‘linish xatosi yo‘q", () => {
  const progress = computeLearningProgress({ total: 0, learned: 0 });
  assert.equal(progress.percent, 0);
  assert.equal(progress.label, "0 / 0");
  assert.equal(percentOf(5, 0), 0);
});

test("progress matni Telegram tarixini o‘rgangandek ko‘rsatmaydi", () => {
  const note = scopeNote(420);
  // Maxraj nima ekani ochiq aytilishi shart.
  assert.ok(note.includes("420"));
  assert.ok(/saqlangan yoki import qilingan/.test(note));
  // "Butun tarix o'rganildi" degan ma'no chiqmasligi kerak.
  assert.ok(/EMAS/.test(note));
  assert.ok(/Bot API/.test(note));
  assert.ok(!/barcha eski chatlar o‘rganildi/i.test(note));
});

test("maxraj berilmasa holatlar yig‘indisidan tiklanadi", () => {
  const progress = computeLearningProgress({
    learned: 10,
    pending: 5,
    failed: 3,
    skipped: 2,
    learning: 0,
  });
  assert.equal(progress.total, 20);
  assert.equal(progress.percent, 50);
});

/* ============================== PII REDAKSIYASI =========================== */

test("telefon, karta, hisob, hujjat, email va token maskalanadi", () => {
  const cases: Array<[string, string]> = [
    ["Raqamim +998 90 123 45 67", PII_PLACEHOLDERS.phone],
    ["901234567 ga yozing", PII_PLACEHOLDERS.phone],
    ["Karta 8600 1234 5678 9012", PII_PLACEHOLDERS.card],
    ["Hisob 20208000900123456789", PII_PLACEHOLDERS.account],
    ["JSHSHIR 30101995123456", PII_PLACEHOLDERS.document],
    ["Pasport AB1234567", PII_PLACEHOLDERS.document],
    ["aziz@mail.uz", PII_PLACEHOLDERS.email],
    ["token: 123456789:AAHkabcdefghijklmnopqrstuvwxyz012345", PII_PLACEHOLDERS.secret],
  ];
  for (const [input, placeholder] of cases) {
    const result = redactPii(input);
    assert.ok(result.text.includes(placeholder), `${input} -> ${result.text}`);
    assert.ok(!/\d{7,}/.test(result.text.replace(/\[.*?\]/g, "")), result.text);
  }
});

test("narx maskalanmaydi — u sotuv fakti", () => {
  // Bu qoida buzilsa bilim bazasi narxsiz qolardi.
  for (const input of [
    "Narxi 500 000 so‘m",
    "990 000 so‘m to‘lang",
    "1 200 000 so‘m oyiga",
    "Chegirma 15% va 450 000 so‘m",
    "+5 000 000 so‘mgacha byudjet",
  ]) {
    assert.equal(redactPii(input).text, input, input);
    assert.equal(containsPii(input), false, input);
  }
});

test("oddiy gap sir deb hisoblanmaydi", () => {
  assert.equal(redactPii("Parol yangilandi, endi kiring").text, "Parol yangilandi, endi kiring");
});

test("isRedacted redaksiyadan keyingi so‘nggi to‘siq", () => {
  assert.equal(isRedacted("Narxi 500 000 so‘m"), true);
  assert.equal(isRedacted("Raqam +998901234567"), false);
  assert.equal(isRedacted(redactPii("Raqam +998901234567").text), true);
});

/* ============================== USLUB O‘RGANISH =========================== */

const sample = (text: string, ageDays: number, direction: "incoming" | "outgoing" = "outgoing"): StyleSample => ({
  text,
  sentAt: daysAgo(ageDays),
  direction,
  conversationId: `c-${ageDays}`,
});

test("uslub faqat CHIQUVCHI xabarlardan o‘rganiladi", () => {
  const analysis = analyzeStyle(
    [
      sample("Assalomu alaykum! Sizga qanday yordam bera olaman?", 1),
      sample("salom bratan qancha turadi", 1, "incoming"),
    ],
    { now: NOW },
  );
  assert.equal(analysis.sampleMessageCount, 1);
  assert.equal(analysis.profile.address.form, "siz");
});

test("yaqindagi xabar uslubga kuchliroq ta’sir qiladi", () => {
  const recentHeavy = analyzeStyle(
    [
      sample("Rahmat 😊", 1),
      sample("Zo‘r 🚀", 2),
      sample("Ajoyib 🎉", 3),
      sample("Hurmatli mijoz, arizangiz qabul qilindi.", 300),
      sample("Hurmatli mijoz, hujjat tayyor.", 320),
      sample("Hurmatli mijoz, kutamiz.", 340),
    ],
    { now: NOW },
  );
  // Uch yangi xabar (1.00) uch eskisini (0.15) bosib ketadi.
  assert.ok(
    recentHeavy.profile.emoji.usageRate > 0.8,
    `emoji ulushi ${recentHeavy.profile.emoji.usageRate}`,
  );

  // Aynan shu namunalar teskari yoshda bo'lsa natija ham teskari.
  const oldHeavy = analyzeStyle(
    [
      sample("Rahmat 😊", 300),
      sample("Zo‘r 🚀", 320),
      sample("Ajoyib 🎉", 340),
      sample("Hurmatli mijoz, arizangiz qabul qilindi.", 1),
      sample("Hurmatli mijoz, hujjat tayyor.", 2),
      sample("Hurmatli mijoz, kutamiz.", 3),
    ],
    { now: NOW },
  );
  assert.ok(
    oldHeavy.profile.emoji.usageRate < 0.2,
    `emoji ulushi ${oldHeavy.profile.emoji.usageRate}`,
  );
});

test("siz/sen, salomlashish, CTA va yozuv aniqlanadi", () => {
  const analysis = analyzeStyle(
    [
      sample("Assalomu alaykum! Sizga narxlarni yuboraman, ariza qoldiring.", 1),
      sample("Hurmatli mijoz, sizning arizangiz qabul qilindi.", 2),
    ],
    { now: NOW },
  );
  const p = analysis.profile;
  assert.equal(p.address.form, "siz");
  assert.ok(p.greeting.usageRate > 0);
  assert.ok(p.greeting.top.some((g) => g.phrase === "assalomu alaykum"));
  assert.ok(p.cta.usageRate > 0);
  assert.equal(p.script.dominant, "lotin");
  assert.ok(p.sentence.averageWords > 0);
});

test("sen shakli ham aniqlanadi", () => {
  const analysis = analyzeStyle(
    [sample("senga hozir yuboraman", 1), sample("sening arizang tayyor", 2)],
    { now: NOW },
  );
  assert.equal(analysis.profile.address.form, "sen");
});

/* ---------------- FAKT / USLUB AJRATILISHI (talab 6) ---------------- */

test("maskNumbers barcha sonni olib tashlaydi, so‘zlarni saqlaydi", () => {
  assert.equal(maskNumbers("Narxi 500 000 so‘m"), "Narxi {SON} so‘m");
  assert.equal(maskNumbers("12 oy davomida 3 marta"), "{SON} oy davomida {SON} marta");
  assert.ok(!/\d/.test(maskNumbers("Chegirma 15% — 450 000 so‘m")));
});

test("uslub profilida haqiqiy narx SAQLANMAYDI", () => {
  const analysis = analyzeStyle(
    [
      sample("Narxi 500 000 so‘m, chegirma bilan 450 000 so‘m.", 1),
      sample("To‘lov 1 200 000 so‘m, bo‘lib to‘lash mumkin.", 2),
    ],
    { now: NOW },
  );
  const p = analysis.profile;

  assert.ok(p.price.mentionRate > 0, "narx tilga olingani qayd etilishi kerak");
  assert.ok(p.price.templates.length > 0, "shablon chiqishi kerak");
  assert.ok(p.price.templates.some((t) => t.includes("{SON}")));

  // Profilga yoziladigan HAR BIR satr raqamsiz bo'lishi shart: fakt
  // (narx) Knowledge Base tomonida qoladi, uslubda emas.
  const stored = [
    ...p.price.templates,
    ...p.greeting.top.map((x) => x.phrase),
    ...p.cta.top.map((x) => x.phrase),
    ...p.objection.openers.map((x) => x.phrase),
  ];
  for (const line of stored) {
    assert.ok(!/\d/.test(line), `uslub profilida son qoldi: ${line}`);
  }
  assert.ok(!p.price.templates.join(" ").includes("500"));
  assert.ok(!p.price.templates.join(" ").includes("450"));
});

test("bo‘sh namunada profil yiqilmaydi", () => {
  const analysis = analyzeStyle([], { now: NOW });
  assert.equal(analysis.sampleMessageCount, 0);
  assert.equal(analysis.weightedSample, 0);
  assert.equal(analysis.profile.address.form, "noaniq");
});

/* ============================ BILIM AJRATISH ============================= */

const messages: TranscriptMessage[] = [
  {
    id: "m0",
    direction: "incoming",
    text: "Salom, narxi qancha? Raqamim +998 90 123 45 67",
    messageType: "text",
    sentAt: daysAgo(1),
  },
  {
    id: "m1",
    direction: "outgoing",
    text: "Assalomu alaykum! Narxi 500 000 so‘m.",
    messageType: "text",
    sentAt: daysAgo(1),
  },
  { id: "m2", direction: "incoming", text: null, messageType: "photo", sentAt: daysAgo(1) },
];

test("transkript AI’ga chiqishdan oldin redaksiya qilinadi", () => {
  const transcript = buildTranscript(messages);
  assert.ok(!transcript.text.includes("998 90 123 45 67"));
  assert.ok(transcript.text.includes(PII_PLACEHOLDERS.phone));
  // Narx esa qoladi — ajratilishi kerak bo'lgan faktning o'zi.
  assert.ok(transcript.text.includes("500 000"));
  assert.ok(transcript.redactedKinds.includes("phone"));
});

test("matnsiz xabar satr bo‘lib qoladi, lekin unga bilim bog‘lanmaydi", () => {
  const transcript = buildTranscript(messages);
  assert.ok(transcript.text.includes("[2] MIJOZ: (photo)"));
  assert.equal(transcript.indexToMessageId.has(2), false);
  assert.equal(transcript.lineCount, 2);
});

test("transkript xeshi barqaror — o‘zgarmagan suhbat qayta o‘rganilmaydi", () => {
  const a = transcriptHash(buildTranscript(messages).text);
  const b = transcriptHash(buildTranscript(messages).text);
  assert.equal(a, b);

  const changed = transcriptHash(
    buildTranscript([
      ...messages,
      { id: "m3", direction: "incoming", text: "Rahmat", messageType: "text", sentAt: daysAgo(0) },
    ]).text,
  );
  assert.notEqual(a, changed);
});

test("har bir bilim manba xabarga bog‘lanadi", () => {
  const transcript = buildTranscript(messages);
  const { items } = normalizeExtraction(
    {
      items: [
        { category: "price", question: "Narxi qancha?", answer: "500 000 so‘m", sourceIndex: 1 },
      ],
    },
    { conversationId: "conv-1", indexToMessageId: transcript.indexToMessageId },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceConversationId, "conv-1");
  assert.equal(items[0].sourceMessageId, "m1");
  assert.ok(items[0].sourceExcerpt);
});

test("manbasiz bilim RAD ETILADI", () => {
  const transcript = buildTranscript(messages);
  const { items, rejected } = normalizeExtraction(
    {
      items: [
        { category: "price", answer: "manbasiz" },
        { category: "price", answer: "mavjud bo‘lmagan satr", sourceIndex: 99 },
        { category: "price", answer: "matnsiz xabarga ishora", sourceIndex: 2 },
      ],
    },
    { conversationId: "conv-1", indexToMessageId: transcript.indexToMessageId },
  );
  assert.equal(items.length, 0);
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((r) => r.reason.includes("sourceIndex")));
});

test("noma’lum turkum va bo‘sh javob rad etiladi", () => {
  const transcript = buildTranscript(messages);
  const { items, rejected } = normalizeExtraction(
    {
      items: [
        { category: "uslub", answer: "ohang samimiy", sourceIndex: 1 },
        { category: "price", answer: "   ", sourceIndex: 1 },
        { category: "price", sourceIndex: 1 },
        "matn",
      ],
    },
    { conversationId: "conv-1", indexToMessageId: transcript.indexToMessageId },
  );
  assert.equal(items.length, 0);
  assert.equal(rejected.length, 4);
});

test("modeldan kelgan PII ham saqlashdan oldin maskalanadi", () => {
  const transcript = buildTranscript(messages);
  const { items } = normalizeExtraction(
    {
      items: [
        {
          category: "payment",
          question: "Qayerga to‘layman?",
          answer: "Karta 8600 1234 5678 9012 ga o‘tkazing",
          sourceIndex: 1,
        },
      ],
    },
    { conversationId: "conv-1", indexToMessageId: transcript.indexToMessageId },
  );
  assert.equal(items.length, 1);
  assert.ok(!items[0].answer.includes("8600 1234"));
  assert.ok(items[0].answer.includes(PII_PLACEHOLDERS.card));
});

test("dedupe kaliti bir xil mazmun uchun bir xil", () => {
  const a = knowledgeDedupeKey("price", "Narxi qancha?", "500 000 so‘m");
  const b = knowledgeDedupeKey("price", "  narxi   qancha? ", "500 000 so‘m.");
  const c = knowledgeDedupeKey("faq", "Narxi qancha?", "500 000 so‘m");
  assert.equal(a, b, "bo‘shliq va tinish belgisi kalitni o‘zgartirmasligi kerak");
  assert.notEqual(a, c, "turkum boshqa bo‘lsa kalit ham boshqa");
});

test("bir yugurishdagi takror element ikki marta qo‘shilmaydi", () => {
  const transcript = buildTranscript(messages);
  const { items, rejected } = normalizeExtraction(
    {
      items: [
        { category: "price", answer: "500 000 so‘m", sourceIndex: 1 },
        { category: "price", answer: "500 000 so‘m", sourceIndex: 1 },
      ],
    },
    { conversationId: "conv-1", indexToMessageId: transcript.indexToMessageId },
  );
  assert.equal(items.length, 1);
  assert.equal(rejected.length, 1);
});

test("model javobi JSON bo‘lmasa yiqilmaydi", () => {
  assert.deepEqual(parseModelJson('{"items":[]}'), { items: [] });
  assert.deepEqual(parseModelJson('Mana javob: {"items":[]} rahmat'), { items: [] });
  assert.equal(parseModelJson("umuman json emas"), null);
  assert.equal(parseModelJson(null), null);
  assert.deepEqual(normalizeExtraction(null, {
    conversationId: "c",
    indexToMessageId: new Map(),
  }).items, []);
});

test("promt 12 turkumning hammasini sanaydi va uslub baholashni taqiqlaydi", () => {
  for (const category of KNOWLEDGE_CATEGORIES) {
    assert.ok(EXTRACTION_SYSTEM_PROMPT.includes(category), category);
  }
  assert.ok(/Uslub, ohang yoki emoji haqida BAHO BERMA/.test(EXTRACTION_SYSTEM_PROMPT));
  assert.ok(/sourceIndex/.test(EXTRACTION_SYSTEM_PROMPT));
});

/* ============================ MIGRATSIYA KAFOLATLARI ===================== */

const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260907140000_sales_ai_bot.sql"),
  "utf8",
);

test("xabarlar jadvalida takrorlanishni to‘xtatuvchi unikal indeks bor", () => {
  assert.ok(
    /create unique index if not exists uq_sales_messages_tg\s+on public\.sales_messages\(business_connection_id, chat_id, telegram_message_id\)/.test(
      MIGRATION,
    ),
  );
  // Qisman indeks `on conflict` nishoni bo‘la olmaydi — upsert shunda sinadi.
  const indexLine = MIGRATION.slice(MIGRATION.indexOf("uq_sales_messages_tg"));
  assert.ok(!indexLine.slice(0, 200).includes("where"));
});

test("bilim yozuvi qoralama bo‘lib tug‘iladi va manbaga bog‘langan", () => {
  assert.ok(/status text not null default 'draft'/.test(MIGRATION));
  assert.ok(
    /source_conversation_id uuid not null references public\.sales_conversations\(id\)/.test(
      MIGRATION,
    ),
  );
});

test("xom yozishma uchun public RLS policy YO‘Q", () => {
  // Policy'lar `format()` ichida yaratilgani uchun apostroflar ikkilangan
  // (''sales.view''); solishtirishdan oldin normallashtiriladi.
  const sql = MIGRATION.replace(/''/g, "'");

  // legacy_posts dagi kabi "published ... is public" policy bu jadvallarga
  // qo‘yilmasligi shart: bu mijozning shaxsiy yozishmasi.
  assert.ok(!/to anon/.test(sql));
  assert.ok(!/using \(true\)/.test(sql));
  assert.ok(!/for select\s+using \(/.test(sql), "rolsiz select policy topildi");

  assert.ok(sql.includes("has_permission('sales.view')"));
  assert.ok(sql.includes("has_permission('sales.manage')"));
  assert.ok(sql.includes("enable row level security"));
  // Xom xabarlar jadvali RLS yoqiladigan ro‘yxatda bo‘lishi shart.
  assert.ok(/'sales_messages'/.test(MIGRATION));
});

test("standart og‘irliklar migratsiyada ham bir xil", () => {
  for (const weight of ["1.00", "0.80", "0.50", "0.30", "0.15"]) {
    assert.ok(MIGRATION.includes(weight), weight);
  }
});
