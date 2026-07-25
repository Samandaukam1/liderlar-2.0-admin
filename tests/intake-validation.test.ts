import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhoneE164,
  normalizeTelegram,
  validateContact,
  composeFullName,
} from "../src/lib/intake/schemas.ts";
import { canAdvanceAnswer, tiptapToPlainText, NO_ANSWER_TEXT } from "../src/lib/intake/constants.ts";

test("telefon E.164 normalizatsiyasi", () => {
  assert.equal(normalizePhoneE164("901234567"), "+998901234567"); // 9 xonali lokal
  assert.equal(normalizePhoneE164("+998 90 123 45 67"), "+998901234567");
  assert.equal(normalizePhoneE164("998901234567"), "+998901234567");
  assert.equal(normalizePhoneE164("00998901234567"), "+998901234567");
  assert.equal(normalizePhoneE164("123"), null); // juda qisqa
  assert.equal(normalizePhoneE164(""), null);
});

test("telegram username normalizatsiyasi (@ bilan/‘siz)", () => {
  assert.equal(normalizeTelegram("user_name"), "@user_name");
  assert.equal(normalizeTelegram("@user_name"), "@user_name");
  assert.equal(normalizeTelegram("abcd"), null); // 4 belgi — juda qisqa
  assert.equal(normalizeTelegram("bad space"), null);
  assert.equal(normalizeTelegram("@yaxshi_nom5"), "@yaxshi_nom5");
});

test("kontakt validatsiyasi: rozilik majburiy", () => {
  const bad = validateContact({ phone: "901234567", telegram: "@abcde", consent: false });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.some((e) => e.toLowerCase().includes("rozilik")));

  const ok = validateContact({ phone: "901234567", telegram: "abcde", consent: true });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.phone, "+998901234567");
    assert.equal(ok.telegram, "@abcde");
  }
});

test("kontakt validatsiyasi: noto'g'ri telefon/telegram", () => {
  const r = validateContact({ phone: "12", telegram: "no", consent: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.length, 2);
});

test("to'liq ism tuzilishi (Familiya Ism Otasining ismi)", () => {
  assert.equal(
    composeFullName({ first_name: "Aziza", last_name: "Karimova", father_name: "Akmalovna" }),
    "Karimova Aziza Akmalovna",
  );
  assert.equal(composeFullName({ first_name: "Bek", last_name: "Aliyev", father_name: "" }), "Aliyev Bek");
});

test("progression guard: keyingi savolga o'tish sharti", () => {
  assert.equal(canAdvanceAnswer("answered", "javob bor"), true);
  assert.equal(canAdvanceAnswer("answered", "   "), false); // bo'sh
  assert.equal(canAdvanceAnswer("no_answer", NO_ANSWER_TEXT), true);
  assert.equal(canAdvanceAnswer("no_answer", "boshqa"), false);
  assert.equal(canAdvanceAnswer("unanswered", "nimadir"), false);
});

test("TipTap JSON dan plain text ajratish", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Salom" }] },
      { type: "paragraph", content: [{ type: "text", text: "dunyo" }] },
    ],
  };
  const text = tiptapToPlainText(doc);
  assert.ok(text.includes("Salom"));
  assert.ok(text.includes("dunyo"));
  assert.equal(tiptapToPlainText(null), "");
});
