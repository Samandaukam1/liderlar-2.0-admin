import { test } from "node:test";
import assert from "node:assert/strict";
import {
  issueCheckinToken,
  verifyCheckinToken,
  newNonce,
} from "../src/lib/mehr/checkin-token.ts";
import { checkLocation, distanceMeters } from "../src/lib/mehr/geo.ts";
import {
  canTransition,
  nextStatus,
  checkSubmission,
  type SubmissionDraft,
} from "../src/lib/mehr/activity-rules.ts";

const SECRET = "seans-kaliti-abcdef0123456789";
const SESSION = "22222222-2222-4222-8222-222222222222";
const NOW = 1_800_000_000;

// ---------------------------------------------------------------
// QR TOKENI
// ---------------------------------------------------------------

test("yaroqli token tekshiruvdan o'tadi", () => {
  const token = issueCheckinToken({ sessionId: SESSION, nonce: newNonce() }, SECRET, 30, NOW);
  const result = verifyCheckinToken(token, SECRET, NOW + 5, SESSION);

  assert.equal(result.ok, true);
});

test("muddati o'tgan QR ishlamaydi", () => {
  const token = issueCheckinToken({ sessionId: SESSION, nonce: newNonce() }, SECRET, 30, NOW);

  // 30 s TTL + 5 s soat farqi = 35 s. 40-soniyada aniq o'lik.
  const result = verifyCheckinToken(token, SECRET, NOW + 40, SESSION);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "expired");
});

test("soat bir necha soniya og'ishsa token hamon qabul qilinadi", () => {
  /*
   * Telefon soati odatda bir-ikki soniya og'adi. Yon berilmasa,
   * haqiqiy ishtirokchi "muddati o'tgan" xatosini olardi.
   */
  const token = issueCheckinToken({ sessionId: SESSION, nonce: newNonce() }, SECRET, 30, NOW);
  const result = verifyCheckinToken(token, SECRET, NOW + 33, SESSION);

  assert.equal(result.ok, true);
});

test("boshqa kalit bilan imzolangan token rad etiladi", () => {
  const token = issueCheckinToken({ sessionId: SESSION, nonce: newNonce() }, "boshqa-kalit", 30, NOW);
  const result = verifyCheckinToken(token, SECRET, NOW, SESSION);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad_signature");
});

test("boshqa tadbirning QR kodi bu tadbirga o'tmaydi", () => {
  const token = issueCheckinToken({ sessionId: SESSION, nonce: newNonce() }, SECRET, 30, NOW);
  const result = verifyCheckinToken(token, SECRET, NOW, "33333333-3333-4333-8333-333333333333");

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "wrong_session");
});

test("token ichidagi ma'lumot o'zgartirilsa imzo yiqiladi", () => {
  const token = issueCheckinToken({ sessionId: SESSION, nonce: newNonce() }, SECRET, 30, NOW);
  const [body, sig] = token.split(".");

  // Muddatni cho'zishga urinish.
  const tampered = Buffer.from(
    JSON.stringify({ v: "v1", s: SESSION, n: "x", e: NOW + 99999 }),
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const result = verifyCheckinToken(`${tampered}.${sig}`, SECRET, NOW, SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad_signature");
  assert.notEqual(tampered, body);
});

test("buzuq token tushunarli sabab bilan rad etiladi", () => {
  for (const bad of ["", "hech-nima", "a.b.c", ".", "abc."]) {
    const result = verifyCheckinToken(bad, SECRET, NOW, SESSION);
    assert.equal(result.ok, false, `"${bad}" o'tib ketdi`);
  }
});

test("har aylanishda yangi nonce chiqadi", () => {
  const nonces = new Set(Array.from({ length: 200 }, () => newNonce()));
  assert.equal(nonces.size, 200);
});

// ---------------------------------------------------------------
// JOY TEKSHIRUVI
// ---------------------------------------------------------------

const TASHKENT = { latitude: 41.311081, longitude: 69.240562 };

test("masofa hisobi haqiqatga yaqin", () => {
  // Toshkent — Samarqand ~270 km.
  const samarqand = { latitude: 39.627012, longitude: 66.975, };
  const d = distanceMeters(TASHKENT, samarqand);

  assert.ok(d > 260_000 && d < 290_000, `kutilmagan masofa: ${d}`);
});

test("radius ichidagi ishtirokchi tasdiqlanadi", () => {
  const result = checkLocation({
    requiresLocation: true,
    event: { ...TASHKENT, radiusMeters: 300 },
    reported: { latitude: 41.3113, longitude: 69.2408 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.verified, true);
});

test("uzoqdagi odam check-in qila olmaydi", () => {
  const result = checkLocation({
    requiresLocation: true,
    event: { ...TASHKENT, radiusMeters: 200 },
    reported: { latitude: 41.35, longitude: 69.30 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "too_far");
});

test("GPS aniqligi hisobga olinadi — chegarada turgan odam rad etilmaydi", () => {
  /*
   * 250 m masofa, 200 m radius, lekin telefon "±80 m" deydi.
   * Yon berilmasa, binoning ichidagi odam rad etilardi.
   */
  const near = { latitude: 41.31333, longitude: 69.24056 };
  const d = distanceMeters(TASHKENT, near);
  assert.ok(d > 200 && d < 280, `sinov nuqtasi noto'g'ri: ${d}`);

  const strict = checkLocation({
    requiresLocation: true,
    event: { ...TASHKENT, radiusMeters: 200 },
    reported: { ...near },
  });
  assert.equal(strict.ok, false);

  const lenient = checkLocation({
    requiresLocation: true,
    event: { ...TASHKENT, radiusMeters: 200 },
    reported: { ...near, accuracyMeters: 80 },
  });
  assert.equal(lenient.ok, true);
});

test("juda katta GPS xatoligi cheksiz yon berish bermaydi", () => {
  const result = checkLocation({
    requiresLocation: true,
    event: { ...TASHKENT, radiusMeters: 100 },
    reported: { latitude: 41.35, longitude: 69.30, accuracyMeters: 999_999 },
  });

  assert.equal(result.ok, false);
});

test("onlayn tadbirda joy so'ralmaydi", () => {
  const result = checkLocation({
    requiresLocation: false,
    event: { latitude: null, longitude: null, radiusMeters: null },
    reported: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.reason, "not_required");
});

test("joy talab qilinsa-yu yuborilmasa, check-in o'tmaydi", () => {
  const result = checkLocation({
    requiresLocation: true,
    event: { ...TASHKENT, radiusMeters: 200 },
    reported: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "location_missing");
});

// ---------------------------------------------------------------
// TADBIR HAYOT YO'LI
// ---------------------------------------------------------------

test("qoralama yuboriladi, yuborilgani tasdiqlanadi", () => {
  assert.equal(canTransition("draft", "submit"), true);
  assert.equal(canTransition("submitted", "approve"), true);
  assert.equal(nextStatus("approve"), "approved");
});

test("tuzatish so'ralgan tadbir qayta yuboriladi", () => {
  assert.equal(canTransition("changes_requested", "submit"), true);
});

test("tasdiqlangan tadbirni orqaga qaytarib bo'lmaydi", () => {
  /*
   * Ball berilgan, sertifikat chiqqan, ommaviy sahifa ochilgan.
   * Holatni qaytarish uchalasini jimgina yolg'onga aylantirardi.
   */
  for (const action of ["submit", "approve", "reject", "request_changes"] as const) {
    assert.equal(canTransition("approved", action), false, action);
  }
});

test("rad etilgan tadbir qayta yuborilmaydi — yangisi yaratiladi", () => {
  assert.equal(canTransition("rejected", "submit"), false);
});

test("qoralamani to'g'ridan-to'g'ri tasdiqlab bo'lmaydi", () => {
  assert.equal(canTransition("draft", "approve"), false);
});

const FULL: SubmissionDraft = {
  title: "Navoiy tumanida 40 nafar oilaga qishki yordam",
  description: "Issiq kiyim va oziq-ovqat tarqatildi.",
  purpose: "Kam ta'minlangan oilalarni qish oldidan qo'llab-quvvatlash.",
  coverImageUrl: "https://example.com/cover.jpg",
  beneficiaryCount: 40,
  mediaCount: 6,
  participantCount: 12,
  startsAt: "2026-09-18T09:00:00Z",
};

test("to'liq to'ldirilgan tadbir tekshiruvga o'tadi", () => {
  assert.equal(checkSubmission(FULL).ok, true);
});

test("dalilsiz tadbir tasdiqqa kirmaydi va nima yetishmagani aytiladi", () => {
  const result = checkSubmission({ ...FULL, mediaCount: 0, coverImageUrl: null });

  assert.equal(result.ok, false);
  assert.ok(result.missing.some((m) => m.includes("dalil")));
  assert.ok(result.missing.some((m) => m.includes("Muqova")));
});

test("yolg'iz qilingan ezgulik ham qabul qilinadi", () => {
  /*
   * Ishtirokchi soni tekshirilmaydi: tashkilotchining o'zi
   * yagona ishtirokchi bo'lishi rad etish sababi emas.
   */
  assert.equal(checkSubmission({ ...FULL, participantCount: 0 }).ok, true);
});

test("nafi tekkanlar soni 0 bo'lsa ham qabul qilinadi, lekin bo'sh bo'lsa yo'q", () => {
  assert.equal(checkSubmission({ ...FULL, beneficiaryCount: 0 }).ok, true);
  assert.equal(checkSubmission({ ...FULL, beneficiaryCount: null }).ok, false);
});
