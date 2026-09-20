import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideReferralReward,
  pendingMilestones,
  canAdvance,
  referralLedgerKey,
  milestoneLedgerKey,
  type RewardStage,
} from "../src/lib/referral/rules.ts";
import {
  gateSensitiveAction,
  gateReadAccess,
  decideNewDevice,
  blockedUntil,
  isBlockExpired,
  HOLD_BLOCKED_ACTIONS,
} from "../src/lib/member/security-rules.ts";
import {
  issueLinkToken,
  checkLinkToken,
  hashLinkToken,
} from "../src/lib/member/link-token.ts";
import {
  generateCertificateCode,
  normalizeCertificateCode,
  certificateVerdict,
  isCertificateCode,
} from "../src/lib/mehr/certificate-code.ts";

const ATTR = "44444444-4444-4444-8444-444444444444";
const REFERRER = "ref-1";

// ---------------------------------------------------------------
// REFERRAL
// ---------------------------------------------------------------

test("o'zini o'zi taklif qilgan odam ball olmaydi", () => {
  const d = decideReferralReward(ATTR, {
    referrerProfileId: REFERRER,
    referredProfileId: REFERRER,
    stage: "payment_confirmed",
  }, []);

  assert.equal(d.award, false);
  assert.equal(d.award === false && d.reason, "self_referral");
});

test("to'lovi tasdiqlangan taklif ball beradi", () => {
  const d = decideReferralReward(ATTR, {
    referrerProfileId: REFERRER,
    referredProfileId: "yangi-azo",
    stage: "payment_confirmed",
  }, []);

  assert.equal(d.award, true);
  assert.equal(d.award === true && d.ruleCode, "referral.paid");
});

test("faqat tashrif yoki ariza bosqichida ball berilmaydi", () => {
  for (const stage of ["visited", "application"] as const) {
    const d = decideReferralReward(ATTR, {
      referrerProfileId: REFERRER,
      referredProfileId: "yangi-azo",
      stage,
    }, []);
    assert.equal(d.award, false, stage);
    assert.equal(d.award === false && d.reason, "no_reward_for_stage");
  }
});

test("bosqichlar ustma-ust qo'shiladi, lekin har biri bir martadan", () => {
  const base = { referrerProfileId: REFERRER, referredProfileId: "yangi-azo" };

  const reg = decideReferralReward(ATTR, { ...base, stage: "registered" }, []);
  assert.equal(reg.award, true);

  // Ro'yxatdan o'tgani berilgach, to'lov bosqichi HAMON beriladi.
  const paid = decideReferralReward(ATTR, { ...base, stage: "payment_confirmed" }, ["registered"]);
  assert.equal(paid.award, true);

  // Lekin o'sha bosqich ikkinchi marta berilmaydi.
  const again = decideReferralReward(ATTR, { ...base, stage: "registered" }, ["registered"]);
  assert.equal(again.award, false);
  assert.equal(again.award === false && again.reason, "already_awarded");
});

test("takrorlanmaslik kaliti bosqich bo'yicha farq qiladi", () => {
  const a = referralLedgerKey(ATTR, "registered");
  const b = referralLedgerKey(ATTR, "payment_confirmed");

  assert.notEqual(a, b);
  assert.equal(a, referralLedgerKey(ATTR, "registered"));
});

test("marra kaliti atributsiyaga emas, taklifchiga bog'lanadi", () => {
  /*
   * Marra bitta taklif uchun emas, umumiy hisobga beriladi.
   * Atributsiyaga bog'lansa, 5 ta taklif = 5 ta marra bo'lardi.
   */
  assert.equal(milestoneLedgerKey(REFERRER, "milestone_5"), `referral_milestone:${REFERRER}:milestone_5`);
});

test("bosqich orqaga qaytmaydi", () => {
  assert.equal(canAdvance("registered", "payment_confirmed"), true);
  assert.equal(canAdvance("payment_confirmed", "registered"), false);
  assert.equal(canAdvance("registered", "registered"), false);
});

test("marralar to'langan takliflar soniga qarab ochiladi", () => {
  assert.deepEqual(pendingMilestones(4, []), []);
  assert.deepEqual(pendingMilestones(5, []), ["milestone_5"]);
  assert.deepEqual(pendingMilestones(10, []), ["milestone_5", "milestone_10"]);
});

test("berilgan marra qayta berilmaydi", () => {
  const already: RewardStage[] = ["milestone_5"];
  assert.deepEqual(pendingMilestones(10, already), ["milestone_10"]);
});

test("100 ta taklifda barcha marralar ochiladi, lekin har biri bir marta", () => {
  const all = pendingMilestones(100, []);
  assert.equal(all.length, 5);
  assert.equal(new Set(all).size, 5);
  assert.deepEqual(pendingMilestones(100, all), []);
});

// ---------------------------------------------------------------
// YANGI QURILMA VA USHLAB TURISH
// ---------------------------------------------------------------

const NOW = new Date("2026-09-20T10:00:00Z");

test("yangi qurilmada bir soatlik ushlab turish boshlanadi va Telegram'ga xabar ketadi", () => {
  const d = decideNewDevice(null, NOW, 60);

  assert.equal(d.isNewDevice, true);
  assert.equal(d.notifyTelegram, true);
  assert.equal(d.holdUntil, "2026-09-20T11:00:00.000Z");
});

test("ishonchli qurilmada ushlab turish ham, xabarnoma ham yo'q", () => {
  /*
   * Har kungi kirishda ogohlantirish yuborilsa, xabarnomalar
   * ma'nosini yo'qotadi va haqiqiy hodisa e'tiborsiz qolardi.
   */
  const d = decideNewDevice({ status: "trusted" }, NOW, 60);

  assert.equal(d.isNewDevice, false);
  assert.equal(d.notifyTelegram, false);
  assert.equal(d.holdUntil, null);
});

test("ushlab turish paytida xavfli amal to'siladi", () => {
  const gate = gateSensitiveAction(
    { deviceStatus: "untrusted", holdUntil: "2026-09-20T11:00:00.000Z", revokedAt: null },
    NOW,
  );

  assert.equal(gate.allowed, false);
  assert.equal(gate.allowed === false && gate.reason, "security_hold");
});

test("ushlab turish paytida O'QISH ochiq qoladi", () => {
  /*
   * Haqiqiy egasi yangi telefonidan kirib, bir soat davomida
   * o'z profilini ham ko'ra olmasa — bu xavfsizlik emas, xalaqit.
   */
  const gate = gateReadAccess({
    deviceStatus: "untrusted",
    holdUntil: "2026-09-20T11:00:00.000Z",
    revokedAt: null,
  });

  assert.equal(gate.allowed, true);
});

test("ushlab turish muddati tugagach xavfli amal ochiladi", () => {
  const gate = gateSensitiveAction(
    { deviceStatus: "untrusted", holdUntil: "2026-09-20T09:00:00.000Z", revokedAt: null },
    NOW,
  );

  assert.equal(gate.allowed, true);
});

test("Telegram'da tasdiqlangan qurilmada ushlab turish qolmaydi", () => {
  const gate = gateSensitiveAction({ deviceStatus: "trusted", holdUntil: null, revokedAt: null }, NOW);
  assert.equal(gate.allowed, true);
});

test("bekor qilingan seans hech nimaga ruxsat bermaydi", () => {
  const session = { deviceStatus: "trusted" as const, holdUntil: null, revokedAt: "2026-09-20T09:30:00Z" };

  assert.equal(gateSensitiveAction(session, NOW).allowed, false);
  assert.equal(gateReadAccess(session).allowed, false);
});

test("bloklangan qurilma o'qishga ham kirmaydi", () => {
  const session = { deviceStatus: "blocked" as const, holdUntil: null, revokedAt: null };
  const gate = gateReadAccess(session);

  assert.equal(gate.allowed, false);
  assert.equal(gate.allowed === false && gate.reason, "device_blocked");
});

test("rad etilgan qurilma 7 kunga bloklanadi va muddati kuzatiladi", () => {
  const until = blockedUntil(NOW, 7);
  assert.equal(until, "2026-09-27T10:00:00.000Z");

  assert.equal(isBlockExpired(until, NOW), false);
  assert.equal(isBlockExpired(until, new Date("2026-09-28T00:00:00Z")), true);
  assert.equal(isBlockExpired(null, NOW), false);
});

test("parolni o'zgartirish ushlab turishda to'siladigan amallar ro'yxatida", () => {
  assert.ok(HOLD_BLOCKED_ACTIONS.includes("password_change"));
  assert.ok(HOLD_BLOCKED_ACTIONS.includes("telegram_unlink"));
});

// ---------------------------------------------------------------
// TELEGRAM BOG'LASH TOKENI
// ---------------------------------------------------------------

test("token bazaga ochiq holda yozilmaydi — faqat hash", () => {
  const issued = issueLinkToken(NOW);

  assert.notEqual(issued.token, issued.tokenHash);
  assert.equal(issued.tokenHash, hashLinkToken(issued.token));
  assert.match(issued.tokenHash, /^[0-9a-f]{64}$/);
});

test("yaroqli token qabul qilinadi", () => {
  const issued = issueLinkToken(NOW);
  const check = checkLinkToken(issued.token, {
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
    usedAt: null,
  }, NOW);

  assert.equal(check.ok, true);
});

test("token BIR MARTALIK", () => {
  const issued = issueLinkToken(NOW);
  const check = checkLinkToken(issued.token, {
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
    usedAt: "2026-09-20T10:01:00Z",
  }, NOW);

  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.reason, "already_used");
});

test("muddati o'tgan token qabul qilinmaydi", () => {
  const issued = issueLinkToken(NOW, 60);
  const check = checkLinkToken(issued.token, {
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
    usedAt: null,
  }, new Date(NOW.getTime() + 120_000));

  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.reason, "expired");
});

test("boshqa token bilan bog'lanib bo'lmaydi", () => {
  const mine = issueLinkToken(NOW);
  const other = issueLinkToken(NOW);

  const check = checkLinkToken(other.token, {
    tokenHash: mine.tokenHash,
    expiresAt: mine.expiresAt,
    usedAt: null,
  }, NOW);

  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.reason, "not_found");
});

test("har chaqiriqda boshqa token chiqadi", () => {
  const tokens = new Set(Array.from({ length: 100 }, () => issueLinkToken(NOW).token));
  assert.equal(tokens.size, 100);
});

// ---------------------------------------------------------------
// SERTIFIKAT KODI
// ---------------------------------------------------------------

test("kod to'g'ri shaklda chiqadi va takrorlanmaydi", () => {
  const codes = new Set(Array.from({ length: 500 }, () => generateCertificateCode()));
  assert.equal(codes.size, 500);

  for (const c of codes) assert.ok(isCertificateCode(c), c);
});

test("chalkashadigan belgilar kodda ishlatilmaydi", () => {
  /*
   * I/1 va O/0 ko'chirishda adashtiradi. Ular alifboda bo'lsa,
   * odam qo'lda tergan kod tekshiruvdan o'tmasdi.
   */
  const joined = Array.from({ length: 300 }, () => generateCertificateCode()).join("");
  for (const ch of ["I", "L", "O", "U"]) {
    assert.ok(!joined.slice(5).includes(ch), `alifboda ${ch} bor`);
  }
});

test("qo'lda kiritilgan kod tozalanadi", () => {
  const code = generateCertificateCode();
  const body = code.slice(5);

  assert.equal(normalizeCertificateCode(code.toLowerCase()), code);
  assert.equal(normalizeCertificateCode(` ${code} `), code);
  assert.equal(normalizeCertificateCode(body), code);
});

test("yaroqsiz kod null qaytaradi", () => {
  for (const bad of ["", "MEHR-", "MEHR-123", "salom"]) {
    assert.equal(normalizeCertificateCode(bad), null, bad);
  }
});

test("bekor qilingan sertifikat 'topilmadi' emas, 'bekor qilingan' deb ko'rsatiladi", () => {
  /*
   * §33. "Topilmadi" deyish soxta sertifikat bilan bekor
   * qilinganni bir xil ko'rsatardi — tekshiruvchi uchun esa
   * bu ikki butunlay boshqa javob.
   */
  const revoked = certificateVerdict({ status: "revoked", revokedReason: "Soxta dalil" });
  assert.equal(revoked.state, "revoked");
  assert.ok(revoked.message.includes("Soxta dalil"));

  assert.equal(certificateVerdict(null).state, "not_found");
  assert.equal(certificateVerdict({ status: "active", revokedReason: null }).state, "valid");
});
