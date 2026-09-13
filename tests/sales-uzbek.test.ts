import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkOutboundLanguage,
  isUzbekGreeting,
  ALLOWED_PROPER_NOUNS,
  UZBEK_ONLY_RULE,
} from "../src/lib/sales/flow/language-guard.ts";
import {
  checkRepetition,
  similarity,
  buildRewriteInstruction,
  buildAlreadySaidBlock,
  REPETITION_THRESHOLD,
} from "../src/lib/sales/flow/repetition.ts";
import {
  CANONICAL_BENEFITS_TEXT,
  CANONICAL_BENEFITS_TEMPLATE_KEY,
  isGeneralBenefitsQuestion,
  benefitsAlreadySent,
} from "../src/lib/sales/flow/canonical-benefits.ts";
import {
  parseCommercial,
  buildCommercialBlock,
  formatSom,
  EMPTY_COMMERCIAL,
} from "../src/lib/sales/commercial-facts.ts";
import { checkReplyQuality } from "../src/lib/sales/flow/reply-quality.ts";
import { buildTestChatSystemPrompt } from "../src/lib/sales/test-chat-prompt.ts";

/* ===================== 1. FAQAT O'ZBEKCHA (7, 8-band) =================== */

test("inglizcha salomlashish bloklanadi", () => {
  // "Hi" xabarning BIRINCHI so'zi — mijoz uni birinchi ko'radi va
  // bir qarashda "bu bot" degan xulosa chiqaradi.
  for (const body of ["Hi, narxi 38 ming so'm.", "Hello! Qanday yordam bera olaman?", "Hey, salom"]) {
    const result = checkOutboundLanguage(body);
    assert.equal(result.ok, false, body);
    assert.ok(result.violations.includes("english_greeting"), body);
  }
});

test("inglizcha jumla bloklanadi", () => {
  const result = checkOutboundLanguage("Thank you for your message, we will help you soon.");
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes("english_body"));
});

test("ruscha javob ham bloklanadi", () => {
  const result = checkOutboundLanguage("Здравствуйте, спасибо за ваше сообщение.");
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes("russian_body"));
});

test("ATOQLI OTLAR javobni bloklamaydi", () => {
  // Bu eng muhim tekshiruv: "Google'da chiqasiz" — bu o'zbekcha jumla.
  // Uni inglizcha deb bloklash foydali javoblarni yo'q qilardi.
  const bodies = [
    "Maqolangiz Google, Yandex va Bing tizimlarida chiqadi.",
    "Instagram, Facebook, TikTok va YouTube’da ko‘k nishon olishga yordam beradi.",
    "ChatGPT, Gemini va Copilot siz haqingizda ma’lumot bera oladi.",
    "Wikipedia sahifangiz uchun ishonchli manba bo‘ladi.",
    "AdabiyotX platformasida kitobingizni bepul nashr etasiz.",
    "Project Found orqali bepul veb-sayt olasiz.",
    "Recommendation Letter tayyorlab beramiz.",
  ];
  for (const body of bodies) {
    assert.equal(checkOutboundLanguage(body).ok, true, `noto‘g‘ri bloklandi: ${body}`);
  }
});

test("texnik topshiriqdagi hamma nom ro‘yxatda", () => {
  for (const noun of [
    "Google", "Yandex", "Bing", "ChatGPT", "Gemini", "Copilot",
    "Instagram", "Facebook", "TikTok", "YouTube", "Wikipedia",
    "AdabiyotX", "Project Found", "Recommendation Letter",
  ]) {
    assert.ok(ALLOWED_PROPER_NOUNS.includes(noun), noun);
  }
});

test("oddiy o‘zbekcha javob o‘tadi", () => {
  for (const body of [
    "Assalomu alaykum! Ensiklopediyaga qo‘shilish bo‘yicha yordam beraman.",
    "Ha, sertifikat ham beriladi.",
    "Yo‘q, bizda yillik texnik badal mavjud.",
    "Hozirgi narx 38 000 so‘m.",
  ]) {
    assert.equal(checkOutboundLanguage(body).ok, true, body);
  }
});

test("o‘rgangan inglizcha salomlashuv promptga TUSHMAYDI", () => {
  // Bu "Hi" muammosining eng kutilmagan manbai edi: uslub profili
  // adminning "Hi" ini namuna sifatida olib, promptda uni BUYURARDI.
  assert.equal(isUzbekGreeting("Hi"), false);
  assert.equal(isUzbekGreeting("Hello"), false);
  assert.equal(isUzbekGreeting("Assalomu alaykum"), true);
  assert.equal(isUzbekGreeting("Salom"), true);
  assert.equal(isUzbekGreeting("Xayrli kun"), true);
});

test("til qoidasi promptda BIRINCHI o‘rinda turadi", () => {
  // Oxirgi bandda turganda model uni e'tiborsiz qoldirardi.
  const prompt = buildTestChatSystemPrompt({
    knowledge: [],
    patterns: [],
    style: null,
    missingKnowledge: false,
  });
  const rules = prompt.slice(prompt.indexOf("QAT’IY QOIDALAR:"));
  const languageAt = rules.indexOf("FAQAT O‘ZBEK TILIDA");
  const factAt = rules.indexOf("O‘YLAB TOPMA");
  assert.ok(languageAt !== -1, "til qoidasi bo‘lsin");
  assert.ok(languageAt < factAt, "til qoidasi birinchi bo‘lsin");
});

test("qoida mijoz boshqa tilda yozgan holatni NOMMA-NOM aytadi", () => {
  // Umumiy "o'zbekcha yoz" til aks ettirish moyilligini yenga olmasdi.
  assert.match(UZBEK_ONLY_RULE, /ingliz yoki rus tilida yozsa HAM/);
  assert.match(UZBEK_ONLY_RULE, /Hi/);
});

test("sifat darvozasi inglizcha javobni BLOKLAYDI", () => {
  const result = checkReplyQuality({
    body: "Hi, thank you for your message.",
    unsupportedNumbers: [],
    discountApproved: true,
    paymentStatus: "none",
  });
  assert.equal(result.ok, false);
  assert.ok(result.blocked.includes("not_uzbek"));
});

/* ================== 2. TAKRORLANMASLIK (9-band) ========================= */

test("aynan bir xil javob takror deb topiladi", () => {
  const body = "Hozirgi narx 38 000 so‘m. Bu bir yillik texnik xizmatni o‘z ichiga oladi.";
  const result = checkRepetition(body, [body]);
  assert.equal(result.repeated, true);
  assert.equal(result.score, 1);
});

test("bitta so‘z o‘zgargan javob HAM takror", () => {
  // Aynan moslik tekshiruvi buni o'tkazib yuborardi, mijoz uchun esa
  // xabar o'sha-o'sha bo'lib qolaverardi.
  const first = "Hozirgi narx 38 000 so‘m. Bu bir yillik texnik xizmatni o‘z ichiga oladi.";
  const second = "Hozirgi narx 38 000 so‘m. Bu bir yillik texnik xizmatni o‘z ichiga oladi!";
  assert.equal(checkRepetition(second, [first]).repeated, true);
});

test("boshqacha ifodalangan javob takror EMAS", () => {
  // Faktni qayta aytish taqiqlanmaydi — xabarni nusxalash taqiqlanadi.
  const first = "Hozirgi narx 38 000 so‘m. Bu bir yillik texnik xizmatni o‘z ichiga oladi.";
  const second =
    "Yuqorida aytganimdek, siz uchun o‘sha 38 ming so‘mlik taklif amal qilmoqda.";
  const result = checkRepetition(second, [first]);
  assert.equal(result.repeated, false, `o‘xshashlik ${result.score}`);
});

test("qisqa tasdiq javoblari takror deb hisoblanmaydi", () => {
  // "Ha, albatta" ni ikki marta aytish mutlaqo normal.
  assert.equal(checkRepetition("Ha, albatta.", ["Ha, albatta."]).repeated, false);
});

test("mijozning gapini takrorlash bloklanmaydi", () => {
  // Solishtirish FAQAT AI xabarlari bilan — mijoz savolini qaytarish
  // tabiiy suhbat usuli.
  const result = checkRepetition(
    "Siz sertifikat haqida so‘radingiz. Ha, sertifikat beriladi va u rasmiy hujjat bo‘ladi.",
    [],
  );
  assert.equal(result.repeated, false);
});

test("o‘xshashlik chegarasi oqilona", () => {
  assert.ok(REPETITION_THRESHOLD > 0.5 && REPETITION_THRESHOLD < 0.9);
  assert.equal(similarity("bir xil matn bu yerda", "bir xil matn bu yerda"), 1);
  assert.equal(similarity("mutlaqo boshqa gap", "hech qanday aloqasi yo‘q"), 0);
});

test("qayta yozish ko‘rsatmasi FAKTNI o‘zgartirishni so‘ramaydi", () => {
  // "Boshqacha ayt" deyilsa model narxni ham o'zgartirib yuborishi
  // mumkin edi — bu xatoning eng qimmat turi.
  const instruction = buildRewriteInstruction("Hozirgi narx 38 000 so‘m.");
  assert.match(instruction, /FAKTLAR O‘ZGARMAYDI/);
  assert.match(instruction, /narx, muddat va shartlar o‘sha-o‘sha/);
});

test("“allaqachon aytilgan” bloki modelga beriladi", () => {
  const block = buildAlreadySaidBlock(["Narx 38 ming so‘m.", "Sertifikat beriladi."]);
  assert.match(block, /ALLAQACHON YOZGANSAN/);
  assert.ok(block.includes("38 ming"));
});

test("sifat darvozasi takrorni bloklaydi", () => {
  const body = "Hozirgi narx 38 000 so‘m va bu bir yillik texnik xizmatni o‘z ichiga oladi.";
  const result = checkReplyQuality({
    body,
    unsupportedNumbers: [],
    discountApproved: true,
    paymentStatus: "none",
    previousAssistantMessages: [body],
  });
  assert.equal(result.ok, false);
  assert.ok(result.blocked.includes("repeated_message"));
});

/* ============== 3. KANONIK FOYDALAR MATNI (12-band) ===================== */

test("kanonik matn BUTUN va o‘zgarmagan", () => {
  assert.ok(CANONICAL_BENEFITS_TEXT.startsWith("Ushbu xabarda sizga qo‘shimcha"));
  assert.ok(CANONICAL_BENEFITS_TEXT.includes("https://liderlar.uz/ommaviy_ofertasi"));
  assert.ok(CANONICAL_BENEFITS_TEXT.trimEnd().endsWith("@uzlye_rasmiy"));
  // O'n to'rtta band — bittasi ham tushib qolmasin.
  assert.equal((CANONICAL_BENEFITS_TEXT.match(/✅/g) ?? []).length, 14);
});

test("kanonik matn Telegram chegarasiga sig‘adi", () => {
  // 4096 dan oshsa Telegram butun yuborishni rad etadi va mijoz
  // HECH NARSA olmaydi.
  assert.ok(CANONICAL_BENEFITS_TEXT.length < 4096, `${CANONICAL_BENEFITS_TEXT.length} belgi`);
});

test("umumiy “nima beradi?” savoli tanilади", () => {
  for (const q of [
    "menga nima beradi",
    "nima foydasi bor",
    "afzalliklari nima",
    "imkoniyatlari qanday",
    "nega kirishim kerak",
  ]) {
    assert.equal(isGeneralBenefitsQuestion(q), true, q);
  }
});

test("ANIQ savol kanonik matnni CHAQIRMAYDI", () => {
  // "Sertifikat bormi?" ga o'n to'rt bandli matn yuborish — savolga
  // javob bermaslik va mijozni ko'mib tashlash (8-band).
  for (const q of ["sertifikat ham beriladimi", "narxi qancha", "google da chiqadimi", "salom"]) {
    assert.equal(isGeneralBenefitsQuestion(q), false, q);
  }
});

test("kanonik matn IKKINCHI marta yuborilmaydi", () => {
  assert.equal(benefitsAlreadySent([]), false);
  assert.equal(benefitsAlreadySent(["price_offer"]), false);
  assert.equal(benefitsAlreadySent([CANONICAL_BENEFITS_TEMPLATE_KEY]), true);
});

test("kanonik matn sifat darvozasidan CHETDA qoladi", () => {
  // U tahririyat yozgan rasmiy matn; uzunligi va tuzilishi uchun
  // model javobiga qo'yiladigan mezonlar unga tegishli emas.
  const result = checkReplyQuality({
    body: CANONICAL_BENEFITS_TEXT,
    unsupportedNumbers: [],
    discountApproved: true,
    paymentStatus: "none",
    exactTemplate: true,
  });
  assert.equal(result.ok, true, `bloklandi: ${result.blocked}`);
});

/* ============ 4. TIJORIY FAKTLARNING YAGONA MANBASI (20-band) =========== */

test("narx bitta joydan o‘qiladi", () => {
  const facts = parseCommercial({
    regularPrice: 100000,
    activePrice: 38000,
    discountEnabled: true,
    servicePeriod: "1 yil",
  });
  const block = buildCommercialBlock(facts);
  assert.match(block, /38 000 so‘m/);
  assert.match(block, /100 000 so‘m/);
  assert.match(block, /1 yil/);
});

test("muddat TASDIQLANMAGAN bo‘lsa “bugun tugaydi” TAQIQLANADI", () => {
  // 13-band: to'qilgan shoshilinchlik — eng oson va eng zararli yolg'on.
  const facts = parseCommercial({ activePrice: 38000, discountEnabled: true, offerExpiresAt: null });
  const block = buildCommercialBlock(facts);
  assert.match(block, /TUGASH MUDDATI TASDIQLANMAGAN/);
  assert.match(block, /AYTMA/);
});

test("muddat bor bo‘lsa aniq sana beriladi", () => {
  const expires = new Date(Date.now() + 6 * 3600_000).toISOString();
  const block = buildCommercialBlock(
    parseCommercial({ activePrice: 38000, discountEnabled: true, offerExpiresAt: expires }),
  );
  assert.match(block, /tugash payti/);
});

test("muddat o‘tgan bo‘lsa hozirgi narx sifatida aytilmaydi", () => {
  const expired = new Date(Date.now() - 86_400_000).toISOString();
  const block = buildCommercialBlock(
    parseCommercial({ activePrice: 38000, discountEnabled: true, offerExpiresAt: expired }),
  );
  assert.match(block, /TUGAGAN/);
});

test("ma’lumot yo‘q bo‘lsa narx TAXMIN QILINMAYDI", () => {
  // Eski narxni yodda saqlab aytish — mijozga yolg'on aytish.
  const block = buildCommercialBlock(EMPTY_COMMERCIAL);
  assert.match(block, /TASDIQLANMAGAN/);
  assert.match(block, /Narxni AYTMA/);
  assert.ok(!/\d{2}\s?000/.test(block), "blokda hech qanday narx bo‘lmasin");
});

test("nosoz qiymat narxga aylanmaydi", () => {
  assert.equal(parseCommercial({ activePrice: -5 }).activePrice, null);
  assert.equal(parseCommercial({ activePrice: "salom" }).activePrice, null);
  assert.equal(parseCommercial(null).activePrice, null);
  assert.equal(parseCommercial({ offerExpiresAt: "ertaga" }).offerExpiresAt, null);
});

test("narx o‘zbekcha yoziladi", () => {
  assert.equal(formatSom(38000), "38 000 so‘m");
  assert.equal(formatSom(100000), "100 000 so‘m");
});

/* =================== 5. MIGRATSIYA XAVFSIZLIGI ========================= */

test("migratsiya non-destructive va kategoriyalar HAQIQIY", () => {
  const sql = readFileSync("supabase/migrations/20260914160000_sales_uzbek_faq.sql", "utf8");
  assert.ok(!/\bdrop table\b|\btruncate\b|\bdelete from\b/i.test(sql));

  // sales_knowledge.category CHECK ro'yxati — yaroqsiz qiymat butun
  // migratsiyani yiqitardi.
  const valid = [
    "question", "answer", "service_fact", "price", "faq", "objection",
    "sales_argument", "cta", "follow_up", "application", "payment", "post_article",
  ];
  const inserted = [...sql.matchAll(/^\s*'([a-z_]+)',\n\s*'/gmu)].map((m) => m[1]);
  assert.ok(inserted.length >= 7, `kategoriya topilmadi (${inserted.length})`);
  for (const category of inserted) {
    assert.ok(valid.includes(category), `yaroqsiz kategoriya: ${category}`);
  }
});

test("asoschi va tashkilot nomi AYNAN saqlanadi", () => {
  const sql = readFileSync("supabase/migrations/20260914160000_sales_uzbek_faq.sql", "utf8");
  assert.ok(sql.includes("Mukammal Media Group"));
  assert.ok(sql.includes("Qurbonnazarov Jaxongir Xudoynazarovich"));
});

test("chegirma muddati migratsiyada NULL — to‘qilmaydi", () => {
  const sql = readFileSync("supabase/migrations/20260914160000_sales_uzbek_faq.sql", "utf8");
  assert.match(sql, /'offerExpiresAt', null/);
});
