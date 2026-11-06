import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adabiyotXBookUrl,
  bookReadSchema,
  isValidLinkCode,
  librarySchema,
  linkRequestSchema,
  normalizeLinkCode,
  ownWorkItem,
  pointsForScore,
  readBookItem,
  resolvePartnerConfig,
  toIsoOrNow,
} from "../src/lib/adabiyotx/partner-core.ts";

const candidateId = "3c583fcb-36f5-4d8c-886d-bafb08451ea9";
const bookId = "45f0ef23-1c59-4f49-ae84-96e66adf6d3a";
const userId = "e5a60204-cb84-43f0-901e-3ad874af3146";

test("qo'lda kiritiladigan kod: kichik harf, bo'shliq va O/0, I/1 chalkashligi to'g'rilanadi", () => {
  assert.equal(normalizeLinkCode("ab cd-ef gh"), "ABCDEFGH");
  assert.equal(normalizeLinkCode("abc0efg1"), "ABCOEFGI");
  assert.equal(isValidLinkCode("ABCDEFGH"), true);
  assert.equal(isValidLinkCode("ABC"), false);
});

test("ball = to'g'ri javoblar soni, 0..10 oralig'ida", () => {
  assert.equal(pointsForScore(0), 0);
  assert.equal(pointsForScore(3), 3);
  assert.equal(pointsForScore(10), 10);
  assert.equal(pointsForScore(14), 10);
  assert.equal(pointsForScore(-2), 0);
  assert.equal(pointsForScore(Number.NaN), 0);
});

test("bog'lash so'rovi token yoki kodsiz rad etiladi", () => {
  const user = { id: userId, username: "ali", full_name: "Ali Valiyev", avatar_url: null };
  assert.equal(linkRequestSchema.safeParse({ adabiyotx_user: user }).success, false);
  assert.equal(linkRequestSchema.safeParse({ code: "ABCDEFGH", adabiyotx_user: user }).success, true);
  assert.equal(linkRequestSchema.safeParse({ token: "x".repeat(22), adabiyotx_user: user }).success, true);
  assert.equal(linkRequestSchema.safeParse({ token: "x".repeat(22), adabiyotx_user: { ...user, extra: 1 } }).success, false);
});

test("o'qilgan kitob yozuvi: ball, manba va xavfsiz havola", () => {
  const read = bookReadSchema.parse({
    adabiyotx_user_id: userId,
    book: { id: bookId, title: "O'tkan kunlar", author_name: "Abdulla Qodiriy", cover_url: "https://cdn.adabiyotx.uz/c.jpg" },
    score: 7,
    completed_at: "2026-11-06T10:00:00Z",
  });
  assert.equal(read.max_score, 10);
  const item = readBookItem(candidateId, { book: read.book, score: read.score, max_score: read.max_score, completed_at: read.completed_at });
  assert.equal(item.relationship_type, "read_book");
  assert.equal(item.content_type, "book");
  assert.equal(item.external_id, bookId);
  assert.equal(item.external_url, adabiyotXBookUrl(bookId));
  assert.equal(item.cover_url, "https://cdn.adabiyotx.uz/c.jpg");
  assert.deepEqual(item.metadata, { source: "adabiyotx_quiz", quizScore: 7, quizMax: 10, completedAt: "2026-11-06T10:00:00.000Z" });
});

test("o'z kitobi: muqova faqat xavfsiz HTTPS, manba belgilanadi", () => {
  const item = ownWorkItem(candidateId, { id: bookId, title: "Girdob", author_name: null, cover_url: "http://localhost/x.png", published_at: "2026-01-02" });
  assert.equal(item.relationship_type, "own_work");
  assert.equal(item.cover_url, null);
  assert.equal(item.published_at, "2026-01-02T00:00:00.000Z");
  assert.deepEqual(item.metadata, { source: "adabiyotx_sync" });
});

test("sana yaroqsiz bo'lsa hozirgi vaqt olinadi", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  assert.equal(toIsoOrNow("not a date", now), now.toISOString());
  assert.equal(toIsoOrNow("2026-05-01T00:00:00Z", now), "2026-05-01T00:00:00.000Z");
});

test("kutubxona javobi bo'sh maydonlar bilan ham o'qiladi", () => {
  const parsed = librarySchema.parse({ works: [{ id: bookId, title: "Girdob" }], extra: true });
  assert.equal(parsed.works.length, 1);
  assert.deepEqual(parsed.reads, []);
});

test("partner sozlamasi faqat HTTPS manzil va kalit bilan", () => {
  assert.equal(resolvePartnerConfig({}), null);
  assert.equal(resolvePartnerConfig({ ADABIYOTX_PARTNER_API_BASE_URL: "http://x.uz", ADABIYOTX_INTEGRATION_API_KEY: "k" }), null);
  assert.deepEqual(resolvePartnerConfig({ ADABIYOTX_PARTNER_API_BASE_URL: "https://adabiyotx-admin.vercel.app/", ADABIYOTX_INTEGRATION_API_KEY: "k" }), {
    baseUrl: "https://adabiyotx-admin.vercel.app",
    apiKey: "k",
  });
});
