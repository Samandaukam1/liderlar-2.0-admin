import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instagramProfileUrl,
  normalizeInstagram,
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


/* ------------------------------ Instagram ------------------------------ */

test("instagram: @username, username va to'liq havola bir xil kanonik shaklga keladi", () => {
  assert.equal(normalizeInstagram("liderlar_uz"), "liderlar_uz");
  assert.equal(normalizeInstagram("@liderlar_uz"), "liderlar_uz");
  assert.equal(normalizeInstagram("  @liderlar_uz  "), "liderlar_uz");
  assert.equal(normalizeInstagram("https://instagram.com/liderlar_uz"), "liderlar_uz");
  assert.equal(normalizeInstagram("http://www.instagram.com/liderlar_uz/"), "liderlar_uz");
  assert.equal(normalizeInstagram("instagram.com/liderlar_uz"), "liderlar_uz");
  assert.equal(normalizeInstagram("www.instagram.com/liderlar_uz?igsh=abc123"), "liderlar_uz");
  assert.equal(normalizeInstagram("instagr.am/liderlar_uz"), "liderlar_uz");
});

test("instagram: kanonik shakl kichik harfda va nuqtali username saqlanadi", () => {
  assert.equal(normalizeInstagram("Liderlar.UZ"), "liderlar.uz");
  assert.equal(normalizeInstagram("https://instagram.com/Liderlar.UZ/"), "liderlar.uz");
  assert.equal(instagramProfileUrl("liderlar.uz"), "https://instagram.com/liderlar.uz");
});

test("instagram: yaroqsiz qiymat username sifatida saqlanmaydi", () => {
  assert.equal(normalizeInstagram(""), null);
  assert.equal(normalizeInstagram("   "), null);
  assert.equal(normalizeInstagram(null), null);
  assert.equal(normalizeInstagram("https://facebook.com/liderlar"), null, "boshqa tarmoq");
  assert.equal(normalizeInstagram("https://t.me/liderlar"), null);
  assert.equal(normalizeInstagram("bir ikki"), null, "bo'sh joy");
  assert.equal(normalizeInstagram("..."), null, "faqat nuqtalar username emas");
  assert.equal(normalizeInstagram("a".repeat(31)), null, "30 belgidan uzun");
  assert.equal(normalizeInstagram("a".repeat(30)), "a".repeat(30));
});

test("kontakt: instagram IXTIYORIY — bo'sh bo'lsa hech narsani bloklamaydi", () => {
  const withoutField = validateContact({
    phone: "901234567",
    telegram: "@liderlar",
    consent: true,
  });
  assert.ok(withoutField.ok);
  assert.equal(withoutField.instagram, null);

  const emptyString = validateContact({
    phone: "901234567",
    telegram: "@liderlar",
    instagram: "   ",
    consent: true,
  });
  assert.ok(emptyString.ok);
  assert.equal(emptyString.instagram, null);
});

test("kontakt: instagram to'ldirilsa kanonik saqlanadi, xato bo'lsa aytiladi", () => {
  const good = validateContact({
    phone: "901234567",
    telegram: "@liderlar",
    instagram: "https://instagram.com/Liderlar_UZ/",
    consent: true,
  });
  assert.ok(good.ok);
  assert.equal(good.instagram, "liderlar_uz");

  const bad = validateContact({
    phone: "901234567",
    telegram: "@liderlar",
    instagram: "https://facebook.com/liderlar",
    consent: true,
  });
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => e.includes("Instagram")));
});
