import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planActivityAwards,
  mehrLedgerKey,
  reversalLedgerKey,
  cappedReferralContribution,
  type PointRule,
} from "../src/lib/mehr/points.ts";

/*
 * V1 qoidalari (§28). Testda ATAYLAB qo'lda yozildi: agar kimdir
 * migratsiyadagi raqamni o'zgartirsa, bu test o'zgarishni ko'rsatib
 * beradi. Qoidalarni modulning o'zidan olsak, test o'zini o'zi
 * tasdiqlagan bo'lardi.
 */
const RULES: PointRule[] = [
  { code: "mehr.participant", category: "ijtimoiy_tasir", points: 20, isActive: true },
  { code: "mehr.co_organizer", category: "yetakchilik", points: 40, isActive: true },
  { code: "mehr.organizer", category: "yetakchilik", points: 60, isActive: true },
];

const ACTIVITY = "11111111-1111-4111-8111-111111111111";

test("ishtirokchi 20, hamkor 40, tashkilotchi 60 ball oladi", () => {
  const plan = planActivityAwards(
    [
      { activityId: ACTIVITY, profileId: "p1", role: "participant" },
      { activityId: ACTIVITY, profileId: "p2", role: "co_organizer" },
      { activityId: ACTIVITY, profileId: "p3", role: "organizer" },
    ],
    RULES,
  );

  assert.equal(plan.entries.length, 3);
  assert.equal(plan.entries.find((e) => e.profileId === "p1")?.points, 20);
  assert.equal(plan.entries.find((e) => e.profileId === "p2")?.points, 40);
  assert.equal(plan.entries.find((e) => e.profileId === "p3")?.points, 60);
});

test("har bir yozuvning takrorlanmaslik kaliti boshqa-boshqa", () => {
  const plan = planActivityAwards(
    [
      { activityId: ACTIVITY, profileId: "p1", role: "participant" },
      { activityId: ACTIVITY, profileId: "p2", role: "organizer" },
    ],
    RULES,
  );

  const keys = plan.entries.map((e) => e.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("tasdiq ikki marta ishlasa ham kalit o'zgarmaydi — baza ikkinchisini rad etadi", () => {
  const first = planActivityAwards([{ activityId: ACTIVITY, profileId: "p1", role: "participant" }], RULES);
  const second = planActivityAwards([{ activityId: ACTIVITY, profileId: "p1", role: "participant" }], RULES);

  assert.equal(first.entries[0].idempotencyKey, second.entries[0].idempotencyKey);
});

test("bir odam bitta rolda ikki marta ro'yxatda bo'lsa, ball bir marta rejalanadi", () => {
  const plan = planActivityAwards(
    [
      { activityId: ACTIVITY, profileId: "p1", role: "participant" },
      { activityId: ACTIVITY, profileId: "p1", role: "participant" },
    ],
    RULES,
  );

  assert.equal(plan.entries.length, 1);
});

test("tashkilotchi ham ishtirokchi bo'lsa, ikkala rol ham alohida sanaladi", () => {
  /*
   * Rolni kalitdan chiqarib tashlash vasvasasi bor edi. Agar
   * chiqarilganda, tashkilotchining ishtirokchi balli yo'qolardi.
   */
  const plan = planActivityAwards(
    [
      { activityId: ACTIVITY, profileId: "p1", role: "organizer" },
      { activityId: ACTIVITY, profileId: "p1", role: "participant" },
    ],
    RULES,
  );

  assert.equal(plan.entries.length, 2);
  assert.equal(plan.entries.reduce((s, e) => s + e.points, 0), 80);
});

test("o'chirilgan qoida jimgina tashlanmaydi — sababi qaytadi", () => {
  const plan = planActivityAwards(
    [{ activityId: ACTIVITY, profileId: "p1", role: "participant" }],
    [{ code: "mehr.participant", category: "ijtimoiy_tasir", points: 20, isActive: false }],
  );

  assert.equal(plan.entries.length, 0);
  assert.equal(plan.skipped[0].reason, "qoida o'chirilgan");
});

test("qoida umuman topilmasa ham sabab qaytadi", () => {
  const plan = planActivityAwards([{ activityId: ACTIVITY, profileId: "p1", role: "organizer" }], []);
  assert.equal(plan.skipped[0].reason, "qoida topilmadi");
});

test("teskari yozuv kaliti asl kalitdan farq qiladi", () => {
  const original = mehrLedgerKey(ACTIVITY, "p1", "participant");
  const reversal = reversalLedgerKey(original, "Soxta dalil aniqlandi");

  assert.notEqual(original, reversal);
  assert.ok(reversal.startsWith("reversal:"));
});

// ---------------------------------------------------------------
// §31 — PUL BILAN REYTING SOTIB OLINMAYDI
// ---------------------------------------------------------------

test("hech qanday boshqa faoliyati yo'q odam referral bilan reyting ko'tara olmaydi", () => {
  // 1000 ball referral, 0 ball haqiqiy faoliyat.
  assert.equal(cappedReferralContribution(1000, 0, 30), 0);
});

test("30% cheklovda referral yakuniy summaning uchdan biridan oshmaydi", () => {
  const other = 70;
  const capped = cappedReferralContribution(1000, other, 30);

  assert.equal(capped, 30);
  // 30 / (70 + 30) = 30%
  assert.ok(capped / (other + capped) <= 0.3 + 1e-9);
});

test("referral balli cheklovdan kam bo'lsa, to'liq hisobga olinadi", () => {
  assert.equal(cappedReferralContribution(10, 1000, 30), 10);
});

test("cheklov 100% bo'lsa hech nima kesilmaydi, 0% bo'lsa hammasi kesiladi", () => {
  assert.equal(cappedReferralContribution(500, 10, 100), 500);
  assert.equal(cappedReferralContribution(500, 10, 0), 0);
});
