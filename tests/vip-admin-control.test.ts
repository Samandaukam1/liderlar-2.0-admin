import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  endOfTashkentDay,
  resolveExtension,
  resolveGrantWindow,
  VIP_MAX_DAYS,
} from "../src/lib/vip/admin-grant.ts";
import {
  dueTransition,
  extend,
  extendTo,
  vipDisplay,
  type SubscriptionState,
  type SubscriptionTimes,
} from "../src/lib/vip/subscription-rules.ts";
import { decide, isSubscriptionGranting } from "../src/lib/vip/entitlements.ts";

/**
 * VIP — ADMIN QO'LDA BOSHQARADI ("Foydalanuvchi akkauntlari").
 *
 * Talab (2026-10-03): admin boshlanish va tugash sanasini belgilaydi,
 * uzaytiradi, o'chiradi; `expires_at` kelganda VIP imkoniyatlari
 * SERVERDA yopiladi.
 */

const DAY = 86_400_000;
// 2026-10-03 15:00 Toshkent (UTC+5).
const NOW = new Date("2026-10-03T10:00:00Z");

/* ------------------------------------------------------------------ *
 * VIP BERISH — SANALAR
 * ------------------------------------------------------------------ */

test("bugundan 30 kun: boshlanish — hozirgi lahza, tugash — 30 kundan keyin", () => {
  const w = resolveGrantWindow({ startDate: "2026-10-03", days: 30 }, NOW);
  assert.ok(w.ok);
  assert.equal(w.startedAt.getTime(), NOW.getTime());
  assert.equal(w.periodEnd.getTime(), NOW.getTime() + 30 * DAY);
  assert.equal(w.days, 30);
});

test("o'tgan sanadan (to'lov oldinroq): Toshkent kun boshidan hisoblanadi", () => {
  const w = resolveGrantWindow({ startDate: "2026-09-20", days: 90 }, NOW);
  assert.ok(w.ok);
  // 2026-09-20 00:00 Toshkent = 2026-09-19 19:00 UTC.
  assert.equal(w.startedAt.toISOString(), "2026-09-19T19:00:00.000Z");
  assert.equal(w.periodEnd.getTime(), w.startedAt.getTime() + 90 * DAY);
});

test("aniq tugash sanasi — o'sha kunning OXIRIGACHA (Toshkent)", () => {
  const w = resolveGrantWindow({ startDate: "2026-10-03", endDate: "2026-11-10" }, NOW);
  assert.ok(w.ok);
  // 2026-11-11 00:00 Toshkent = 2026-11-10 19:00 UTC.
  assert.equal(w.periodEnd.toISOString(), "2026-11-10T19:00:00.000Z");
  assert.equal(endOfTashkentDay("2026-11-10")?.toISOString(), "2026-11-10T19:00:00.000Z");
});

test("kelajakdagi boshlanish rad etiladi (huquq darhol ochilib ketmasin)", () => {
  const w = resolveGrantWindow({ startDate: "2026-10-04", days: 30 }, NOW);
  assert.equal(w.ok, false);
});

test("allaqachon tugagan muddat rad etiladi", () => {
  assert.equal(resolveGrantWindow({ startDate: "2026-08-01", days: 30 }, NOW).ok, false);
  assert.equal(resolveGrantWindow({ startDate: "2026-10-01", endDate: "2026-10-02" }, NOW).ok, false);
});

test("muddat VA sana birga, yoki hech biri — rad", () => {
  assert.equal(resolveGrantWindow({ startDate: "2026-10-03", days: 30, endDate: "2026-12-01" }, NOW).ok, false);
  assert.equal(resolveGrantWindow({ startDate: "2026-10-03" }, NOW).ok, false);
});

test("noto'g'ri kun soni va sana rad etiladi", () => {
  for (const days of [0, -5, 1.5, VIP_MAX_DAYS + 1]) {
    assert.equal(resolveGrantWindow({ startDate: "2026-10-03", days }, NOW).ok, false, String(days));
  }
  assert.equal(resolveGrantWindow({ startDate: "2026-02-30", days: 30 }, NOW).ok, false);
  assert.equal(resolveGrantWindow({ startDate: "2026-10-03", endDate: "kecha" }, NOW).ok, false);
});

test("tayyor muddatlar: 30 / 90 / 180 / 365", () => {
  for (const days of [30, 90, 180, 365]) {
    const w = resolveGrantWindow({ startDate: "2026-10-03", days }, NOW);
    assert.ok(w.ok);
    assert.equal(w.days, days);
  }
});

/* ------------------------------------------------------------------ *
 * UZAYTIRISH
 * ------------------------------------------------------------------ */

const activeTimes = (end: Date): SubscriptionTimes => ({
  startedAt: new Date(NOW.getTime() - 10 * DAY),
  currentPeriodEnd: end,
  graceUntil: null,
});

test("N kunga uzaytirish: qolgan kunlar yo'qolmaydi, imtiyoz yo'q", () => {
  const end = new Date(NOW.getTime() + 5 * DAY);
  const out = extend("active", activeTimes(end), 30, NOW, 0);
  assert.ok(out.ok);
  assert.equal(out.result.times.currentPeriodEnd?.getTime(), end.getTime() + 30 * DAY);
  assert.equal(out.result.times.graceUntil, null);
});

test("aniq sanagacha uzaytirish faqat UZAYTIRADI", () => {
  const end = new Date(NOW.getTime() + 5 * DAY);
  const later = new Date(NOW.getTime() + 60 * DAY);
  const ok = extendTo("active", activeTimes(end), later, NOW);
  assert.ok(ok.ok);
  assert.equal(ok.result.times.currentPeriodEnd?.getTime(), later.getTime());
  assert.equal(ok.result.event, "extended");

  // Qisqartirish "uzaytirish" orqali emas.
  assert.equal(extendTo("active", activeTimes(end), new Date(NOW.getTime() + DAY), NOW).ok, false);
  // O'chirilgan obunani uzaytirib bo'lmaydi.
  assert.equal(extendTo("cancelled", activeTimes(end), later, NOW).ok, false);
});

test("uzaytirish kiritmasi: kun yoki sana (bittasi)", () => {
  assert.deepEqual(resolveExtension({ days: 90 }), { ok: true, kind: "days", days: 90 });
  const byDate = resolveExtension({ endDate: "2027-01-31" });
  assert.ok(byDate.ok && byDate.kind === "date");
  assert.equal(resolveExtension({}).ok, false);
  assert.equal(resolveExtension({ days: 30, endDate: "2027-01-31" }).ok, false);
});

/* ------------------------------------------------------------------ *
 * HOLAT: FAOL / TUGAGAN / O'CHIRILGAN
 * ------------------------------------------------------------------ */

test("admin ko'radigan holat va qolgan kun", () => {
  const end = new Date(NOW.getTime() + 2.5 * DAY);
  assert.deepEqual(vipDisplay({ state: "active", times: activeTimes(end) }, NOW), {
    status: "active",
    daysLeft: 3,
  });
  assert.equal(vipDisplay({ state: "cancelled", times: activeTimes(end) }, NOW).status, "disabled");
  assert.equal(vipDisplay({ state: "suspended", times: activeTimes(end) }, NOW).status, "disabled");
  assert.equal(vipDisplay({ state: "expired", times: activeTimes(end) }, NOW).status, "expired");
  assert.equal(vipDisplay(null, NOW).status, "none");
});

test("fon vazifasi hali yopmagan, lekin muddati o'tgan VIP — TUGAGAN", () => {
  const past = new Date(NOW.getTime() - 1000);
  assert.equal(vipDisplay({ state: "active", times: activeTimes(past) }, NOW).status, "expired");
});

test("admin ekrani va sayt huquqi BIR XIL qaror chiqaradi", () => {
  const states: SubscriptionState[] = ["pending", "active", "grace_period", "expired", "cancelled", "suspended"];
  const ends = [-DAY, -1, 1, DAY, 400 * DAY].map((d) => new Date(NOW.getTime() + d));

  for (const state of states) {
    for (const end of ends) {
      const times = activeTimes(end);
      const admin = vipDisplay({ state, times }, NOW).status === "active";
      const site = isSubscriptionGranting(
        { state, currentPeriodEnd: end, graceUntil: null, entitlements: [] },
        NOW,
      );
      assert.equal(admin, site, `${state} / ${end.toISOString()}`);
    }
  }
});

test("muddat tugashi bilan huquq YOPILADI (imtiyoz yo'q) va fon vazifasi to'g'ridan-to'g'ri expired qiladi", () => {
  const end = new Date(NOW.getTime() + 30 * DAY);
  const flags = { "vip.enabled": true, "vip.profile_editor_enabled": true } as const;
  const sub = { state: "active" as const, currentPeriodEnd: end, graceUntil: null, entitlements: ["profile.self_edit"] };

  assert.deepEqual(decide("profile.self_edit", { flags, subscription: sub, now: NOW }), { allowed: true });

  const after = new Date(end.getTime() + 1);
  assert.deepEqual(decide("profile.self_edit", { flags, subscription: sub, now: after }), {
    allowed: false,
    reason: "subscription_inactive",
  });

  assert.equal(dueTransition("active", activeTimes(end), after)?.state, "expired");
});

test("o'chirilgan VIP huquq bermaydi", () => {
  const flags = { "vip.enabled": true, "vip.profile_editor_enabled": true } as const;
  const sub = {
    state: "cancelled" as const,
    currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY),
    graceUntil: null,
    entitlements: ["profile.self_edit"],
  };
  assert.equal(decide("profile.self_edit", { flags, subscription: sub, now: NOW }).allowed, false);
});

/* ------------------------------------------------------------------ *
 * KOD VA MIGRATSIYA
 * ------------------------------------------------------------------ */

test("entitlements.ts admin va saytda bayt-baytigacha bir xil", {
  skip: existsSync("../liderlar-web/src/lib/vip/entitlements.ts") ? false : "../liderlar-web topilmadi",
}, () => {
  assert.equal(
    readFileSync("src/lib/vip/entitlements.ts", "utf8"),
    readFileSync("../liderlar-web/src/lib/vip/entitlements.ts", "utf8"),
  );
});

test("migratsiya: imtiyoz 0, VIP berish faqat service_role, sanalar bazada ham tekshiriladi", () => {
  const sql = readFileSync("supabase/migrations/20261003121000_vip_admin_control.sql", "utf8");
  assert.match(sql, /set grace_days = 0/);
  assert.match(sql, /p_started_at > now\(\) \+ interval '5 minutes'/);
  assert.match(sql, /p_period_end <= now\(\)/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
  // Faqat oldinga: ma'lumot o'chirilmaydi.
  assert.doesNotMatch(sql, /\b(drop table|truncate|delete from)\b/i);
});

test("VIP amallari vip.manage ruxsatini serverda tekshiradi", () => {
  const code = readFileSync("src/lib/actions/vip-accounts.ts", "utf8");
  const fns = code.match(/export async function \w+\(/g) ?? [];
  assert.equal(fns.length, 3);
  assert.equal((code.match(/requirePermission\("vip\.manage"\)/g) ?? []).length, 3);
});

test("VIP o'chirish ma'lumotga tegmaydi — faqat obuna holati", () => {
  const code = readFileSync("src/lib/actions/vip-accounts.ts", "utf8");
  const fn = code.match(/export async function disableVipAction\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(fn, /applyAdminAction\("cancel"/);
  assert.doesNotMatch(fn, /\.delete\(|from\("(candidates|member_articles|candidate_certificates|point_ledger|profiles|member_accounts)"\)/);
});

test("Telegram bot: VIP tugmalari va faol suhbat serverda tekshiriladi", () => {
  const router = readFileSync("src/lib/member-bot/router.ts", "utf8");
  assert.match(router, /profileDecision\(profileId, "telegram\.profile_edit"\)/);

  // Har bir VIP oqimi chaqiruvidan OLDIN tekshiruv bor.
  const reply = router.match(/async function buildReply\([\s\S]*?\n\}/)?.[0] ?? "";
  const gate = reply.indexOf("vipGate(");
  assert.ok(gate > 0, "buildReply ichida vipGate yo'q");
  for (const call of ["startEntryFlow(", "startPhotoFlow(", "startBioFlow(", "confirmEntry(", "vipMenu(", "editMenu(", "photoMenu("]) {
    const at = reply.indexOf(call);
    assert.ok(at > gate, `${call} tekshiruvdan oldin chaqirilyapti`);
  }

  // Xabar (matn/rasm) faol suhbatga yozilishidan OLDIN.
  const message = router.match(/async function handleMessage\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(message.indexOf("vipGate(") > 0);
  assert.ok(message.indexOf("vipGate(") < message.indexOf("handleIncomingPhoto("));
  assert.ok(message.indexOf("vipGate(") < message.indexOf("handleConversationText("));
});
