import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
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

test("bildirishnomalar har biri o'z ruxsatiga yuboriladi", () => {
  const cron = readFileSync("src/app/api/cron/post-pipeline/route.ts", "utf8");
  assert.match(cron, /getChatIdsWithPermission\("studio\.payments"\)/);
  assert.match(cron, /getChatIdsWithPermission\("studio\.channel"\)/);
  assert.match(readFileSync("src/lib/post-studio/pipeline.ts", "utf8"), /getChatIdsWithPermission\("studio\.autofix"\)/);
  assert.match(readFileSync("src/lib/post-studio/delivery-recipients.ts", "utf8"), /getChatIdsWithPermission\("studio\.posts"\)/);
  const payment = readFileSync("src/lib/intake/payment.ts", "utf8");
  assert.match(payment, /getChatIdsWithPermission\("studio\.payments"\)/);
  assert.match(payment, /getChatIdsWithPermission\("studio\.blacklist"\)/);
  assert.match(readFileSync("src/lib/sales/telegram-sales-api.ts", "utf8"), /getChatIdsWithPermission\("sales\.operator"\)/);
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
