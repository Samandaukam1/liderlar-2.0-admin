import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildDate,
  checkText,
  confirmSummary,
  CONVERSATION_STEPS,
  isStale,
  isStep,
  MONTHS_UZ,
  nextStep,
  parseDay,
  parseMonth,
  parseYear,
  savedMessage,
  STALE_AFTER_MS,
} from "../src/lib/member-bot/conversation.ts";
import {
  detectImageType,
  isPhotoTarget,
  pickLargestPhoto,
  PHOTO_TARGETS,
} from "../src/lib/member-bot/photo-rules.ts";

const NOW = new Date("2026-10-02T12:00:00Z");

/* ------------------------------------------------------------------ *
 * QADAMLAR
 * ------------------------------------------------------------------ */

test("noma'lum qadam taniladi", () => {
  for (const value of ["yoq", "", null, 1]) {
    assert.equal(isStep(value), false, String(value));
  }
  for (const step of CONVERSATION_STEPS) {
    assert.equal(isStep(step), true, step);
  }
});

test("sanasiz turlar sana qadamlarini O'TKAZIB YUBORADI", () => {
  /*
   * O'qilgan kitob yoki ijtimoiy tarmoq havolasi uchun sana so'rash
   * ma'nosiz — odam uchta keraksiz savolga javob berishga majbur
   * bo'lardi.
   */
  assert.equal(nextStep("entry_subtitle", { hasDates: false }), "entry_confirm");
  assert.equal(nextStep("entry_subtitle", { hasDates: true }), "entry_year");
});

test("sana qadamlari ketma-ketligi to'g'ri", () => {
  assert.equal(nextStep("entry_year", {}), "entry_month");
  assert.equal(nextStep("entry_month", {}), "entry_day");
  assert.equal(nextStep("entry_day", {}), "entry_confirm");
});

test("tasdiq oqimni tugatadi", () => {
  assert.equal(nextStep("entry_confirm", {}), null);
  assert.equal(nextStep("bio_text", {}), null);
  assert.equal(nextStep("photo_wait", {}), null);
});

/* ------------------------------------------------------------------ *
 * ESKIRISH
 * ------------------------------------------------------------------ */

test("eskirgan suhbat aniqlanadi", () => {
  /*
   * Odam bir hafta oldin "nomini yozing" savolida to'xtab qolsa,
   * bugun yozgan tasodifiy xabari o'sha savolga javob deb qabul
   * qilinardi.
   */
  const old = new Date(NOW.getTime() - STALE_AFTER_MS - 1000);
  assert.equal(isStale(old, NOW), true);
});

test("yangi suhbat eskirgan emas", () => {
  const recent = new Date(NOW.getTime() - 60_000);
  assert.equal(isStale(recent, NOW), false);
});

test("eskirish muddati bir kundan kam", () => {
  // Keyingi kunga yetib bormasligi kerak.
  assert.ok(STALE_AFTER_MS < 24 * 60 * 60 * 1000);
});

/* ------------------------------------------------------------------ *
 * SANA — §20
 * ------------------------------------------------------------------ */

test("kelgusi yil rad etiladi", () => {
  assert.equal(parseYear("2027", NOW), null);
  assert.equal(parseYear("2026", NOW), 2026);
});

test("yuqori chegara joriy yilga bog'langan", () => {
  /*
   * Qotib yozilgan 2030 kod 2031 yilda noto'g'ri ishlab qolardi.
   */
  const future = new Date("2030-01-01T00:00:00Z");
  assert.equal(parseYear("2029", future), 2029);
  assert.equal(parseYear("2031", future), null);
});

test("juda eski yil rad etiladi", () => {
  assert.equal(parseYear("1899", NOW), null);
  assert.equal(parseYear("1900", NOW), 1900);
});

test("raqam bo'lmagan yil rad etiladi", () => {
  for (const value of ["", "salom", "20a6", "2026.5"]) {
    assert.equal(parseYear(value, NOW), null, value);
  }
});

test("oy 1-12 oralig'ida", () => {
  assert.equal(parseMonth("0"), null);
  assert.equal(parseMonth("13"), null);
  assert.equal(parseMonth("1"), 1);
  assert.equal(parseMonth("12"), 12);
});

test("31-fevral RAD ETILADI", () => {
  /*
   * `new Date(2026, 1, 31)` xato bermaydi, 3-martga aylanadi —
   * ya'ni odam kiritgan sana profilida boshqasiga aylanib qolardi.
   */
  assert.equal(parseDay("31", 2026, 2), null);
  assert.equal(parseDay("28", 2026, 2), 28);
});

test("kabisa yili hisobga olinadi", () => {
  // 2024 kabisa, 2026 emas.
  assert.equal(parseDay("29", 2024, 2), 29);
  assert.equal(parseDay("29", 2026, 2), null);
});

test("30 kunli oyda 31-kun rad etiladi", () => {
  assert.equal(parseDay("31", 2026, 4), null);
  assert.equal(parseDay("30", 2026, 4), 30);
});

test("sana to'g'ri shaklda yasaladi", () => {
  assert.equal(buildDate(2026, 1, 5), "2026-01-05");
  assert.equal(buildDate(2026, 12, 31), "2026-12-31");
});

test("o'zbekcha oy nomlari 12 ta", () => {
  assert.equal(MONTHS_UZ.length, 12);
  assert.equal(MONTHS_UZ[0], "Yanvar");
  assert.equal(MONTHS_UZ[11], "Dekabr");
});

/* ------------------------------------------------------------------ *
 * MATN
 * ------------------------------------------------------------------ */

test("buyruq matn sifatida qabul QILINMAYDI", () => {
  /*
   * Odam suhbat o'rtasida `/start` yozsa, uni ta'lim muassasasining
   * nomi deb qabul qilish profiliga "/start" degan yozuv qo'shardi.
   */
  const result = checkText("/start");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.problem, "command");
});

test("bo'sh va qisqa matn rad etiladi", () => {
  assert.equal(checkText("").ok, false);
  assert.equal(checkText("   ").ok, false);
  assert.equal(checkText("a").ok, false);
});

test("uzun matn rad etiladi, jimgina qirqilmaydi", () => {
  const result = checkText("x".repeat(400));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.problem, "too_long");
});

test("to'g'ri matn tozalanadi", () => {
  const result = checkText("  Toshkent davlat universiteti  ");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "Toshkent davlat universiteti");
});

/* ------------------------------------------------------------------ *
 * TASDIQ VA XABARLAR — §22
 * ------------------------------------------------------------------ */

test("tasdiq xulosasi kiritilganlarni ko'rsatadi", () => {
  const summary = confirmSummary({
    title: "Toshkent davlat universiteti",
    subtitle: "Bakalavr",
    year: 2015,
    month: 9,
    day: 1,
  });
  assert.match(summary, /Toshkent davlat universiteti/);
  assert.match(summary, /Bakalavr/);
  assert.match(summary, /Sentabr/);
  assert.match(summary, /2015/);
});

test("bo'sh maydonlar xulosaga tushmaydi", () => {
  const summary = confirmSummary({ title: "Nom" });
  assert.equal(summary.includes("Qo'shimcha"), false);
  assert.equal(summary.includes("Sana"), false);
});

test("ko'rikka ketgan yozuv 'joylandi' deb AYTILMAYDI", () => {
  /*
   * §22 aynan shuni taqiqlaydi: nashr bo'lmagan narsani nashr
   * bo'lgan deb aytish yolg'on.
   */
  const review = savedMessage(true);
  assert.match(review, /Tekshiruvga/);
  assert.equal(/joylandi/.test(review), false);

  assert.match(savedMessage(false), /joylandi/);
});

/* ------------------------------------------------------------------ *
 * DAVOMLILIK — §20
 * ------------------------------------------------------------------ */

test("holat BAZADA saqlanadi, xotirada emas", () => {
  /*
   * Bot serverless funksiyada ishlaydi: har webhook so'rovi yangi
   * nusxada bajarilishi mumkin va xotiradagi holat keyingi xabarga
   * yetib bormasdi.
   */
  const sql = readFileSync(
    "supabase/migrations/20261002220000_bot_conversation_state.sql",
    "utf8",
  );
  assert.match(sql, /create table if not exists public\.bot_conversations/);
  assert.match(sql, /telegram_user_id bigint primary key/);
  assert.match(sql, /draft jsonb/);
});

test("suhbat jadvaliga RLS siyosati berilmagan", () => {
  /*
   * Unda yarim kiritilgan ma'lumot va Telegram id lari bor. RLS
   * yoqilgan va siyosatsiz jadvalda har qanday amal rad etiladi —
   * ya'ni unga faqat service_role tegadi.
   */
  const sql = readFileSync(
    "supabase/migrations/20261002220000_bot_conversation_state.sql",
    "utf8",
  );
  assert.match(sql, /alter table public\.bot_conversations enable row level security/);
  assert.equal(/create policy[^;]*bot_conversations/.test(sql), false);
});

test("conversation.ts hech narsa import qilmaydi", () => {
  const source = readFileSync("src/lib/member-bot/conversation.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.equal(/^\s*import\s/m.test(source), false);
});

/* ------------------------------------------------------------------ *
 * ROUTER ULANISHI
 * ------------------------------------------------------------------ */

function src(path: string): string {
  return readFileSync(path, "utf8");
}

/** Izohlarsiz manba — izohdagi so'zlar tekshiruvga tushmasin. */
function code(path: string): string {
  return src(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

test("faol suhbat matni oqimga ketadi, menyuga emas", () => {
  /*
   * Busiz bot har matnga menyu chizardi va bosqichma-bosqich
   * ma'lumot kiritish umuman ishlamasdi.
   */
  const router = src("src/lib/member-bot/router.ts");
  const flowAt = router.indexOf("handleConversationText(from.id, profileId, text)");
  const menuAt = router.indexOf("// Boshqa har qanday matn");

  assert.ok(flowAt > 0, "oqim chaqiruvi yo'q");
  assert.ok(menuAt > flowAt, "menyu oqimdan oldin tekshirilyapti");
});

test("mavjud menyu oqimi saqlangan", () => {
  /*
   * §19: ikkinchi bot yaratilmaydi va mavjud bot buzilmaydi.
   * Bog'lash va asosiy menyu o'z joyida qolishi kerak.
   */
  const router = src("src/lib/member-bot/router.ts");
  assert.match(router, /consumeTelegramLink/);
  assert.match(router, /mainMenu\(await displayName\(profileId\)\)/);
  assert.match(router, /notLinkedMessage/);
});

test("shaxs telegram ID bo'yicha aniqlanadi, username bo'yicha emas", () => {
  /*
   * §19: "Never identify a user by Telegram @username alone."
   * Username o'zgaradi va boshqa odam uni olishi mumkin.
   */
  const router = src("src/lib/member-bot/router.ts");
  assert.match(router, /findProfileByTelegramId\(from\.id\)/);
  assert.match(router, /findProfileByTelegramId\(query\.from\.id\)/);

  // Oqim username ga umuman tegmaydi — IZOHLARSIZ tekshiramiz.
  assert.equal(/telegram_username/.test(code("src/lib/member-bot/vip-flow.ts")), false);
});

test("boshqa profilga tegishli suhbat tashlanadi", () => {
  /*
   * Telegram akkaunti boshqa profilga qayta bog'langan bo'lishi
   * mumkin. Eski suhbatni davom ettirish yozuvni BOSHQA ODAMNING
   * profiliga qo'shib qo'yardi (§62 AB-bandi).
   */
  const flow = src("src/lib/member-bot/vip-flow.ts");
  assert.match(flow, /conversation\.profileId !== profileId/);
});

test("review_state siyosatdan olinadi, suhbatdan emas", () => {
  /*
   * §43: foydalanuvchi o'z yozuvini darhol nashr qilib qo'ymasligi
   * kerak.
   */
  const flow = src("src/lib/member-bot/vip-flow.ts");
  assert.match(flow, /rule\.policy === "review" \? "pending_review" : "published"/);
  // `draft` dan olinmasligi kerak.
  assert.equal(/review_state: draft\./.test(flow), false);
});

test("bo'limlar ro'yxati REYESTRDAN olinadi", () => {
  /*
   * Qo'lda sanash saytdagi ro'yxat bilan ajralib ketishga olib
   * kelardi: saytda yangi bo'lim paydo bo'lsa, botda ko'rinmasdi.
   */
  const flow = src("src/lib/member-bot/vip-flow.ts");
  assert.match(flow, /Object\.keys\(ENTRY_RULES\)/);
});

test("tasdiq faqat TUGMA bilan beriladi", () => {
  /*
   * "ha" deb yozilgan xabarni tasdiq deb qabul qilish tasodifiy
   * saqlashga olib kelardi.
   */
  const flow = src("src/lib/member-bot/vip-flow.ts");
  const at = flow.indexOf('case "entry_confirm":');
  const body = flow.slice(at, at + 400);
  assert.match(body, /Tasdiqlash uchun tugmani bosing/);
});

test("bekor qilish har qadamda ishlaydi", () => {
  const flow = src("src/lib/member-bot/vip-flow.ts");
  // Qadam tekshiruvidan OLDIN turishi kerak.
  const cancelAt = flow.indexOf("/^\\/bekor/i");
  const switchAt = flow.indexOf("switch (conversation.step)");
  assert.ok(cancelAt > 0 && cancelAt < switchAt, "bekor qilish switch dan keyin");
});

/* ------------------------------------------------------------------ *
 * RASM YUKLASH — §21
 * ------------------------------------------------------------------ */

test("Telegram eng KATTA rasm o'lchamini tanlaydi", () => {
  /*
   * Telegram bir rasmni bir necha o'lchamda yuboradi, kichikdan
   * kattaga. Birinchisini olsak, profilga 90px rasm tushardi.
   */
  const photos = [
    { file_id: "kichik", file_size: 1000 },
    { file_id: "orta", file_size: 5000 },
    { file_id: "katta", file_size: 50000 },
  ];
  const picked = pickLargestPhoto(photos);
  assert.equal(picked?.fileId, "katta");
});

test("rasmsiz xabar null qaytaradi", () => {
  assert.equal(pickLargestPhoto(undefined), null);
  assert.equal(pickLargestPhoto([]), null);
  assert.equal(pickLargestPhoto([{ file_size: 10 }]), null);
});

test("noma'lum rasm maqsadi rad etiladi", () => {
  /*
   * Maqsad bucket nomini belgilaydi — erkin qiymat qabul qilinsa,
   * ixtiyoriy bucketga yozish imkoni paydo bo'lardi (§21).
   */
  for (const value of ["admin-private-files", "journal-pdfs", "", null, 1]) {
    assert.equal(isPhotoTarget(value), false, String(value));
  }
  assert.equal(isPhotoTarget("avatar"), true);
  assert.equal(isPhotoTarget("gallery"), true);
});

test("rasm maqsadlari faqat nomzod bucketlariga ishora qiladi", () => {
  for (const target of Object.values(PHOTO_TARGETS)) {
    assert.match(target.bucket, /^candidate-/, target.bucket);
  }
});

test("tur IMZO bo'yicha aniqlanadi, MIME sarlavhasi bo'yicha emas", () => {
  /*
   * Telegram bergan `content-type` — yuboruvchi aytgan qiymat va
   * almashtirilishi mumkin. Imzo esa faylning o'zida.
   */
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(detectImageType(jpeg), { mime: "image/jpeg", ext: "jpg" });

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.deepEqual(detectImageType(png), { mime: "image/png", ext: "png" });

  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]);
  assert.deepEqual(detectImageType(webp), { mime: "image/webp", ext: "webp" });
});

test("SVG va boshqa fayllar rad etiladi", () => {
  /*
   * SVG ichida skript bo'lishi mumkin va u ommaviy profilda
   * saqlangan XSS bo'lardi (§58).
   */
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
  assert.equal(detectImageType(svg), null);

  const html = new TextEncoder().encode("<!DOCTYPE html><script>alert(1)");
  assert.equal(detectImageType(html), null);

  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(detectImageType(pdf), null);
});

test("juda qisqa fayl rad etiladi", () => {
  // Imzoni o'qishga yetmaydigan fayl.
  assert.equal(detectImageType(new Uint8Array([0xff, 0xd8])), null);
});

test("Telegram fayl havolasi saqlanmaydi", () => {
  /*
   * §21: to'liq havolada BOT TOKENI bo'ladi. Uni bazaga yozish
   * tokenni oshkor qilardi va havola baribir ~1 soatda eskirardi.
   */
  const flow = code("src/lib/member-bot/photo-flow.ts");
  assert.equal(/api\.telegram\.org/.test(flow), false, "telegram havolasi topildi");
  // Fayl mazmuni ko'chiriladi.
  assert.match(flow, /storage\s*\n?\s*\.from\(rule\.bucket\)\s*\n?\s*\.upload\(/);
});

test("manzil serverda yasaladi, Telegram fayl nomidan emas", () => {
  /*
   * Telegram bergan nomda `../` yoki boshqa belgilar bo'lishi
   * mumkin va u yo'l in'ektsiyasiga olib kelardi.
   */
  const flow = code("src/lib/member-bot/photo-flow.ts");
  assert.match(flow, /randomUUID\(\)/);
  assert.match(flow, /candidates\/\$\{candidate\.id\}/);
  assert.match(flow, /upsert: false/);
});

test("hajm ikki marta tekshiriladi", () => {
  /*
   * Telegram bergan qiymatga yakka ishonib bo'lmaydi, lekin undan
   * oldin tekshirish tarmoq va xotirani tejaydi.
   */
  const flow = code("src/lib/member-bot/photo-flow.ts");
  assert.match(flow, /photo\.sizeBytes !== null && photo\.sizeBytes > rule\.maxBytes/);

  const api = code("src/lib/member-bot/bot-api.ts");
  assert.match(api, /declared > maxBytes/);
  assert.match(api, /buffer\.byteLength > maxBytes/);
});

test("rasm reyestrga egalik bilan yoziladi", () => {
  // Busiz fayl bucketda "egasiz" qolardi.
  const flow = code("src/lib/member-bot/photo-flow.ts");
  assert.match(flow, /from\("candidate_media"\)\.insert/);
  assert.match(flow, /uploaded_by: profileId/);
});
