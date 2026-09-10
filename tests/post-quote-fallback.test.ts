import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkQuote,
  QUOTE_MAX_WORDS_PER_SENTENCE,
  QUOTE_MIN_WORDS_PER_SENTENCE,
  QUOTE_SENTENCE_COUNT,
  splitSentences,
} from "../src/lib/intake/quote-rules.ts";
import { pickQuote, rankQuoteCandidates } from "../src/lib/post-studio/quote-source.ts";

const ROOT = new URL("..", import.meta.url).pathname;

/* ============ 1. NUQTADAN KEYIN PROBEL YO'Q (haqiqiy xato) ============== */

test("probelsiz yozilgan ikki gap IKKITA deb sanaladi", () => {
  // Bu aynan tutilgan xato: nomzod iqtibos yozgan, lekin nuqtadan
  // keyin probel qo'ymagan. Ilgari u BITTA gap deb sanalib,
  // "Gaplar soni 1" deb rad etilardi va post to'xtardi.
  const withSpace = "Harakat qilsangiz siz albatta natijaga erishasiz. Sabr eng katta kuchdir deb bilaman.";
  const withoutSpace = "Harakat qilsangiz siz albatta natijaga erishasiz.Sabr eng katta kuchdir deb bilaman.";

  assert.equal(splitSentences(withoutSpace).length, 2);
  assert.deepEqual(splitSentences(withoutSpace), splitSentences(withSpace));
  assert.equal(checkQuote(withoutSpace).ok, true);
  assert.equal(checkQuote(withSpace).ok, true);
});

test("undov va so‘roq belgisidan keyin ham ajratiladi", () => {
  const text = "Har kuni oldinga intilishga harakat qilaman!Bugun men kechagidan yaxshiroq bo‘lishim kerak.";
  assert.equal(splitSentences(text).length, 2);
  assert.equal(checkQuote(text).ok, true);
});

test("son va bosh harflar YOLG‘ONDAN ajratilmaydi", () => {
  // Yangi qoida ATAYLAB tor: tinish belgisidan oldin kamida ikki harf
  // va keyin bosh harf bo'lishi shart.
  assert.equal(splitSentences("Men 3.5 yil ishladim.").length, 1);
  assert.equal(splitSentences("Narxi 12.000 so‘m.").length, 1);
  // Kichik harf bilan davom etsa ham ajratilmaydi.
  assert.equal(splitSentences("bir.ikki uch to‘rt").length, 1);
});

test("probel bilan yozilgan matn oldingidek ishlaydi", () => {
  assert.equal(splitSentences("Harakat qiling!!! Natija albatta keladi.").length, 2);
  assert.equal(splitSentences("Bir gap.  Ikkinchi gap.").length, 2);
  assert.equal(splitSentences("Yakuniy gap.").length, 1);
  assert.equal(splitSentences("").length, 0);
});

/* ==================== 2. IQTIBOS MANBALARI TARTIBI ===================== */

test("nomzodning O‘Z so‘zi har doim birinchi", () => {
  const ranked = rankQuoteCandidates([
    { text: "Avtomatik yozilgan gap.", source: "ai_generated" },
    { text: "Nomzodning o‘z gapi.", source: "intake_quote" },
    { text: "Admin kiritgan gap.", source: "manual" },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.source),
    ["intake_quote", "ai_generated", "manual"],
  );
});

test("pickQuote FAQAT anketa iqtibosini oladi", () => {
  // Avtomatik iqtibos alohida yo'ldan qo'shiladi (quote-fallback.ts),
  // shuning uchun bu funksiya o'zgarmadi.
  assert.equal(pickQuote([{ text: "Avtomatik.", source: "ai_generated" }]), null);
  assert.equal(
    pickQuote([{ text: "Nomzod gapi.", source: "intake_quote" }])?.source,
    "intake_quote",
  );
});

/* ================== 3. AVTOMATIK IQTIBOS — FAKT YO'Q ==================== */

const FALLBACK = readFileSync(join(ROOT, "src/lib/post-studio/quote-fallback.ts"), "utf8");

test("promt FAKT aytishni ochiq taqiqlaydi", () => {
  // Nomzod nomidan tekshirilmagan da'vo yozib yuborish eng katta xavf.
  assert.match(FALLBACK, /FAKT AYTMA/);
  assert.match(FALLBACK, /sana, raqam, foiz, mukofot nomi, tashkilot nomi/);
  assert.match(FALLBACK, /birinchi shaxsda/i);
});

test("avtomatik iqtibos NOMZOD KO‘RGAN qoidalar bilan tekshiriladi", () => {
  // Iqtibos posterning o'sha qutisiga chiqadi — o'lchamlari bir xil
  // bo'lishi shart, aks holda u yerga sig'masdi.
  assert.match(FALLBACK, /checkQuote\(text\)/);
  assert.match(FALLBACK, /QUOTE_SENTENCE_COUNT/);
  assert.match(FALLBACK, /QUOTE_MIN_WORDS_PER_SENTENCE/);
  assert.match(FALLBACK, /QUOTE_MAX_WORDS_PER_SENTENCE/);
});

test("qoida qiymatlari promt bilan bitta manbadan keladi", () => {
  // Promtda bir son, tekshiruvda boshqasi bo'lsa, model hech qachon
  // o'ta olmaydigan talab paydo bo'lardi.
  assert.equal(QUOTE_SENTENCE_COUNT, 2);
  assert.ok(QUOTE_MIN_WORDS_PER_SENTENCE < QUOTE_MAX_WORDS_PER_SENTENCE);
});

test("model arzon vazifa modelidan olinadi va sarf qayd etiladi", () => {
  assert.match(FALLBACK, /resolveModel\("intake"\)/);
  assert.match(FALLBACK, /kind: "post\.fallback_quote"/);
});

/* ============== 4. BO'SH IQTIBOS ENDI POSTNI TO'XTATMAYDI ============== */

const REPOSITORY = readFileSync(join(ROOT, "src/lib/post-studio/repository.ts"), "utf8");

test("15-savol bo‘sh bo‘lsa avtomatik yozishga urinadi", () => {
  const block = REPOSITORY.slice(REPOSITORY.indexOf("let quote = pickQuote(source.quotes)"));
  assert.match(block.slice(0, 1200), /generateFallbackQuote\(/);
  assert.match(block.slice(0, 1200), /source: "ai_generated"/);
});

test("needs_review FAQAT avtomatik yozish ham ishlamaganda", () => {
  assert.match(REPOSITORY, /status: quote \? "draft" : "needs_review"/);
  assert.match(REPOSITORY, /avtomatik yozib bo‘lmadi/);
});

test("avtomatik iqtibos metadata’da BELGILANADI", () => {
  // Admin qaysi iqtibos nomzodniki, qaysi biri avtomatik ekanini
  // ajrata olishi kerak.
  assert.match(REPOSITORY, /quote_generated/);
  assert.match(REPOSITORY, /intake_quote_blank/);
});

/* ===================== 5. DOMEN: vercel.app chiqmasin ================== */

const SITE_ORIGIN = readFileSync(join(ROOT, "src/lib/post-studio/site-origin.ts"), "utf8");

test("sozlamadagi deploy manzili ham RAD ETILADI", () => {
  // Ilgari sozlama hamma narsadan ustun turardi va u yerda qolib
  // ketgan deploy manzili har bir postga chiqardi.
  assert.match(SITE_ORIGIN, /isVercelDeploymentUrl\(settingValue\)/);
  assert.match(SITE_ORIGIN, /console\.warn/);
  // Kanonik domen oxirgi zaxira bo‘lib qoladi.
  assert.match(SITE_ORIGIN, /CANONICAL_PUBLIC_SITE_URL;/);
});

test("migratsiya faqat HOSTNI almashtiradi", () => {
  const migration = readFileSync(
    join(ROOT, "supabase/migrations/20260910130000_fix_vercel_post_urls.sql"),
    "utf8",
  );
  // Yo'l, slug va so'rov qismi tegilmaydi — langar boshida.
  assert.match(migration, /'\^https\?:\/\/\[\^\/\]\*\\\.vercel\\\.app'/);
  assert.match(migration, /'https:\/\/liderlar\.uz'/);
  // Ma'lumot o'chirilmaydi.
  assert.ok(!/delete from|drop table|truncate/i.test(migration));
  // Sozlama qatori ham o'chirilmaydi, faqat bo'shatiladi.
  assert.match(migration, /set value = ''/);
});

test("iqtibos manbasi ro‘yxatiga ai_generated qo‘shilgan", () => {
  const migration = readFileSync(
    join(ROOT, "supabase/migrations/20260910120000_ai_generated_post_quote.sql"),
    "utf8",
  );
  assert.match(migration, /'intake_quote', 'ai_generated'/);
  // Eski qiymatlar saqlanadi — mavjud qatorlar buzilmasin.
  for (const source of ["featured_quote", "article_quote", "life_motto", "manual", "none"]) {
    assert.ok(migration.includes(`'${source}'`), source);
  }
});
