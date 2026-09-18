import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COORD_MENU,
  MENU_BY_LABEL,
  coordinatorKeyboard,
  claimCallbackData,
  parseClaimCallback,
  buildLeadNotification,
  buildReportText,
  claimLostReply,
  formatSom,
  formatDuration,
  CLAIM_BUTTON_LABEL,
  NOT_A_COORDINATOR_REPLY,
  type CoordinatorReport,
} from "../src/lib/coordinators/bot-messages.ts";

const router = readFileSync("src/lib/coordinators/bot-router.ts", "utf8");
const api = readFileSync("src/lib/coordinators/bot-api.ts", "utf8");
const webhook = readFileSync("src/app/api/telegram-coordinator/webhook/route.ts", "utf8");
const service = readFileSync("src/lib/coordinators/routing-service.ts", "utf8");
const proxy = readFileSync("src/proxy.ts", "utf8");
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ==================== 1. BITTA BOT, 14 HUDUD =========================== */

test("BITTA bot — hudud bo‘yicha alohida bot YO‘Q", () => {
  /*
   * 14 ta botga har biriga token, webhook, deploy va kuzatuv kerak
   * bo'lardi, va koordinator hududi o'zgarganda uni boshqa botga
   * ko'chirish kerak bo'lardi.
   */
  assert.equal((api.match(/COORDINATOR_TELEGRAM_BOT_TOKEN/g) ?? []).length >= 1, true);
  assert.ok(!/BOT_TOKEN_[A-Z]+/.test(api), "hudud bo‘yicha token yo‘q");
});

test("koordinator RAQAMLI ID bo‘yicha tanilади, username emas", () => {
  // Username egasi uni istalgan payt o'zgartiradi va bo'shagan
  // nomni boshqa odam egallashi mumkin.
  const fn = code(router).slice(code(router).indexOf("async function identify"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(body.includes('.eq("telegram_user_id", telegramUserId)'));
  assert.ok(!body.includes("telegram_username"), "username identifikator sifatida ishlatilmasin");
});

test("ro‘yxatda yo‘q odam hech qanday ichki ma’lumot olmaydi", () => {
  assert.ok(code(router).includes("NOT_A_COORDINATOR_REPLY"));
  assert.ok(!NOT_A_COORDINATOR_REPLY.includes("lid"), "lid haqida gapirilmasin");
});

/* ======================== 2. MENYU ===================================== */

test("menyuda 9 ta band bor", () => {
  const labels = Object.values(COORD_MENU);
  assert.equal(labels.length, 9);
  for (const want of [
    "Yangi lidlar", "Band qilganlarim", "Jarayonda", "To‘lov kutilmoqda",
    "Sotuvlarim", "Hisobot", "Daromadim", "Reyting", "Bildirishnomalar",
  ]) {
    assert.ok(labels.some((l) => l.includes(want)), want);
  }
});

test("bosilgan tugma kalitga qaytariladi", () => {
  for (const [key, label] of Object.entries(COORD_MENU)) {
    assert.equal(MENU_BY_LABEL[label], key, label);
  }
  assert.equal(MENU_BY_LABEL["tasodifiy matn"], undefined);
});

test("klaviaturada barcha bandlar bor", () => {
  const flat = coordinatorKeyboard().flat();
  assert.equal(flat.length, Object.keys(COORD_MENU).length);
});

/* ==================== 3. LID XABARI — MAXFIYLIK ======================== */

test("yangi lid xabarida SHAXSIY ma’lumot yo‘q", () => {
  /*
   * Bu xabar hali hech kimga biriktirilmagan lid haqida va u bir
   * nechta koordinatorga ketishi mumkin. Kontakt band qilingandan
   * KEYIN beriladi — mas'ul aniq bo'lgach.
   */
  const text = buildLeadNotification({
    fullName: "Karimov Aziz",
    regionName: "Samarqand",
    appliedAt: "2026-09-19T09:32:00Z",
    claimWindowMinutes: 10,
  });
  assert.ok(text.includes("Karimov Aziz"));
  assert.ok(text.includes("Samarqand"));
  assert.ok(!/\+?998\d|\+\d{7,}/.test(text), "telefon raqam bo‘lmasin");
  assert.ok(!/@[A-Za-z0-9_]{4,}/.test(text), "username bo‘lmasin");
  assert.match(text, /10 daqiqa/);
  assert.match(text, /14:32/, "Toshkent vaqtida");
});

test("hudud aniqlanmagan bo‘lsa TO‘QILMAYDI", () => {
  const text = buildLeadNotification({
    fullName: "X", regionName: null, appliedAt: null, claimWindowMinutes: 10,
  });
  assert.match(text, /aniqlanmagan/);
});

/* ======================= 4. CALLBACK ================================== */

test("claim callback round-trip va 64 bayt", () => {
  const id = "3f1c9a2e-5b47-4d81-9c30-7ae2f6b81d54";
  const data = claimCallbackData(id);
  assert.equal(parseClaimCallback(data), id);
  assert.ok(Buffer.byteLength(data, "utf8") <= 64);
  assert.ok(CLAIM_BUTTON_LABEL.includes("BAND QILISH"));
});

test("begona callback bazaga so‘rovga aylanmaydi", () => {
  for (const bad of [null, "", "cl:", "cl:not-uuid", "rv:andijon", "cl:'; drop table x;--"]) {
    assert.equal(parseClaimCallback(bad as string | null), null, String(bad));
  }
});

test("yutqazgan koordinator SABABINI biladi", () => {
  // "Bo'lmadi" degan javob nima bo'lganini bilmay qoldirardi.
  assert.match(claimLostReply("already_claimed"), /boshqa koordinator/);
  assert.match(claimLostReply("expired"), /muddati tugagan/);
  assert.match(claimLostReply("coordinator_not_eligible"), /faol emas/);
  assert.ok(claimLostReply(null).length > 10);
});

/* ================== 5. IDEMPOTENTLIK VA XAVFSIZLIK ===================== */

test("takroriy Telegram update IKKINCHI marta ishlanmaydi", () => {
  /*
   * Telegram javob kechiksa update'ni qayta yuboradi. Usiz bitta
   * "band qilish" bosishi ikki marta ishlanardi.
   *
   * Insert bo'yicha: ikki parallel ishlov ikkalasi "yo'q ekan" deb
   * o'qishi mumkin, insert esa faqat bittasida o'tadi.
   */
  const fn = code(router).slice(code(router).indexOf("async function isDuplicateUpdate"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(body.includes('from("coordinator_bot_updates")'));
  assert.ok(body.includes(".insert("));
  assert.ok(body.includes("return Boolean(error)"), "unikal buzilishi — takror");
});

test("webhook sekreti DOIMIY VAQTDA solishtiriladi", () => {
  // Oddiy === birinchi farqda to'xtaydi va javob vaqti bo'yicha
  // sekretni belgima-belgi topish nazariy jihatdan mumkin bo'lardi.
  assert.ok(api.includes("timingSafeEqual"));
});

test("sekretsiz so‘rov RAD ETILADI", () => {
  assert.ok(code(webhook).includes("isValidCoordinatorSecret"));
  assert.match(webhook, /status: 401/);
  // Sozlanmagan holat — 503, "ruxsat yo'q" emas.
  assert.match(webhook, /status: 503/);
});

test("xato matnida TOKEN bo‘lmaydi", () => {
  // Token URL ichida edi — xato xabariga tushib qolishi mumkin.
  assert.ok(api.includes('replace(/bot\\d+:[\\w-]+/g, "bot***")'));
});

test("webhook admin sessiyasidan ozod", () => {
  // Aks holda Telegram 307 olardi va har yetkazishni "Wrong
  // response from the webhook" deb belgilardi.
  assert.ok(proxy.includes('"/api/telegram-coordinator"'));
});

test("token client bundle’ga chiqmaydi", () => {
  assert.ok(api.startsWith('import "server-only"'));
  assert.ok(router.startsWith('import "server-only"'));
  assert.ok(!api.includes("NEXT_PUBLIC_"), "public env bo‘lmasin");
});

/* ===================== 6. MARSHRUTLASH XAVFSIZLIGI ===================== */

test("marshrutlash O‘CHIQ bo‘lsa hech kimga yozilmaydi", () => {
  const fn = code(service).slice(code(service).indexOf("export async function offerLead"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  const check = body.indexOf("routingEnabled");
  const update = body.indexOf('.update(');
  assert.ok(check !== -1 && check < update, "tekshiruv yozishdan OLDIN");
  assert.ok(body.includes('reason: "routing_disabled"'));
});

test("mos koordinator bo‘lmasa lid YO‘QOLMAYDI", () => {
  // Hodisa yozib qo'yiladi va lid navbatda qoladi.
  const fn = code(service).slice(code(service).indexOf("export async function offerLead"));
  assert.ok(fn.includes('event: "no_coordinator"'));
});

test("muddat tugaganda qayta yo‘naltirish SHARTLI", () => {
  /*
   * Shu daqiqada kimdir band qilib ulgurgan bo'lishi mumkin. Shart
   * UPDATE ning o'zida: ikki jarayon bir lidni ikki marta
   * qaytarmaydi.
   */
  const fn = code(service).slice(code(service).indexOf("export async function runExpirySweep"));
  const body = fn.slice(0, fn.indexOf("\n  return result;"));
  assert.ok(body.includes('.eq("state", "offered")'));
  assert.ok(body.includes('.is("assigned_coordinator_id", null)'));
  assert.ok(body.includes("claimedRows?.length ?? 0) === 0"), "o‘zgarmagan qator — o‘tkazib yuboriladi");
});

test("band qilish BAZA funksiyasi orqali — atomik", () => {
  assert.ok(code(service).includes('rpc("claim_coordinator_lead"'));
});

/* ========================== 7. HISOBOT ================================= */

const report = (over: Partial<CoordinatorReport> = {}): CoordinatorReport => ({
  offered: 14, claimed: 11, contacted: 9, inProgress: 3, waitingPayment: 2,
  confirmedSales: 8, lost: 1, avgClaimSeconds: 95,
  earnedToday: 80000, earnedWeek: 300000, earnedMonth: 1200000,
  pendingAmount: 0, earnedAmount: 80000, paidAmount: 0, reversedAmount: 0,
  attention: [], ...over,
});

test("konversiya MAXRAJI bilan ko‘rsatiladi", () => {
  // "73%" o'zi hech narsa aytmaydi, "8 / 11" aytadi.
  assert.match(buildReportText(report()), /8 \/ 11 = 73%/);
});

test("maxraj NOL bo‘lsa foiz umuman chiqmaydi", () => {
  // "0%" bilan "hali lid yo'q" bir xil narsa emas va birinchisi
  // koordinatorni yomon ishlayotgandek ko'rsatardi.
  const text = buildReportText(report({ claimed: 0, confirmedSales: 0 }));
  assert.match(text, /hali hisoblab bo‘lmaydi/);
  assert.ok(!text.includes("0%"));
});

test("o‘rtacha vaqt ma’lumot yetmasa TO‘QILMAYDI", () => {
  assert.match(buildReportText(report({ avgClaimSeconds: null })), /ma’lumot yetarli emas/);
  assert.match(buildReportText(report({ avgClaimSeconds: 95 })), /2 daqiqa/);
});

test("e’tibor bo‘limi AYBLAMAYDI", () => {
  const text = buildReportText(report({ attention: ["3 ta lid band qilinmagan"] }));
  assert.match(text, /E’TIBOR TALAB QILADI/);
  assert.ok(!/yomon|eng past|ayb/i.test(text));
});

test("summalar o‘zbekcha", () => {
  assert.equal(formatSom(80000), "80 000 so‘m");
  assert.equal(formatDuration(45), "45 soniya");
  assert.equal(formatDuration(180), "3 daqiqa");
  assert.equal(formatDuration(7200), "2 soat");
});
