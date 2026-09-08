import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLACKLIST_ADD_BUTTON_LABEL,
  BLACKLIST_NAME_PROMPT,
  blacklistRemoveCallbackData,
  buildBlacklistLookupMessage,
  buildBlacklistResultMessage,
  findSimilarBlacklisted,
  isBlacklistPromptReply,
  levenshtein,
  nameTokens,
  parseBlacklistRemoveCallback,
  scoreNameMatch,
  tokenSimilarity,
  type BlacklistCandidate,
} from "../src/lib/intake/blacklist-match.ts";
import { blacklistKey } from "../src/lib/intake/name-key.ts";

const ROOT = new URL("..", import.meta.url).pathname;

const entry = (fullName: string, reason: string | null = "Shartnoma buzildi"): BlacklistCandidate => ({
  nameSlug: blacklistKey(fullName),
  fullName,
  reason,
  createdAt: "2026-09-01T10:00:00Z",
});

/* ------------------------------- tokenlar ------------------------------- */

test("ism bo‘laklarga ajratiladi, apostrof variantlari birlashadi", () => {
  assert.deepEqual(nameTokens("Ravshanova Maryam Rasulovna"), [
    "ravshanova",
    "maryam",
    "rasulovna",
  ]);
  // Beshta xil apostrof — bitta so'z.
  assert.deepEqual(nameTokens("Aliyev Bekzod o‘g‘li"), nameTokens("Aliyev Bekzod oʻgʻli"));
  assert.deepEqual(nameTokens("Aliyev Bekzod o'g'li"), nameTokens("Aliyev Bekzod ogli"));
});

test("bir harfli bo‘laklar tashlanadi", () => {
  assert.deepEqual(nameTokens("Ravshanova M."), ["ravshanova"]);
  assert.deepEqual(nameTokens(""), []);
  assert.deepEqual(nameTokens(null), []);
});

/* ----------------------------- o‘xshashlik ------------------------------ */

test("tahrir masofasi va o‘xshashlik", () => {
  assert.equal(levenshtein("ravshanova", "ravshanova"), 0);
  assert.equal(levenshtein("ravshanova", "ravshanava"), 1);
  assert.equal(tokenSimilarity("ravshanova", "ravshanova"), 1);
  assert.ok(tokenSimilarity("ravshanova", "ravshanava") > 0.85);
  assert.ok(tokenSimilarity("ravshanova", "karimova") < 0.6);
});

test("maxraj UZUNROQ ism — qisqa ism hammaga mos kelmaydi", () => {
  // Aks holda "Maryam" uch bo'lakli har qanday yozuvga 100% mos kelardi.
  const short = scoreNameMatch(["maryam"], ["ravshanova", "maryam", "rasulovna"]);
  assert.equal(short.matchedTokens.length, 1);
  assert.ok(short.score < 0.4);
});

/* ---------------------------- qidiruv natijasi -------------------------- */

const list = [
  entry("Ravshanova Maryam Rasulovna"),
  entry("Karimov Aziz Baxtiyorovich"),
  entry("Toshmatov Sardor"),
];

test("aynan mos keladigan ism ANIQ moslik sifatida birinchi turadi", () => {
  const matches = findSimilarBlacklisted("Ravshanova Maryam Rasulovna", list);
  assert.equal(matches[0].kind, "exact");
  assert.equal(matches[0].score, 1);
  assert.equal(matches[0].fullName, "Ravshanova Maryam Rasulovna");
});

test("otasining ismisiz yozilgan ism ham topiladi", () => {
  // Aniq kalit bo'yicha qidiruv buni TOPMASDI — o'xshashlik shuning uchun kerak.
  const matches = findSimilarBlacklisted("Ravshanova Maryam", list);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, "similar");
  assert.equal(matches[0].fullName, "Ravshanova Maryam Rasulovna");
  assert.ok(matches[0].score >= 0.5);
});

test("bitta harflik xato ham topiladi", () => {
  const matches = findSimilarBlacklisted("Ravshanava Maryam", list);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].fullName, "Ravshanova Maryam Rasulovna");
});

test("BOSHQA odam chiqmaydi — bitta umumiy ism yetarli emas", () => {
  // "Maryam" minglab odamda bor; u bilan chiqadigan ro'yxat shovqin bo'lardi.
  assert.deepEqual(findSimilarBlacklisted("Yo‘ldosheva Maryam", list), []);
  assert.deepEqual(findSimilarBlacklisted("Karimov Sardor", list), []);
});

test("ro‘yxatda yo‘q odam hech narsa bermaydi", () => {
  assert.deepEqual(findSimilarBlacklisted("Ismoilov Jasur Anvarovich", list), []);
  assert.deepEqual(findSimilarBlacklisted("", list), []);
});

test("bitta so‘zli ismlar o‘zaro solishtiriladi", () => {
  const single = [entry("Toshmatov")];
  assert.equal(findSimilarBlacklisted("Toshmatov", single)[0].kind, "exact");
  assert.equal(findSimilarBlacklisted("Toshmatav", single)[0].kind, "similar");
});

/* ------------------------------- xabarlar ------------------------------- */

test("yangi ism qo‘shilgani aytiladi", () => {
  const text = buildBlacklistResultMessage({
    fullName: "Ismoilov Jasur",
    added: true,
    alreadyListed: false,
    matches: [],
  });
  assert.match(text, /Qora ro‘yxatga kiritildi/);
  assert.match(text, /Ismoilov Jasur/);
});

test("avvaldan bor ism “allaqachon” deb belgilanadi", () => {
  const text = buildBlacklistResultMessage({
    fullName: "Ravshanova Maryam Rasulovna",
    added: true,
    alreadyListed: true,
    matches: findSimilarBlacklisted("Ravshanova Maryam Rasulovna", list),
  });
  assert.match(text, /ALLAQACHON/);
});

test("o‘xshash ismlar ism-familiyasi bilan ko‘rsatiladi", () => {
  const text = buildBlacklistResultMessage({
    fullName: "Ravshanova Maryam",
    added: true,
    alreadyListed: false,
    matches: findSimilarBlacklisted("Ravshanova Maryam", list),
  });
  assert.match(text, /o‘xshash 1 ta ism bor/);
  assert.match(text, /Ravshanova Maryam Rasulovna/);
  assert.match(text, /%\s?o‘xshash/);
  // Sabab ham ko'rinadi.
  assert.match(text, /Shartnoma buzildi/);
});

test("ism o‘qilmasa saqlanmagani ochiq aytiladi", () => {
  const text = buildBlacklistResultMessage({
    fullName: "!!!",
    added: false,
    alreadyListed: false,
    matches: [],
  });
  assert.match(text, /saqlanmadi/);
  assert.ok(!text.includes("kiritildi"));
});

test("faqat qidiruv xabari", () => {
  assert.match(buildBlacklistLookupMessage("Kimdir", []), /topilmadi/);
  const found = buildBlacklistLookupMessage("Ravshanova Maryam", findSimilarBlacklisted("Ravshanova Maryam", list));
  assert.match(found, /Ravshanova Maryam Rasulovna/);
});

/* --------------------------- holatsiz oqim ------------------------------ */

test("javob savolga bog‘lanadi — chat holati saqlanmaydi", () => {
  assert.equal(isBlacklistPromptReply(BLACKLIST_NAME_PROMPT), true);
  assert.equal(isBlacklistPromptReply("Boshqa xabar"), false);
  assert.equal(isBlacklistPromptReply(null), false);
  assert.equal(isBlacklistPromptReply(undefined), false);
});

test("olib tashlash kaliti 64 baytga sig‘adi, sig‘masa tugma berilmaydi", () => {
  const data = blacklistRemoveCallbackData("ravshanova-maryam-rasulovna");
  assert.ok(data);
  assert.ok(Buffer.byteLength(data!, "utf8") <= 64);
  assert.equal(parseBlacklistRemoveCallback(data), "ravshanova-maryam-rasulovna");

  // Kesilgan kalit BOSHQA odamni ro'yxatdan chiqarib yuborishi mumkin edi.
  assert.equal(blacklistRemoveCallbackData("x".repeat(80)), null);
  assert.equal(parseBlacklistRemoveCallback("boshqa:narsa"), null);
  assert.equal(parseBlacklistRemoveCallback(null), null);
});

/* ------------------------------ bot ulanishi ---------------------------- */

const ROUTER = readFileSync(join(ROOT, "src/lib/post-studio/bot-router.ts"), "utf8");

test("tugma tahririyat klaviaturasida", () => {
  const keyboard = ROUTER.slice(ROUTER.indexOf("function keyboardFor"), ROUTER.indexOf("async function sendCrmList"));
  assert.ok(keyboard.includes("BLACKLIST_ADD_BUTTON_LABEL"));
  assert.match(BLACKLIST_ADD_BUTTON_LABEL, /Qora ro‘yxatga kiritish/);
});

test("tugma ham, javob ham tahririyat ekanini QAYTA tekshiradi", () => {
  // Yorliq — oddiy matn, uni istalgan odam yozishi mumkin; savol esa
  // boshqa chatga forward qilinishi mumkin.
  const block = ROUTER.slice(ROUTER.indexOf('command === "/qora"'), ROUTER.indexOf("// The CRM lists"));
  assert.equal((block.match(/if \(!editorial\) return deny/g) ?? []).length, 2);
  assert.match(block, /forceReply: true/);
  assert.match(block, /isBlacklistPromptReply/);
});

test("o‘xshashlar QO‘SHISHDAN OLDIN qidiriladi", () => {
  // Keyin qidirilsa, endigina qo'shilgan yozuvning o'zi "aniq moslik"
  // bo'lib chiqib, ro'yxatni ma'nosiz qilardi.
  const block = ROUTER.slice(ROUTER.indexOf("async function handleBlacklistName"));
  assert.ok(
    block.indexOf("findSimilarInBlacklist") < block.indexOf("addToBlacklist"),
    "qidiruv qo‘shishdan keyin qolib ketgan",
  );
});

test("yordam matnida yangi buyruq bor", () => {
  assert.match(ROUTER, /\/qora — qora ro‘yxatga ism kiritish/);
});
