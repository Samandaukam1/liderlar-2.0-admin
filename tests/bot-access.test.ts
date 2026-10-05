import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  audienceFor,
  BOTS,
  BOT_PERMISSIONS,
  chatIdsWith,
  cleanPermissions,
  isBotPermission,
  parseTelegramId,
  permissionsOf,
} from "../src/lib/bot-access/catalog.ts";

/**
 * BOTLAR BOSHQARUVI — kim qaysi botning qaysi funksiyasidan foydalanadi.
 */

const ROUTER = readFileSync("src/lib/post-studio/bot-router.ts", "utf8");
const MIGRATION = readFileSync("supabase/migrations/20261005120000_bot_access.sql", "utf8");
const ACTIONS = readFileSync("src/lib/actions/bot-access.ts", "utf8");
const SERVICE = readFileSync("src/lib/bot-access/service.ts", "utf8");
const NAV = readFileSync("src/components/admin/nav-data.ts", "utf8");

/* ------------------------------------------------------------ katalog */

test("har ruxsat kaliti katalogda AYNAN bir marta, bitta botda", () => {
  const listed = BOTS.flatMap((bot) => bot.functions.map((fn) => fn.key));
  assert.deepEqual([...listed].sort(), [...BOT_PERMISSIONS].sort());
  assert.equal(new Set(listed).size, listed.length);
  for (const bot of BOTS) {
    for (const fn of bot.functions) assert.ok(fn.key.startsWith(`${bot.key}.`), fn.key);
  }
});

test("noma'lum kalitlar tashlanadi, tartib katalogniki", () => {
  assert.deepEqual(cleanPermissions(["sales.operator", "x.y", "studio.posts", "studio.posts", 7]), [
    "studio.posts",
    "sales.operator",
  ]);
  assert.equal(isBotPermission("studio.crm"), true);
  assert.equal(isBotPermission("studio.everything"), false);
});

test("Telegram ID tekshiruvi", () => {
  assert.deepEqual(parseTelegramId(" 5072 996465 "), { ok: true, id: 5072996465 });
  assert.deepEqual(parseTelegramId("-1002723333384"), { ok: true, id: -1002723333384 });
  assert.deepEqual(parseTelegramId(""), { ok: false, problem: "empty" });
  assert.deepEqual(parseTelegramId("@username"), { ok: false, problem: "not_number" });
  assert.deepEqual(parseTelegramId("0"), { ok: false, problem: "zero" });
  assert.deepEqual(parseTelegramId("99999999999999999999"), { ok: false, problem: "too_long" });
});

test("faqat FAOL va ruxsati bor chatlar tanlanadi", () => {
  const rows = [
    { telegram_id: "111", permissions: ["studio.posts", "studio.crm"], is_active: true },
    { telegram_id: 222, permissions: ["studio.crm"], is_active: true },
    { telegram_id: 333, permissions: ["studio.posts"], is_active: false },
  ];
  assert.deepEqual(chatIdsWith(rows, "studio.posts"), [111]);
  assert.deepEqual(chatIdsWith(rows, "studio.crm").sort(), [111, 222]);
  assert.deepEqual([...permissionsOf(rows, 111)], ["studio.posts", "studio.crm"]);
  assert.equal(permissionsOf(rows, 333).size, 0, "to'xtatilgan odamga hech narsa yo'q");
  assert.equal(permissionsOf(rows, 999).size, 0);
});

/* ------------------------------------------------------------ baza */

test("jadvalga faqat server kiradi: RLS yoqilgan, siyosat yo'q", () => {
  assert.match(MIGRATION, /alter table public\.bot_access enable row level security/);
  assert.ok(!/create policy/i.test(MIGRATION), "anon/authenticated uchun siyosat bo'lmasin");
  assert.match(MIGRATION, /telegram_id bigint not null unique/);
});

test("eski tahririyat ro'yxati HAMMA ruxsat bilan ko'chiriladi", () => {
  // Ertadan keyin hech kimning imkoniyati kamaymasligi kerak.
  assert.match(MIGRATION, /telegram_bot\.post_delivery_chat_ids/);
  for (const permission of BOT_PERMISSIONS) assert.ok(MIGRATION.includes(`'${permission}'`), permission);
  assert.match(MIGRATION, /on conflict \(telegram_id\) do nothing/);
});

test("baza o'qilmasa ro'yxat XATO beradi — postlar hammaga ketib qolmaydi", () => {
  const fn = SERVICE.slice(SERVICE.indexOf("export async function getChatIdsWithPermission"));
  assert.match(fn.slice(0, fn.indexOf("\n}")), /if \(error\) throw/);
});

/* ------------------------------------------------------------ bot kodi */

test("bot kodidagi har ruxsat kaliti katalogda bor", () => {
  const used = [...ROUTER.matchAll(/(?:can|isEditorialChat\(chatId), ?\(?"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]);
  const viaCan = [...ROUTER.matchAll(/can\("([a-z_.]+)"\)/g)].map((m) => m[1]);
  for (const key of [...used, ...viaCan]) assert.ok(isBotPermission(key), `${key} katalogda yo'q`);
  assert.ok(viaCan.length >= 11, "har xabar tarmog'i o'z ruxsatini tekshiradi");
});

test("klaviatura faqat ruxsati bor tugmalarni ko'rsatadi", () => {
  const keyboard = ROUTER.slice(ROUTER.indexOf("function keyboardFor"), ROUTER.indexOf("async function sendCrmList"));
  for (const [permission, label] of [
    ["studio.report", "REPORT_BUTTON_LABEL"],
    ["studio.batch", "BATCH_BUTTON_LABEL"],
    ["studio.payments", "UNDO_BUTTON_LABEL"],
    ["studio.crm", "PUBLISHED_BUTTON_LABEL"],
    ["studio.blacklist", "BLACKLIST_ADD_BUTTON_LABEL"],
    ["studio.intake_link", "INTAKE_LINK_BUTTON_LABEL"],
    ["studio.region_poll", "REGION_POLL_BUTTON_LABEL"],
  ]) {
    assert.ok(keyboard.includes(`access.has("${permission}")) rows.push([${label}`), `${label} ← ${permission}`);
  }
});

test("bildirishnomalar har biri o'z ruxsatiga, nomzod egasiga qarab yuboriladi", () => {
  const cron = readFileSync("src/app/api/cron/post-pipeline/route.ts", "utf8");
  assert.match(cron, /runPaymentAskSweep\(await getAudience\("studio\.payments"\)\)/);
  assert.match(cron, /runChannelReminderSweep\(await getAudience\("studio\.channel"\)\)/);
  const pipeline = readFileSync("src/lib/post-studio/pipeline.ts", "utf8");
  assert.match(pipeline, /getAudience\("studio\.autofix"\)[\s\S]{0,80}forCreator\(await getIntakeCreator\(intakeId\)\)/);
  assert.match(pipeline, /getAudience\("studio\.posts"\)/);
  const payment = readFileSync("src/lib/intake/payment.ts", "utf8");
  assert.match(payment, /getAudience\("studio\.payments"\)/);
  assert.match(payment, /getAudience\("studio\.blacklist"\)/);
  assert.match(payment, /audience\.forCreator\(creatorOf\(intake\)\)/);
  const reminder = readFileSync("src/lib/post-studio/channel-reminder.ts", "utf8");
  assert.match(reminder, /audience\.forCreator\(await getCandidateCreator\(post\.candidate_id\)\)/);
  assert.match(readFileSync("src/lib/sales/telegram-sales-api.ts", "utf8"), /getChatIdsWithPermission\("sales\.operator"\)/);
});

/* ------------------------------------------------------------ "faqat o'z nomzodlari" */

test("faqat o'ziniki rejimi: umumiylar hammasini, shaxsiylar faqat o'zinikini oladi", () => {
  const rows = [
    { telegram_id: 1, permissions: ["studio.payments"], is_active: true, own_only: false },
    { telegram_id: 2, permissions: ["studio.payments"], is_active: true, own_only: true },
    { telegram_id: 3, permissions: ["studio.payments"], is_active: true, own_only: true },
    { telegram_id: 4, permissions: ["studio.payments"], is_active: false, own_only: false },
  ];
  assert.deepEqual(audienceFor(rows, "studio.payments", 2), [1, 2], "2 yaratgan nomzod: umumiy + 2");
  assert.deepEqual(audienceFor(rows, "studio.payments", 3), [1, 3]);
  assert.deepEqual(audienceFor(rows, "studio.payments", null), [1], "panelda yaratilgan: faqat umumiy");
  assert.deepEqual(audienceFor(rows, "studio.payments", 999), [1], "boshqa odam yaratgan");
  assert.deepEqual(audienceFor(rows, "studio.crm", 2), [], "ruxsat bo'lmasa hech kim");
});

test("havolani yaratgan chat anketaga yoziladi — ikkala botda", () => {
  const bot = readFileSync("src/lib/intake/intake-link-bot.ts", "utf8");
  assert.match(bot, /creatorTelegramId: input\.creatorChatId/);
  const service = readFileSync("src/lib/intake/intake-link-service.ts", "utf8");
  assert.match(service, /created_by_telegram_id: input\.creatorTelegramId \?\? null/);
  assert.match(ROUTER, /origin: "post_bot",\s*creatorChatId: chatId/);
  assert.match(readFileSync("src/lib/sales/operator-router.ts", "utf8"), /origin: "sales_bot",\s*creatorChatId: input\.chatId/);
  const migration = readFileSync("supabase/migrations/20261005130000_bot_access_own_only.sql", "utf8");
  assert.match(migration, /add column if not exists own_only boolean not null default false/);
  assert.match(migration, /add column if not exists created_by_telegram_id bigint/);
});

test("shaxsiy rejimda ro'yxatlar egasi bilan cheklanadi, umumiyda filtr yo'q", () => {
  const crm = readFileSync("src/lib/intake/crm-lists.ts", "utf8");
  // `.in("id", [])` umumiy rejimda butun ro'yxatni bo'shatardi.
  assert.match(crm, /own \? query\.in\("id", own\) : query/);
  assert.match(ROUTER, /const owner = ownOnly \? chatId : null;/);
  assert.match(ROUTER, /buildPaymentUndoPayload\(owner\)/);
  assert.match(ROUTER, /sendCrmList\(chatId, listKind, owner\)/);
  const payment = readFileSync("src/lib/intake/payment.ts", "utf8");
  assert.match(payment, /if \(owner != null\) query = query\.eq\("created_by_telegram_id", owner\)/);
});

/* ------------------------------------------------------------ panel */

test("panel amallari faqat super admin uchun va auditga yoziladi", () => {
  const actions = ACTIONS.match(/export async function \w+/g) ?? [];
  assert.equal(actions.length, 3);
  assert.equal((ACTIONS.match(/requirePermission\("settings\.manage"\)/g) ?? []).length, 3);
  assert.equal((ACTIONS.match(/await logAudit\(/g) ?? []).length, 4, "qo'shish, tahrir, yoqish/to'xtatish, o'chirish");
});

test("menyuda “Botlar boshqaruvi” bor", () => {
  assert.match(NAV, /label: "Botlar boshqaruvi", href: "\/botlar", icon: Bot, permission: "settings\.manage"/);
});
