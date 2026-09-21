import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COVERAGE_REFUSAL_REASONS,
  DELIBERATE_REFUSAL_REASONS,
  OUTBOUND_REFUSAL_FIXES,
  OUTBOUND_REFUSAL_LABELS,
  OUTBOUND_REFUSAL_REASONS,
  isCoverageRefusal,
  type OutboundRefusalReason,
} from "../src/lib/sales/flow/outbound-guard.ts";

function src(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/* ===================================================================== *
 * JIM QOLISHNING IKKI TURI
 *
 * Jonli tizimda bot uch mijozga javob yozmadi. Sabab
 * `rollout_not_allowlisted` edi — ya'ni sozlama, suhbat emas.
 * Lekin bosqich baribir `new -> offer_sent` ga surilgan edi:
 * mijoz salomlashuvni ham, narxni ham ko'rmagan, tizim esa uni
 * "taklif yuborilgan" deb hisoblardi.
 * ===================================================================== */

test("har bir rad etish sababi ANIQ bir turga tegishli", () => {
  /*
   * Yangi sabab qo'shilganda uni tasniflash UNUTILMASLIGI kerak:
   * tasniflanmagan sabab jimgina "qaror" deb hisoblanadi va
   * bosqich yana yolg'on surilib qoladi.
   */
  const coverage = new Set<string>(COVERAGE_REFUSAL_REASONS);
  const deliberate = new Set<string>(DELIBERATE_REFUSAL_REASONS);

  for (const reason of OUTBOUND_REFUSAL_REASONS) {
    const inCoverage = coverage.has(reason);
    const inDeliberate = deliberate.has(reason);
    assert.ok(
      inCoverage !== inDeliberate,
      `"${reason}" aynan bitta turda bo'lishi kerak (qamrov: ${inCoverage}, qaror: ${inDeliberate})`,
    );
  }

  assert.equal(
    coverage.size + deliberate.size,
    OUTBOUND_REFUSAL_REASONS.length,
    "tasniflar ro'yxatida ortiqcha yoki kam sabab bor",
  );
});

test("sozlama sababli jim qolish QAMROV deb hisoblanadi", () => {
  for (const reason of [
    "rollout_not_allowlisted",
    "rollout_off",
    "rollout_test_only",
    "rollout_outside_percentage",
    "auto_reply_disabled",
    "connection_disabled",
    "no_reply_rights",
  ] as const) {
    assert.equal(isCoverageRefusal(reason), true, `${reason} qamrov bo'lishi kerak`);
  }
});

test("inson qarori va opt-out QAMROV EMAS", () => {
  /*
   * Bular qaror: mijoz xabar olmadi, lekin holat haqiqiy.
   * Bosqichni orqaga qaytarish bu yerda XATO bo'lardi — inson
   * qo'lga olgan suhbat AI hisobiga qayta tiklanardi.
   */
  assert.equal(isCoverageRefusal("human_takeover"), false);
  assert.equal(isCoverageRefusal("opted_out"), false);
});

test("har bir sabab uchun NIMA QILISH KERAK yozilgan", () => {
  for (const reason of OUTBOUND_REFUSAL_REASONS) {
    const fix = OUTBOUND_REFUSAL_FIXES[reason as OutboundRefusalReason];
    assert.ok(fix && fix.trim().length > 15, `"${reason}" uchun tuzatish yo'riqnomasi yo'q`);
    assert.notEqual(
      fix,
      OUTBOUND_REFUSAL_LABELS[reason as OutboundRefusalReason],
      `"${reason}" yo'riqnomasi yorliqning nusxasi — foyda bermaydi`,
    );
  }
});

/* ===================================================================== *
 * DVIGATEL: YETKAZILMAGAN BOSQICH ORQAGA QAYTADI
 * ===================================================================== */

test("dvigatel qamrov rad etishini YETKAZILMAGAN deb qaytaradi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");

  assert.ok(
    /return isCoverageRefusal\(decision\.reason\) \? "undelivered" : "refused";/.test(engine),
    "send() qamrov rad etishini `undelivered` deb ajratmayapti",
  );
});

test("bosqich faqat YETKAZILGANDA oldinda qoladi", () => {
  const engine = src("src/lib/sales/flow/engine.ts");

  /*
   * Ilgari bu yerda faqat `failed` tekshirilardi. `undelivered`
   * qo'shilmasa, rollout to'sgan suhbat yana yolg'on bosqichda
   * qolib ketadi — aynan shu xato jonli tizimda sodir bo'lgan.
   */
  const rollback = engine.match(/const allUndelivered =[\s\S]{0,300}?;/);
  assert.ok(rollback, "bosqichni qaytarish sharti topilmadi");
  assert.ok(
    rollback[0].includes('"undelivered"'),
    "qaytarish sharti `undelivered` ni hisobga olmayapti",
  );
  assert.ok(
    rollback[0].includes('"failed"'),
    "qaytarish sharti Telegram xatosini hisobga olmay qoldi",
  );
});

test("qamrov sababi SUHBAT QATORIGA yoziladi", () => {
  /*
   * Sabab faqat server log'ida qolsa, admin uni umuman
   * ko'rmaydi: panelda "avto-javob yoqiq" deb turaveradi.
   */
  const engine = src("src/lib/sales/flow/engine.ts");
  assert.ok(
    /last_refusal_reason/.test(engine) && /last_refusal_at/.test(engine),
    "dvigatel rad etish sababini suhbat qatoriga yozmayapti",
  );

  const migrations = src("supabase/migrations/20260921140000_sales_refusal_visibility.sql");
  assert.ok(
    /add column if not exists last_refusal_reason/.test(migrations),
    "migratsiyada ustun yo'q",
  );
});

test("sinov rejimi rad etish belgisini QOLDIRMAYDI", () => {
  /*
   * Sinov jonli suhbat qatoriga ogohlantirish yozib ketsa,
   * admin mavjud bo'lmagan nosozlikni quvib yurardi.
   */
  const engine = src("src/lib/sales/flow/engine.ts");
  const wrapper = engine.match(/async function runFlow\(input: HandleMessageInput\)[\s\S]{0,400}?\n}/);
  assert.ok(wrapper, "runFlow o'ramasi topilmadi");
  assert.ok(
    /input\.simulated !== true/.test(wrapper[0]),
    "sinov rejimi rad etish yozuvidan chiqarilmagan",
  );
});

test("suhbat sahifasi sababni ham, tuzatish yo'lini ham ko'rsatadi", () => {
  const page = src("src/app/(admin)/ai-sotuv/suhbatlar/[id]/page.tsx");
  assert.ok(/lastRefusalReason/.test(page), "sahifa sababni o'qimayapti");
  assert.ok(
    /OUTBOUND_REFUSAL_FIXES/.test(page),
    "sahifa faqat sababni ko'rsatib, nima qilishni aytmayapti",
  );
});
