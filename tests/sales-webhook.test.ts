import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isValidWebhookSecret } from "../src/lib/sales/webhook-auth.ts";
import {
  conversationKey,
  messageDedupeKey,
  parseSalesUpdate,
  resolveDirection,
  resolveMessageType,
  shouldApplyMessage,
} from "../src/lib/sales/update-parser.ts";
import {
  ALLOWED_SALES_BOT_METHODS,
  assertAllowedSalesMethod,
  SalesAutoReplyBlockedError,
  SALES_ALLOWED_UPDATES,
} from "../src/lib/sales/telegram-sales-api.ts";

const OWNER = 111;
const CUSTOMER = 222;
const CONNECTION = "bc-1";

const businessMessage = (over: Record<string, unknown> = {}) => ({
  business_message: {
    message_id: 10,
    business_connection_id: CONNECTION,
    date: 1_760_000_000,
    from: { id: CUSTOMER, username: "mijoz", first_name: "Aziz" },
    chat: { id: CUSTOMER, type: "private", username: "mijoz", first_name: "Aziz" },
    text: "Narxi qancha?",
    ...over,
  },
});

/* ---------------------------- webhook sekreti ---------------------------- */

test("webhook sekreti: to‘g‘ri qiymat o‘tadi, boshqasi o‘tmaydi", () => {
  assert.equal(isValidWebhookSecret("s3cret", "s3cret"), true);
  assert.equal(isValidWebhookSecret("s3cret", "s3cre"), false);
  assert.equal(isValidWebhookSecret("s3cret", "s3crea"), false);
  assert.equal(isValidWebhookSecret("s3cret", "S3CRET"), false);
});

test("sekret sozlanmagan bo‘lsa webhook OCHIQ QOLMAYDI", () => {
  // "Sozlanmagan" != "hamma uchun ochiq". Bu regressiya butun xom
  // yozishmani begonaga ochib yuborardi.
  assert.equal(isValidWebhookSecret(undefined, "nimadir"), false);
  assert.equal(isValidWebhookSecret("", "nimadir"), false);
  assert.equal(isValidWebhookSecret(null, ""), false);
});

test("sarlavha yo‘q bo‘lsa ham rad etiladi", () => {
  assert.equal(isValidWebhookSecret("s3cret", null), false);
  assert.equal(isValidWebhookSecret("s3cret", undefined), false);
  assert.equal(isValidWebhookSecret("s3cret", ""), false);
});

/* ------------------------------- yo‘nalish ------------------------------- */

test("ulanish egasi ma’lum: undan kelgan xabar chiquvchi", () => {
  assert.equal(
    resolveDirection({ fromId: OWNER, chatId: CUSTOMER, ownerUserId: OWNER }),
    "outgoing",
  );
  assert.equal(
    resolveDirection({ fromId: CUSTOMER, chatId: CUSTOMER, ownerUserId: OWNER }),
    "incoming",
  );
});

test("ulanish hali saqlanmagan: chat id bo‘yicha zaxira qoida", () => {
  // Birinchi business_message ulanish update'idan oldin kelishi mumkin.
  assert.equal(resolveDirection({ fromId: CUSTOMER, chatId: CUSTOMER }), "incoming");
  assert.equal(resolveDirection({ fromId: OWNER, chatId: CUSTOMER }), "outgoing");
  assert.equal(resolveDirection({ fromId: null, chatId: CUSTOMER }), "incoming");
});

test("parse: mijoz xabari incoming, sotuvchi xabari outgoing", () => {
  const incoming = parseSalesUpdate(businessMessage(), { ownerUserId: OWNER });
  assert.equal(incoming.kind, "message");
  assert.equal(incoming.kind === "message" && incoming.message.direction, "incoming");

  const outgoing = parseSalesUpdate(
    businessMessage({ from: { id: OWNER, username: "sotuvchi" }, text: "500 000 so‘m" }),
    { ownerUserId: OWNER },
  );
  assert.equal(outgoing.kind === "message" && outgoing.message.direction, "outgoing");
});

test("mijoz DOIM chat’dan olinadi, from’dan emas", () => {
  // Aks holda sotuvchi o'zining chiquvchi xabari orqali "mijoz" bo'lib
  // ro'yxatga tushib qolardi.
  const parsed = parseSalesUpdate(
    businessMessage({ from: { id: OWNER, username: "sotuvchi", first_name: "Sotuvchi" } }),
    { ownerUserId: OWNER },
  );
  assert.equal(parsed.kind, "message");
  if (parsed.kind !== "message") return;
  assert.equal(parsed.message.contact?.telegramUserId, CUSTOMER);
  assert.equal(parsed.message.contact?.username, "mijoz");
  assert.equal(parsed.message.fromUsername, "sotuvchi");
});

/* ------------------------------ xabar turi ------------------------------- */

test("xabar turi aniqlanadi va matn caption’dan ham olinadi", () => {
  assert.equal(resolveMessageType({ text: "salom" }), "text");
  assert.equal(resolveMessageType({ photo: [{}] }), "photo");
  assert.equal(resolveMessageType({ voice: {} }), "voice");
  // animation doim document bilan birga keladi — animation ustun turishi kerak.
  assert.equal(resolveMessageType({ animation: {}, document: {} }), "animation");
  assert.equal(resolveMessageType({}), "other");

  const parsed = parseSalesUpdate(
    businessMessage({ text: undefined, photo: [{}], caption: "Sertifikat" }),
    { ownerUserId: OWNER },
  );
  assert.equal(parsed.kind === "message" && parsed.message.messageType, "photo");
  assert.equal(parsed.kind === "message" && parsed.message.text, "Sertifikat");
});

test("metadata minimal: fayl id, telefon yoki token saqlanmaydi", () => {
  const parsed = parseSalesUpdate(
    businessMessage({
      photo: [{ file_id: "AgACAgIAAxk-SECRET-FILE-ID" }],
      caption: "rasm",
      text: undefined,
      reply_to_message: { message_id: 9 },
    }),
    { ownerUserId: OWNER },
  );
  assert.equal(parsed.kind, "message");
  if (parsed.kind !== "message") return;
  const serialized = JSON.stringify(parsed.message.metadata);
  assert.ok(!serialized.includes("file_id"));
  assert.ok(!serialized.includes("AgACAgIAAxk"));
  assert.deepEqual(parsed.message.metadata, {
    messageType: "photo",
    isReply: true,
    isForwarded: false,
    hasCaption: true,
  });
});

/* ------------------------------- update turlari --------------------------- */

test("business_connection tahlil qilinadi (can_reply va rights shakllari)", () => {
  const legacy = parseSalesUpdate({
    business_connection: {
      id: CONNECTION,
      user: { id: OWNER, username: "sotuvchi" },
      date: 1_760_000_000,
      can_reply: true,
      is_enabled: true,
    },
  });
  assert.equal(legacy.kind, "connection");
  assert.equal(legacy.kind === "connection" && legacy.connection.canReply, true);
  assert.equal(legacy.kind === "connection" && legacy.connection.ownerTelegramUserId, OWNER);

  // Bot API 9.0 `can_reply` o'rniga `rights` obyektini beradi.
  const modern = parseSalesUpdate({
    business_connection: {
      id: CONNECTION,
      user: { id: OWNER },
      rights: { can_reply: true },
      is_enabled: false,
    },
  });
  assert.equal(modern.kind === "connection" && modern.connection.canReply, true);
  assert.equal(modern.kind === "connection" && modern.connection.isEnabled, false);
});

test("edited_business_message tahrir sifatida belgilanadi", () => {
  const parsed = parseSalesUpdate(
    {
      edited_business_message: {
        message_id: 10,
        business_connection_id: CONNECTION,
        date: 1_760_000_000,
        edit_date: 1_760_000_500,
        from: { id: CUSTOMER },
        chat: { id: CUSTOMER, type: "private" },
        text: "Tuzatilgan matn",
      },
    },
    { ownerUserId: OWNER },
  );
  assert.equal(parsed.kind, "message");
  assert.equal(parsed.kind === "message" && parsed.edited, true);
  assert.ok(parsed.kind === "message" && parsed.message.editedAt);
});

test("deleted_business_messages id ro‘yxatini beradi", () => {
  const parsed = parseSalesUpdate({
    deleted_business_messages: {
      business_connection_id: CONNECTION,
      chat: { id: CUSTOMER },
      message_ids: [10, 11, "x" as unknown as number],
    },
  });
  assert.equal(parsed.kind, "deleted");
  assert.deepEqual(parsed.kind === "deleted" && parsed.deletion.telegramMessageIds, [10, 11]);
});

test("0.1 doirasidan tashqari update e’tiborsiz qoldiriladi", () => {
  // Botga to'g'ridan-to'g'ri yozilgan oddiy xabar 0.1 da yig'ilmaydi va
  // unga javob berilmaydi.
  for (const update of [
    { message: { message_id: 1, chat: { id: 5 }, text: "salom" } },
    { callback_query: { id: "1" } },
    {},
    null,
    "matn",
    42,
  ]) {
    assert.equal(parseSalesUpdate(update).kind, "ignored", JSON.stringify(update));
  }
});

test("majburiy maydonsiz business_message saqlanmaydi", () => {
  assert.equal(
    parseSalesUpdate({ business_message: { message_id: 1, chat: { id: 5 } } }).kind,
    "ignored",
  );
  assert.equal(
    parseSalesUpdate({
      business_message: { business_connection_id: CONNECTION, chat: { id: 5 }, date: 1 },
    }).kind,
    "ignored",
  );
});

/* --------------------------- takrorlanish himoyasi ------------------------ */

test("takror kalit ulanish + chat + xabar id dan iborat", () => {
  assert.equal(messageDedupeKey(CONNECTION, CUSTOMER, 10), "bc-1:222:10");
  // Turli ulanishdagi bir xil chat/xabar id — boshqa yozuv.
  assert.notEqual(messageDedupeKey("bc-2", CUSTOMER, 10), messageDedupeKey(CONNECTION, CUSTOMER, 10));
  assert.equal(conversationKey(CONNECTION, CUSTOMER), "bc-1:222");
});

test("oddiy takror HECH QACHON qayta yozilmaydi", () => {
  const existing = { editedAt: null, deletedAt: null };
  assert.equal(shouldApplyMessage({ edited: false, editedAt: null }, existing), false);
  // Yangi xabar — albatta yoziladi.
  assert.equal(shouldApplyMessage({ edited: false, editedAt: null }, null), true);
});

test("tahrir faqat yangiroq bo‘lsa qo‘llanadi", () => {
  const existing = { editedAt: "2026-01-02T00:00:00.000Z", deletedAt: null };
  assert.equal(
    shouldApplyMessage({ edited: true, editedAt: "2026-01-03T00:00:00.000Z" }, existing),
    true,
  );
  // Eski tahrir yangisini bosib ketmasin.
  assert.equal(
    shouldApplyMessage({ edited: true, editedAt: "2026-01-01T00:00:00.000Z" }, existing),
    false,
  );
  // Bazada tahrir yo'q edi — birinchi tahrir qo'llanadi.
  assert.equal(
    shouldApplyMessage({ edited: true, editedAt: "2026-01-01T00:00:00.000Z" }, {
      editedAt: null,
      deletedAt: null,
    }),
    true,
  );
});

/* --------------------------- AVTO-JAVOB YO‘QLIGI -------------------------- */

test("oq ro‘yxatdagi metodlarning birortasi ham xabar yubormaydi", () => {
  assert.deepEqual([...ALLOWED_SALES_BOT_METHODS], [
    "getMe",
    "getWebhookInfo",
    "setWebhook",
    "deleteWebhook",
  ]);
  for (const method of ALLOWED_SALES_BOT_METHODS) {
    assert.doesNotThrow(() => assertAllowedSalesMethod(method));
  }
});

test("mijozga xabar yuboradigan har qanday metod bloklanadi", () => {
  const blocked = [
    "sendMessage",
    "sendPhoto",
    "sendDocument",
    "sendChatAction",
    "copyMessage",
    "forwardMessage",
    "editMessageText",
    "answerCallbackQuery",
    "sendVoice",
    "sendSticker",
  ];
  for (const method of blocked) {
    assert.throws(
      () => assertAllowedSalesMethod(method),
      (err: unknown) => err instanceof SalesAutoReplyBlockedError,
      `${method} bloklanishi kerak edi`,
    );
  }
});

test("Telegram’dan faqat 0.1 doirasidagi update’lar so‘raladi", () => {
  assert.deepEqual([...SALES_ALLOWED_UPDATES], [
    "business_connection",
    "business_message",
    "edited_business_message",
    "deleted_business_messages",
  ]);
  // Oddiy `message` ro'yxatda yo'q — botga yozilgan xabarga javob berish
  // imkoniyati Telegram tomonida ham yopiladi.
  assert.ok(!(SALES_ALLOWED_UPDATES as readonly string[]).includes("message"));
});

/* ------------------- manba darajasidagi avto-javob tekshiruvi ------------- */

const ROOT = new URL("..", import.meta.url).pathname;

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Izohlarni olib tashlaydi — hujjatdagi eslatma xato ogohlantirish bermasin. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("sotuv kodida mijozga xabar yuboradigan chaqiruv YO‘Q", () => {
  const targets = [
    ...collectFiles(join(ROOT, "src/lib/sales")),
    ...collectFiles(join(ROOT, "src/app/api/telegram-sales")),
    join(ROOT, "src/lib/actions/sales.ts"),
  ];
  assert.ok(targets.length >= 10, "skanerlanadigan fayllar topilmadi");

  const forbidden = /\b(sendMessage|sendPhoto|sendDocument|sendChatAction|copyMessage|forwardMessage|answerCallbackQuery|editMessageText)\b/;

  for (const file of targets) {
    const code = stripComments(readFileSync(file, "utf8"));
    const match = code.match(forbidden);
    assert.equal(match, null, `${file} da ${match?.[0]} uchradi — 0.1 da avto-javob taqiqlangan`);
  }
});

test("webhook route Telegram transportini umuman import qilmaydi", () => {
  const route = readFileSync(
    join(ROOT, "src/app/api/telegram-sales/webhook/route.ts"),
    "utf8",
  );
  // Import yo'q => javob yuborishning kod yo'li ham yo'q.
  assert.ok(!route.includes("telegram-sales-api"));
  assert.ok(!route.includes("api.telegram.org"));
});

test("sotuv boti post botining tokenini o‘qimaydi", () => {
  // Ikki tizim bir-birining sozlamasiga tegmasligi kerak.
  for (const file of collectFiles(join(ROOT, "src/lib/sales"))) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.ok(
      !/process\.env\.TELEGRAM_BOT_TOKEN|process\.env\.TELEGRAM_WEBHOOK_SECRET/.test(code),
      `${file} post botining env'ini o‘qiyapti`,
    );
  }
});
