import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  pickRegionalCoordinator,
  pickOverflowCoordinator,
  claimDeadline,
  isExpired,
  businessDate,
  type EligibleCoordinator,
} from "../src/lib/coordinators/routing-rules.ts";
import {
  buildCommission,
  resolveTarget,
  targetState,
  firstToTarget,
  mostSales,
  mostEfficient,
  type CoordinatorDayStats,
} from "../src/lib/coordinators/targets.ts";

const leadIntake = readFileSync("src/lib/coordinators/lead-intake.ts", "utf8");
const saleService = readFileSync("src/lib/coordinators/sale-service.ts", "utf8");
const regionAudit = readFileSync("src/lib/coordinators/region-audit.ts", "utf8");
const actions = readFileSync("src/lib/actions/coordinators.ts", "utf8");
const manager = readFileSync("src/app/(admin)/koordinatorlar/coordinator-manager.tsx", "utf8");
const page = readFileSync("src/app/(admin)/koordinatorlar/page.tsx", "utf8");
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ============ 1. TO'LIQ ZANJIR: ARIZA -> SOTUV -> KOMISSIYA ============= */

const SAMARQAND = "region-samarqand";
const BUXORO = "region-buxoro";

const coord = (over: Partial<EligibleCoordinator>): EligibleCoordinator => ({
  id: "c", regionId: SAMARQAND, status: "active", isActive: true,
  backupPriority: 100, offeredToday: 0, openLeads: 0, confirmedToday: 0,
  dailyLeadLimit: null, ...over,
});

test("ZANJIR: ariza hududi -> o‘sha hudud koordinatori -> sotuv -> komissiya", () => {
  const pool = [
    coord({ id: "samarqand-1", regionId: SAMARQAND }),
    coord({ id: "buxoro-1", regionId: BUXORO }),
  ];

  // 1. Hudud arizadan keladi va O'SHA hudud koordinatoriga boradi.
  const first = pickRegionalCoordinator(pool, SAMARQAND);
  assert.equal(first?.id, "samarqand-1");

  // 2. 10 daqiqalik oyna.
  const offeredAt = new Date("2026-09-19T10:00:00Z");
  const deadline = claimDeadline(offeredAt, 10);
  assert.equal(isExpired(deadline, new Date("2026-09-19T10:05:00Z")), false);

  // 3. To'lov tasdiqlanadi -> komissiya.
  const commission = buildCommission({
    leadState: "payment_confirmed",
    coordinatorId: "samarqand-1",
    amountUzs: 10000,
    at: new Date("2026-09-19T10:30:00Z"),
  });
  assert.equal(commission?.coordinatorId, "samarqand-1");
  assert.equal(commission?.status, "earned");
  assert.equal(commission?.businessDate, "2026-09-19");
});

/* ====== 2. OVERFLOW ATRIBUTSIYASI — TEXNIK TOPSHIRIQNING ASOSIY TALABI == */

test("OVERFLOW: Samarqand bozori +1, Buxoro koordinatori +1, Buxoro bozori +0", () => {
  /*
   * Bu butun tizimning eng muhim qoidasi.
   *
   * Samarqanddan kelgan lidni 10 daqiqadan keyin Buxoro
   * koordinatori oladi. Agar lid hududi koordinator hududi bilan
   * almashtirilsa, Samarqand bozori bu konversiyani YO'QOTADI va
   * Buxoro yo'q konversiyani OLADI — ikki hudud statistikasi ham
   * bir vaqtda yolg'on bo'lib qoladi.
   */
  const pool = [
    coord({ id: "samarqand-1", regionId: SAMARQAND, offeredToday: 5 }),
    coord({ id: "buxoro-1", regionId: BUXORO, offeredToday: 1 }),
  ];

  // Samarqand koordinatori 10 daqiqada olmadi.
  const expired = isExpired(
    claimDeadline(new Date("2026-09-19T10:00:00Z"), 10),
    new Date("2026-09-19T10:11:00Z"),
  );
  assert.equal(expired, true);

  // Overflow: eng kam yuklangan — Buxoro.
  const overflow = pickOverflowCoordinator(pool, { excludeIds: ["samarqand-1"] });
  assert.equal(overflow?.id, "buxoro-1");
  assert.equal(overflow?.regionId, BUXORO);

  /*
   * Lid yozuvidagi holat: hudud O'ZGARMAYDI, koordinator hududi
   * ALOHIDA ustunda.
   */
  const lead = {
    lead_region_id: SAMARQAND,
    assigned_coordinator_id: overflow!.id,
    assigned_coordinator_region_id: overflow!.regionId,
    state: "payment_confirmed",
  };

  // HUDUD natijasi — ASL hudud bo'yicha.
  const marketSales = (regionId: string) =>
    [lead].filter((l) => l.lead_region_id === regionId && l.state === "payment_confirmed").length;
  assert.equal(marketSales(SAMARQAND), 1, "Samarqand bozori +1");
  assert.equal(marketSales(BUXORO), 0, "Buxoro bozori +0");

  // KOORDINATOR natijasi — sotgan odam bo'yicha.
  const personalSales = (coordinatorId: string) =>
    [lead].filter(
      (l) => l.assigned_coordinator_id === coordinatorId && l.state === "payment_confirmed",
    ).length;
  assert.equal(personalSales("buxoro-1"), 1, "Buxoro koordinatori +1");
  assert.equal(personalSales("samarqand-1"), 0);

  // Komissiya — SOTGAN odamga.
  const commission = buildCommission({
    leadState: "payment_confirmed",
    coordinatorId: lead.assigned_coordinator_id,
    amountUzs: 10000,
  });
  assert.equal(commission?.coordinatorId, "buxoro-1");
});

test("panel HUDUD natijasini ASL hudud bo‘yicha hisoblaydi", () => {
  const dashboard = readFileSync("src/lib/coordinators/dashboard.ts", "utf8");
  // Hudud kesimi `lead_region_id` bo'yicha, koordinator hududi
  // bo'yicha EMAS.
  assert.match(dashboard, /leads\.filter\(\(l\) => l\.lead_region_id === id\)/);
  assert.match(dashboard, /leads\.filter\(\(l\) => l\.assigned_coordinator_id === id\)/);
});

/* =============== 3. TALAB, NOMINATSIYA, HISOBOT ======================== */

test("talab bajarilgan hudud YASHIL bo‘ladi", () => {
  const target = resolveTarget([{ targetDate: null, regionId: null, targetSales: 10 }], "2026-09-19", null);
  assert.equal(target, 10);
  assert.equal(targetState({ confirmedSales: 10, target }), "target_met");
  assert.equal(targetState({ confirmedSales: 9, target }), "near_target");
});

test("nominatsiyalar to‘liq zanjirda ishlaydi", () => {
  const stats: CoordinatorDayStats[] = [
    {
      coordinatorId: "buxoro-1", coordinatorName: "Buxoro", regionId: BUXORO,
      claimedLeads: 10, confirmedSales: 9, targetReachedAt: "2026-09-19T11:00:00Z",
    },
    {
      coordinatorId: "samarqand-1", coordinatorName: "Samarqand", regionId: SAMARQAND,
      claimedLeads: 1, confirmedSales: 1, targetReachedAt: null,
    },
  ];
  assert.deepEqual(firstToTarget(stats).winners.map((w) => w.coordinatorId), ["buxoro-1"]);
  assert.deepEqual(mostSales(stats).winners.map((w) => w.coordinatorId), ["buxoro-1"]);
  // 1/1 = 100% minimal maxrajga yetmaydi.
  assert.deepEqual(mostEfficient(stats, 5).winners.map((w) => w.coordinatorId), ["buxoro-1"]);
});

/* ============== 4. ARIZA -> LID: TAKRORLANMASLIK ======================= */

test("bitta arizadan IKKINCHI lid yaratilmaydi — BAZA darajasida", () => {
  /*
   * "Avval tekshirib, keyin yozish" ikki parallel chaqiruvda
   * ikkalasiga ham "yo'q ekan" deb ko'rinardi va bitta mijoz ikki
   * koordinatorga ketardi.
   */
  const migration = readFileSync(
    "supabase/migrations/20260919120000_coordinator_crm.sql",
    "utf8",
  );
  assert.match(migration, /create unique index[^;]*uq_lead_application[^;]*application_id/);
  assert.ok(code(leadIntake).includes('error.code === "23505"'), "unikal buzilishi ushlansin");
  assert.ok(code(leadIntake).includes('reason: duplicate ? "duplicate" : "error"'));
});

test("HUDUDSIZ ariza lid yaratmaydi", () => {
  // Hududiy marshrutlashning butun ma'nosi hududda; "noma'lum"
  // bilan yaratilgan lid darhol tasodifiy koordinatorga ketardi.
  assert.ok(code(leadIntake).includes('reason: "no_region"'));
  assert.ok(code(leadIntake).includes("if (!application.region_id)"));
});

test("lid hududi ARIZADAN olinadi", () => {
  assert.ok(code(leadIntake).includes("lead_region_id: application.region_id"));
});

test("ESKI arizalar to‘kilib ketmaydi", () => {
  /*
   * Bazada minglab eski ariza bor. Chegarasiz birinchi yugurish
   * ularning hammasini navbatga qo'yardi.
   */
  assert.ok(code(leadIntake).includes("getLeadIntakeSince"));
  assert.ok(code(leadIntake).includes("if (!since) return result"));
  assert.ok(code(leadIntake).includes('.gte("created_at", since)'));
  // Chegara marshrutlash birinchi yoqilganda yoziladi.
  assert.ok(code(actions).includes("ensureLeadIntakeSince()"));
});

test("marshrutlash o‘chiq bo‘lsa lid SAQLANADI, yuborilmaydi", () => {
  assert.ok(code(leadIntake).includes("offerPendingLeads"));
  assert.ok(code(leadIntake).includes('.eq("state", "new")'));
});

/* ================= 5. TO'LOV -> SOTUV -> KOMISSIYA ===================== */

test("komissiya IKKI MARTA yaratilmaydi", () => {
  assert.ok(code(saleService).includes('error?.code === "23505"'));
  assert.ok(code(saleService).includes("commissionCreated: !duplicate"));
});

test("tasdiqlangan vaqt QAYTA YOZILMAYDI", () => {
  // Uni surish kechagi sotuvni bugunga ko'chirardi.
  assert.ok(code(saleService).includes('.neq("state", "payment_confirmed")'));
});

test("koordinatorsiz sotuv komissiya yaratmaydi, lekin holat yangilanadi", () => {
  // AI boti mijozni o'zi yopgan bo'lishi mumkin: sotuv bor, uni
  // hech kim "qilmagan".
  assert.ok(code(saleService).includes('reason: "no_coordinator"'));
  assert.ok(code(saleService).includes("if (!lead.assigned_coordinator_id)"));
});

test("komissiya O‘CHIRILMAYDI — bekor qilinadi", () => {
  // Daftar o'zgarmas bo'lishi kerak.
  assert.ok(code(saleService).includes('status: "reversed"'));
  assert.ok(!code(saleService).includes(".delete()"));
  assert.ok(code(saleService).includes("reversal_reason"));
});

/* ================== 6. HUDUD AUDITI VA BACKFILL ======================== */

test("hudud ERKIN MATNDAN taxmin qilinmaydi", () => {
  /*
   * "Toshkent" so'zi shahar yoki viloyat ekanini bilmaslik,
   * "Chirchiq" qaysi viloyat ekanini taxmin qilish — bitta xato
   * nomzodni umrbod noto'g'ri hududga yozib qo'yadi.
   */
  assert.ok(code(regionAudit).includes('from("applications")'));
  assert.ok(!/answers|plain_text|free.?text/i.test(code(regionAudit)));
});

test("backfill MAVJUD hudud ustidan yozmaydi", () => {
  // Kimdir qo'lda to'g'irlagan bo'lsa, u saqlanadi.
  const fn = code(regionAudit).slice(code(regionAudit).indexOf("backfillCandidateRegions"));
  assert.ok(fn.includes('.is("region_id", null)'));
});

test("audit AVVAL — ko‘r-ko‘rona update yo‘q", () => {
  assert.ok(code(regionAudit).includes("auditCandidateRegions"));
  assert.ok(code(regionAudit).includes("unresolvable"));
  assert.ok(code(regionAudit).includes("applicationWithoutRegion"));
});

/* ======================= 7. CRUD VA XAVFSIZLIK ========================= */

test("Telegram ID unikal — faol koordinatorlar orasida", () => {
  assert.ok(code(actions).includes("telegramIdTaken"));
  assert.ok(code(actions).includes('.eq("is_active", true)'));
  assert.match(actions, /boshqa faol koordinatorga biriktirilgan/);
});

test("username identity sifatida ISHLATILMAYDI", () => {
  const fn = code(actions).slice(code(actions).indexOf("async function telegramIdTaken"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(body.includes("telegram_user_id"));
  assert.ok(!body.includes("telegram_username"));
});

test("Telegram ID brauzerga YUBORILMAYDI", () => {
  // Ichki identifikator: uni panelda ko'rsatish keraksiz va u
  // ekran surati orqali tarqalishi mumkin.
  assert.ok(page.includes("hasTelegram: row.telegram_user_id != null"));
  assert.ok(!/telegramUserId:\s*row\.telegram_user_id/.test(page));
  assert.ok(manager.includes("hasTelegram"));
  assert.ok(manager.includes("Bot bilan bog‘langan"));
});

test("koordinator O‘CHIRILMAYDI — deaktivatsiya qilinadi", () => {
  // Yozuv sotuvlar va komissiyalar bilan bog'langan; o'chirish
  // tarixni buzardi.
  assert.ok(code(actions).includes("is_active: false"));
  assert.ok(code(actions).includes("deactivated_at"));
  assert.ok(!code(actions).includes('from("coordinators").delete()'));
});

test("hudud va Telegram o‘zgarishi ALOHIDA yoziladi", () => {
  // Ikkalasi ham kimga lid ketishini o'zgartiradi.
  assert.ok(code(actions).includes("coordinator.region_changed"));
  assert.ok(code(actions).includes("coordinator.telegram_changed"));
});

test("marshrutlash KOORDINATORSIZ yoqilmaydi", () => {
  const fn = code(actions).slice(code(actions).indexOf("setRoutingEnabledAction"));
  assert.ok(fn.includes('.not("telegram_user_id", "is", null)'));
  assert.ok(fn.includes('.not("region_id", "is", null)'));
  assert.match(fn, /Yoqib bo‘lmaydi/);
});

test("har amal RUXSAT talab qiladi", () => {
  const calls = (code(actions).match(/requirePermission\("coordinators\.manage"\)/g) ?? []).length;
  // create, update, status, deactivate, routing, target
  assert.ok(calls >= 6, `faqat ${calls} ta amalda ruxsat tekshiruvi bor`);
});

test("kunlik talab TARIXNI qayta yozmaydi", () => {
  const fn = code(actions).slice(code(actions).indexOf("setDailyTargetAction"));
  // Sana bo'yicha alohida qator — o'zgarish kechagi natijaga
  // ta'sir qilmaydi.
  assert.ok(fn.includes("target_date: targetDate"));
  assert.ok(!fn.includes('onConflict: "target_date,region_id"'), "ifodali indeks bilan ishlamaydi");
});

/* ========================= 8. VAQT MINTAQASI =========================== */

test("ish kuni Toshkent bo‘yicha — zanjir bo‘ylab", () => {
  assert.equal(businessDate(new Date("2026-09-19T20:00:00Z")), "2026-09-20");
  const commission = buildCommission({
    leadState: "payment_confirmed",
    coordinatorId: "c1",
    amountUzs: 10000,
    at: new Date("2026-09-19T20:00:00Z"),
  });
  assert.equal(commission?.businessDate, "2026-09-20");
});
