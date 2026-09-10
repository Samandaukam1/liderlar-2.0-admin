import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildChannelConfirmedCaption,
  buildChannelReminderCaption,
  channelConfirmCallbackData,
  CHANNEL_CONFIRM_LABEL,
  parseChannelConfirmCallback,
  TELEGRAM_CAPTION_LIMIT,
  upperCaseName,
} from "../src/lib/post-studio/channel-reminder-message.ts";

const POST_ID = "3f1c9a2e-5b47-4d81-9c30-7ae2f6b81d54";

/* ------------------------------- callback ------------------------------- */

test("callback data round-trips and stays inside Telegram's 64-byte cap", () => {
  const data = channelConfirmCallbackData(POST_ID);
  assert.equal(parseChannelConfirmCallback(data), POST_ID);
  assert.ok(Buffer.byteLength(data, "utf8") <= 64, `${data} is too long`);
});

test("tugmada aynan “QO‘YILDI” yozuvi turadi", () => {
  // Talab aynan shu so'z bilan berilgan; tugma matni o'zgarsa,
  // muharrir uni boshqa amal deb o'ylashi mumkin.
  assert.ok(CHANNEL_CONFIRM_LABEL.includes("QO‘YILDI"));
  assert.ok(!CHANNEL_CONFIRM_LABEL.includes("?"), "tugma savol emas, javob");
});

test("callback data rejects anything that is not ours", () => {
  // Boshqa funksiyaning tugmasi, kesilgan payload yoki uuid bo'lmagan
  // matn — hech biri bazaga so'rovga aylanmasligi kerak.
  for (const bad of [
    undefined,
    null,
    "",
    "crm:w:t:1",
    "pay:yes:" + POST_ID,
    "chn:",
    "chn:not-a-uuid",
    `chn:${POST_ID.slice(0, 30)}`,
    "chn:'; drop table candidate_social_posts;--",
  ]) {
    assert.equal(parseChannelConfirmCallback(bad as string | null | undefined), null, String(bad));
  }
});

/* -------------------------------- caption ------------------------------- */

test("savol BOSH HARFLARDA va ikkita ikonka bilan chiqadi", () => {
  const caption = buildChannelReminderCaption({
    fullName: "Karimov Aziz Abdullayevich",
    articleUrl: "https://liderlar.uz/liderlar/karimov-aziz",
    attempt: 1,
  });

  assert.ok(caption.startsWith("📢 KANALGA QO‘YILDIMI?"), caption);
  assert.ok(caption.includes("🖼 KARIMOV AZIZ ABDULLAYEVICH"));
  assert.ok(caption.includes("https://liderlar.uz/liderlar/karimov-aziz"));
});

test("o‘zbek ismi lotin “i” bilan buzilmaydi", () => {
  // Locale berilsa (masalan "tr") "i" → "İ" bo'lib, ism boshqa odamning
  // ismiga aylanardi. O'zbek lotinida bunday harf yo'q.
  assert.equal(upperCaseName("Islomov Ilhom"), "ISLOMOV ILHOM");
  assert.ok(!upperCaseName("Islomov Ilhom").includes("İ"));

  // Apostrof variantlari katta harf emas — ular o'z holicha qoladi.
  assert.equal(upperCaseName("G‘ulomov O‘ktam"), "G‘ULOMOV O‘KTAM");
  assert.equal(upperCaseName("  Ortiqov   Sardor  "), "ORTIQOV SARDOR");
});

test("havolasiz post uchun bo‘sh havola qatori CHIQMAYDI", () => {
  for (const url of [null, undefined, "", "   "]) {
    const caption = buildChannelReminderCaption({
      fullName: "Karimov Aziz",
      articleUrl: url,
      attempt: 1,
    });
    assert.ok(!caption.includes("🔗"), String(url));
  }
});

test("ismsiz post ham savolni yo‘qotmaydi", () => {
  const caption = buildChannelReminderCaption({ fullName: "   ", attempt: 1 });
  assert.ok(caption.includes("KANALGA QO‘YILDIMI?"));
  assert.ok(caption.includes("(ISMI YO‘Q)"), "bo‘sh qator o‘rniga aniq belgi");
});

test("takroriylik yashirilmaydi — nechanchi marta so‘ralayotgani yoziladi", () => {
  const first = buildChannelReminderCaption({ fullName: "Karimov Aziz", attempt: 1 });
  assert.ok(!first.includes("marta so‘ralmoqda"), "birinchi so‘rashda takror yo‘q");

  const third = buildChannelReminderCaption({ fullName: "Karimov Aziz", attempt: 3 });
  assert.ok(third.includes("3-marta so‘ralmoqda"));
});

test("uzun ism ham Telegram izoh chegarasida qoladi", () => {
  const caption = buildChannelReminderCaption({
    fullName: "Familiya".repeat(300),
    articleUrl: `https://liderlar.uz/liderlar/${"x".repeat(400)}`,
    attempt: 9,
  });
  assert.ok(caption.length <= TELEGRAM_CAPTION_LIMIT, `${caption.length} belgi`);
});

test("tasdiqlangan xabar savolga o‘xshamaydi", () => {
  const done = buildChannelConfirmedCaption("Karimov Aziz");
  assert.ok(done.includes("KANALGA QO‘YILDI"));
  assert.ok(!done.includes("QO‘YILDIMI?"), "savol belgisi qolmasin");
  assert.ok(done.includes("KARIMOV AZIZ"));
});

/* ------------------------------ integration ----------------------------- */

const service = readFileSync("src/lib/post-studio/channel-reminder.ts", "utf8");
const router = readFileSync("src/lib/post-studio/bot-router.ts", "utf8");
const cron = readFileSync("src/app/api/cron/post-pipeline/route.ts", "utf8");

/** Izohlar tashlanadi: tekshiruv KODNI o‘qishi kerak, izohni emas. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("tasdiqlangan post QAYTA so‘ralmaydi", () => {
  // Bu butun talabning o'zi: "qo'yildi bosilsa boshqa chiqmasin".
  assert.ok(
    code(service).includes('.is("channel_confirmed_at", null)'),
    "sweep so‘rovi tasdiqlanganlarni chiqarib tashlashi shart",
  );
});

test("tasdiqlash IKKI marta hisoblanmaydi", () => {
  // Savol bir nechta chatga ketadi va ikki muharrir bir vaqtda bosishi
  // mumkin. Shart update'ning O'ZIDA bo'lishi kerak, `select` + `update`
  // da emas: ikkalasi ham "hali tasdiqlanmagan" deb o'qib qolardi.
  const confirm = code(service).slice(code(service).indexOf("export async function confirmChannelPost"));
  const update = confirm.indexOf(".update(");
  const guard = confirm.indexOf('.is("channel_confirmed_at", null)');
  assert.ok(guard > update && guard !== -1, "guard update zanjirining ichida bo‘lsin");
});

test("yetkazilmagan post haqida so‘ralmaydi", () => {
  assert.ok(code(service).includes('.not("telegram_last_sent_at", "is", null)'));
});

test("eslatma tungi soatlarda yuborilmaydi", () => {
  // To'lov savoli bilan bir xil sokin oyna: eslatma javob berilmaguncha
  // takrorlanadi, ya'ni oynasiz u kechasi ham kelib turardi.
  assert.ok(code(service).includes("withinAskingHours"));
});

test("yuborilmagan urinish “so‘raldi” deb hisoblanmaydi", () => {
  // Aks holda "5-marta so'ralmoqda" deb yozilgan post aslida bir marta
  // ham ko'rsatilmagan bo'lishi mumkin edi.
  assert.ok(
    code(service).includes("markAsked(post.id, post.channel_reminder_count)"),
    "uzilishda hisoblagich oshirilmasin",
  );
  assert.ok(code(service).includes("markAsked(post.id, attempt)"));
});

test("izoh MarkdownV2 bilan yuborilmaydi", () => {
  // Izohda erkin matn — ism. MarkdownV2 bo'lsa ismdagi bitta nuqta yoki
  // chiziqcha butun yuborishni 400 bilan yiqitardi.
  assert.ok(code(service).includes("parseMode: null"));
});

test("tugma faqat tahririyat chatida ishlaydi", () => {
  const branch = code(router).slice(
    code(router).indexOf("parseChannelConfirmCallback(query.data)"),
  );
  const guard = branch.indexOf("isEditorialChat");
  const confirm = branch.indexOf("confirmChannelPost(");
  assert.ok(guard !== -1 && guard < confirm, "ruxsat tekshiruvi tasdiqlashdan OLDIN");
});

test("javob rasm izohi orqali yoziladi, matn orqali emas", () => {
  // `editMessageText` rasm ostida "there is no text in the message to
  // edit" bilan rad etiladi va tugma joyida qolib ketardi.
  const branch = code(router).slice(
    code(router).indexOf("parseChannelConfirmCallback(query.data)"),
  );
  const end = branch.indexOf("parseBlacklistCallback");
  const scoped = branch.slice(0, end === -1 ? undefined : end);
  assert.ok(scoped.includes("editTelegramMessageCaption("));
  assert.ok(!scoped.includes("editTelegramMessageText("));
});

test("sweep cron'dan chaqiriladi", () => {
  assert.ok(code(cron).includes("runChannelReminderSweep("));
});

test("funksiyadan oldingi postlar butun tarixni navbatga qo‘ymaydi", () => {
  // Chegarasiz birinchi sweep har yetkazilgan postni so'rardi va
  // tahririyat chatiga yuzlab rasm quyilardi.
  assert.ok(code(service).includes('.gte("telegram_last_sent_at", CHANNEL_REMINDER_ORIGIN_ISO)'));

  // Eski postlar "tasdiqlangan" deb BELGILANMAYDI ham — hech kim
  // ularni tasdiqlamagan, va bo'lmagan qarorni bazaga yozish yolg'on.
  const migration = readFileSync(
    "supabase/migrations/20260910160000_channel_post_confirmation.sql",
    "utf8",
  );
  assert.ok(
    !/update\s+public\.candidate_social_posts/i.test(migration),
    "migratsiya mavjud qatorlarga qiymat yozmasin",
  );
  assert.ok(!/\bdrop\b|\btruncate\b/i.test(migration), "non-destructive");
});

/**
 * Chegara qiymati SERVER modulida turadi (u `@/` aliaslarini ishlatadi va
 * node:test uni yuklay olmaydi), shuning uchun manbadan o'qiladi.
 */
const ORIGIN_LITERAL =
  service.match(/CHANNEL_REMINDER_ORIGIN_ISO\s*=\s*"([^"]+)"/)?.[1] ?? "";

test("amaliyot BUGUNDAN — Toshkent yarim tunidan boshlanadi", () => {
  // UTC yarim tuni emas: tahririyat kuni Toshkentda boshlanadi, va
  // "bugun chiqqan post" degani ham shu. UTC bo'yicha olinsa, bugun
  // soat 00:00–05:00 orasida chiqqan postlar chegaradan tushib qolardi.
  assert.ok(ORIGIN_LITERAL, "chegara qiymati topilsin");
  const origin = new Date(ORIGIN_LITERAL);
  assert.ok(Number.isFinite(origin.getTime()), "yaroqli sana");

  const tashkent = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(origin);
  const part = (type: string) => tashkent.find((p) => p.type === type)?.value;

  assert.equal(part("hour"), "00", "Toshkent yarim tuni");
  assert.equal(part("minute"), "00");
  assert.equal(`${part("year")}-${part("month")}-${part("day")}`, "2026-09-10");
});

test("chegara QOTIB turadi — har yugurishda qayta hisoblanmaydi", () => {
  // "Bugun" deb hisoblansa, ertaga bugungi postlar chegaradan tushib
  // qolardi va ular haqida hech qachon so'ralmasdi.
  const declaration = service.match(/CHANNEL_REMINDER_ORIGIN_ISO\s*=\s*(.+);/)?.[1] ?? "";
  assert.match(declaration, /^"[\d-]+T[\d:]+Z"$/, "qat’iy satr bo‘lsin, hisoblanadigan qiymat emas");
  assert.ok(!/new Date|Date\.now|tashkent/i.test(declaration), "har yugurishda qayta hisoblanmasin");
});
