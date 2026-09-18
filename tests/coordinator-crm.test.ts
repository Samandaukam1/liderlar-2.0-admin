import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canReceiveLeads,
  pickOverflowCoordinator,
  pickRegionalCoordinator,
  compareForOverflow,
  claimDeadline,
  isExpired,
  businessDate,
  businessDayRange,
  DEFAULT_CLAIM_WINDOW_MINUTES,
  type EligibleCoordinator,
} from "../src/lib/coordinators/routing-rules.ts";
import {
  resolveTarget,
  targetState,
  targetProgress,
  firstToTarget,
  mostSales,
  mostEfficient,
  buildCommission,
  shouldCreateCommission,
  TARGET_STATE_LABELS,
  TARGET_STATES,
  type CoordinatorDayStats,
} from "../src/lib/coordinators/targets.ts";
import {
  UZ_MAP_REGIONS,
  UZ_MAP_BY_SLUG,
  UZ_MAP_VIEWBOX,
} from "../src/components/map/uzbekistan-map-data.ts";

const migration = readFileSync(
  "supabase/migrations/20260919120000_coordinator_crm.sql",
  "utf8",
);

const coordinator = (over: Partial<EligibleCoordinator> = {}): EligibleCoordinator => ({
  id: "c1",
  regionId: "r-samarqand",
  status: "active",
  isActive: true,
  backupPriority: 100,
  offeredToday: 0,
  openLeads: 0,
  confirmedToday: 0,
  dailyLeadLimit: null,
  ...over,
});

/* ===================== 1. XARITA — 14 HUDUD ============================ */

test("xaritada AYNAN 14 ta hudud bor", () => {
  assert.equal(UZ_MAP_REGIONS.length, 14);
});

test("Toshkent shahri va viloyati ALOHIDA", () => {
  // Birlashtirish poytaxt bilan atrofdagi tumanlarni bir xil deb
  // ko'rsatardi — bular ikki boshqa bozor.
  assert.ok(UZ_MAP_BY_SLUG["toshkent-shahri"]);
  assert.ok(UZ_MAP_BY_SLUG["toshkent-viloyati"]);
  assert.notEqual(
    UZ_MAP_BY_SLUG["toshkent-shahri"].d,
    UZ_MAP_BY_SLUG["toshkent-viloyati"].d,
  );
});

test("sluglar BAZADAGI regions bilan bir xil", () => {
  // Seed'dagi 14 ta slug (supabase/seed.sql).
  const expected = [
    "toshkent-shahri", "toshkent-viloyati", "andijon", "buxoro", "fargona",
    "jizzax", "xorazm", "namangan", "navoiy", "qashqadaryo",
    "qoraqalpogiston", "samarqand", "sirdaryo", "surxondaryo",
  ];
  assert.deepEqual([...UZ_MAP_REGIONS.map((r) => r.slug)].sort(), [...expected].sort());
});

test("har hududning HAQIQIY geometriyasi bor", () => {
  // Ko'rinmas to'rtburchak emas: har path haqiqiy chegara.
  for (const region of UZ_MAP_REGIONS) {
    assert.ok(region.d.startsWith("M"), region.slug);
    assert.ok(region.d.endsWith("Z"), region.slug);
    assert.ok(region.d.length > 200, `${region.slug}: juda sodda (${region.d.length})`);
  }
});

test("xarita yengil — ommaviy sahifa uchun", () => {
  const total = UZ_MAP_REGIONS.reduce((sum, r) => sum + r.d.length, 0);
  assert.ok(total < 120_000, `${total} belgi — juda og‘ir`);
  assert.match(UZ_MAP_VIEWBOX, /^0 0 \d+ \d+$/);
});

/* ============== 2. MARSHRUTLASH — HUDUD BIRINCHI ======================= */

test("lid avval O‘Z hududi koordinatoriga taklif qilinadi", () => {
  const picked = pickRegionalCoordinator(
    [
      coordinator({ id: "buxoro", regionId: "r-buxoro", offeredToday: 0 }),
      coordinator({ id: "samarqand", regionId: "r-samarqand", offeredToday: 9 }),
    ],
    "r-samarqand",
  );
  // Yuki ko'proq bo'lsa ham — hudud birinchi navbatda o'ziniki.
  assert.equal(picked?.id, "samarqand");
});

test("hududda koordinator bo‘lmasa null — taxmin qilinmaydi", () => {
  assert.equal(pickRegionalCoordinator([coordinator({ regionId: "r-buxoro" })], "r-jizzax"), null);
  assert.equal(pickRegionalCoordinator([coordinator()], null), null);
});

/* ================= 3. OVERFLOW — ADOLATLI TANLOV ======================= */

test("overflow eng KAM YUKLANGANGA beradi", () => {
  const picked = pickOverflowCoordinator([
    coordinator({ id: "a", offeredToday: 5 }),
    coordinator({ id: "b", offeredToday: 1 }),
    coordinator({ id: "c", offeredToday: 3 }),
  ]);
  assert.equal(picked?.id, "b");
});

test("tanlov TASODIFIY EMAS — har safar bir xil", () => {
  /*
   * `random()` bilan bir koordinator ketma-ket o'nta lid olib,
   * ikkinchisi bittasini ham olmasligi mumkin va buni hech kim
   * tushuntira olmaydi.
   */
  const pool = [
    coordinator({ id: "z", offeredToday: 2 }),
    coordinator({ id: "a", offeredToday: 2 }),
    coordinator({ id: "m", offeredToday: 2 }),
  ];
  const first = pickOverflowCoordinator(pool)?.id;
  for (let i = 0; i < 20; i += 1) {
    assert.equal(pickOverflowCoordinator([...pool].reverse())?.id, first);
  }
});

test("mezonlar tartibi: taklif → ochiq → sotuv → ustuvorlik → id", () => {
  assert.ok(compareForOverflow(coordinator({ offeredToday: 1 }), coordinator({ offeredToday: 2 })) < 0);
  assert.ok(compareForOverflow(
    coordinator({ id: "a", openLeads: 1 }), coordinator({ id: "b", openLeads: 5 })) < 0);
  assert.ok(compareForOverflow(
    coordinator({ id: "a", confirmedToday: 0 }), coordinator({ id: "b", confirmedToday: 3 })) < 0);
  assert.ok(compareForOverflow(
    coordinator({ id: "a", backupPriority: 1 }), coordinator({ id: "b", backupPriority: 9 })) < 0);
  assert.ok(compareForOverflow(coordinator({ id: "a" }), coordinator({ id: "b" })) < 0);
});

test("birinchi mezon TAKLIF, band qilingan emas", () => {
  // Aks holda takliflarni e'tiborsiz qoldiradigan koordinator
  // cheksiz yangi lid olib turardi — tizim uni "bo'sh" deb ko'rardi.
  const picked = pickOverflowCoordinator([
    coordinator({ id: "ignores", offeredToday: 10, openLeads: 0 }),
    coordinator({ id: "works", offeredToday: 2, openLeads: 8 }),
  ]);
  assert.equal(picked?.id, "works");
});

test("faolsiz va to‘xtatilganlar lid OLMAYDI", () => {
  for (const status of ["paused", "offline", "suspended"]) {
    assert.equal(canReceiveLeads(coordinator({ status })), false, status);
  }
  assert.equal(canReceiveLeads(coordinator({ isActive: false })), false);
  assert.equal(canReceiveLeads(coordinator()), true);
});

test("kunlik chegaraga yetgan koordinator yangi lid olmaydi", () => {
  assert.equal(canReceiveLeads(coordinator({ dailyLeadLimit: 5, offeredToday: 5 })), false);
  assert.equal(canReceiveLeads(coordinator({ dailyLeadLimit: 5, offeredToday: 4 })), true);
  // NULL — cheklovsiz.
  assert.equal(canReceiveLeads(coordinator({ dailyLeadLimit: null, offeredToday: 99 })), true);
});

test("allaqachon rad etgan koordinator qayta taklif OLMAYDI", () => {
  const picked = pickOverflowCoordinator(
    [coordinator({ id: "a", offeredToday: 0 }), coordinator({ id: "b", offeredToday: 5 })],
    { excludeIds: ["a"] },
  );
  assert.equal(picked?.id, "b");
});

test("mos koordinator bo‘lmasa null — lid YO‘QOLMAYDI, kutadi", () => {
  assert.equal(pickOverflowCoordinator([coordinator({ status: "paused" })]), null);
  assert.equal(pickOverflowCoordinator([]), null);
});

/* =================== 4. ATOMIK BAND QILISH ============================= */

test("band qilish SHARTLI UPDATE — o‘qib-yozish emas", () => {
  /*
   * Ikki koordinator bir vaqtda bosishi mumkin. "O'qib, keyin
   * yozish" ikkalasiga ham "bo'sh" deb ko'rinardi va lid ikkovga
   * biriktirilardi.
   */
  assert.match(migration, /create or replace function public\.claim_coordinator_lead/);
  const fn = migration.slice(migration.indexOf("claim_coordinator_lead"));
  assert.match(fn, /update public\.coordinator_leads/);
  assert.match(fn, /and assigned_coordinator_id is null/);
  assert.match(fn, /and claim_deadline > now\(\)/);
  assert.match(fn, /get diagnostics .* = row_count/);
});

test("yutqazgan urinish SABABINI biladi", () => {
  // "Band qilib bo'lmadi" degan javob koordinatorni nima
  // bo'lganini bilmay qoldirardi.
  const fn = migration.slice(migration.indexOf("claim_coordinator_lead"));
  assert.match(fn, /already_claimed/);
  assert.match(fn, /expired/);
});

test("10 daqiqalik oyna", () => {
  assert.equal(DEFAULT_CLAIM_WINDOW_MINUTES, 10);
  const offered = new Date("2026-09-19T10:00:00Z");
  assert.equal(claimDeadline(offered, 10).toISOString(), "2026-09-19T10:10:00.000Z");
  assert.equal(isExpired("2026-09-19T10:10:00Z", new Date("2026-09-19T10:09:59Z")), false);
  assert.equal(isExpired("2026-09-19T10:10:00Z", new Date("2026-09-19T10:10:01Z")), true);
  assert.equal(isExpired(null), false);
});

/* ============ 5. HUDUD vs KOORDINATOR — ALOHIDA ======================== */

test("lid hududi va koordinator hududi ALOHIDA ustunlar", () => {
  /*
   * Samarqand lidini Buxoro koordinatori olsa: Samarqand bozori
   * +1 konversiya, Buxoro koordinatori +1 shaxsiy sotuv. Bitta
   * maydon bo'lsa, overflow butun hududiy statistikani buzardi.
   */
  assert.match(migration, /lead_region_id uuid/);
  assert.match(migration, /assigned_coordinator_region_id uuid/);
  assert.match(migration, /assigned_coordinator_id uuid/);
});

test("band qilishda lid hududi O‘ZGARMAYDI", () => {
  const fn = migration.slice(
    migration.indexOf("claim_coordinator_lead"),
    migration.indexOf("-- 8. RLS"),
  );
  assert.ok(fn.includes("assigned_coordinator_region_id = v_region"));
  assert.ok(!fn.includes("lead_region_id ="), "lid hududi hech qachon qayta yozilmasin");
});

test("marshrutlash tarixi USTIDAN YOZILMAYDI", () => {
  // "Bu lid nega bu odamda?" degan savolga javob faqat shu yerdan.
  assert.match(migration, /create table if not exists public\.lead_routing_events/);
  for (const event of ["offered", "claimed", "expired", "overflow", "reassigned"]) {
    assert.ok(migration.includes(`'${event}'`), event);
  }
});

/* ======================= 6. KUNLIK TALAB =============================== */

const targets = [
  { targetDate: null, regionId: null, targetSales: 10 },
  { targetDate: "2026-10-01", regionId: null, targetSales: 15 },
  { targetDate: null, regionId: "r-samarqand", targetSales: 12 },
];

test("talab aniqlikdan umumiyga tanlanadi", () => {
  assert.equal(resolveTarget(targets, "2026-09-19", null), 10);
  assert.equal(resolveTarget(targets, "2026-10-01", null), 15);
  assert.equal(resolveTarget(targets, "2026-09-19", "r-samarqand"), 12);
  assert.equal(resolveTarget([], "2026-09-19", null), null, "talab yo‘q — null, nol emas");
});

test("TARIX o‘zgarmaydi: kecha kechagi talab bilan baholanadi", () => {
  // Talab ertaga 10 dan 15 ga o'zgarsa, kechagi natija kechagi
  // talab bilan qolishi kerak.
  assert.equal(resolveTarget(targets, "2026-09-30", null), 10);
  assert.equal(resolveTarget(targets, "2026-10-01", null), 15);
});

test("xarita holati talab bajarilishiga qarab", () => {
  assert.equal(targetState({ confirmedSales: 10, target: 10 }), "target_met");
  assert.equal(targetState({ confirmedSales: 14, target: 10 }), "top_performer");
  assert.equal(targetState({ confirmedSales: 8, target: 10 }), "near_target");
  assert.equal(targetState({ confirmedSales: 2, target: 10 }), "below_target");
});

test("“ma’lumot yo‘q” va “nol sotuv” AJRATILADI", () => {
  // Ikkalasini "0" deb ko'rsatish yangi hududni yomon ishlayotgandek
  // ko'rsatardi.
  assert.equal(targetState({ confirmedSales: null, target: 10 }), "no_data");
  assert.equal(targetState({ confirmedSales: 0, target: 10 }), "below_target");
  assert.equal(targetState({ confirmedSales: 5, target: null }), "no_target");
});

test("har holatning yorlig‘i bor", () => {
  for (const state of TARGET_STATES) assert.ok(TARGET_STATE_LABELS[state], state);
});

test("foiz talabsiz hisoblanmaydi", () => {
  assert.equal(targetProgress(10, 10), 100);
  assert.equal(targetProgress(14, 10), 140);
  assert.equal(targetProgress(5, null), null);
  assert.equal(targetProgress(5, 0), null);
});

/* ===================== 7. NOMINATSIYALAR =============================== */

const stat = (over: Partial<CoordinatorDayStats>): CoordinatorDayStats => ({
  coordinatorId: "c1",
  coordinatorName: "Koordinator",
  regionId: "r1",
  claimedLeads: 0,
  confirmedSales: 0,
  targetReachedAt: null,
  ...over,
});

test("BIRINCHI talabni bajargan — VAQT bo‘yicha, jami son bo‘yicha emas", () => {
  /*
   * Kun oxirida 20 ta sotgan odam talabni 18:00 da, 10 ta sotgan
   * esa 11:00 da bajargan bo'lishi mumkin. "Birinchi" — vaqt
   * haqidagi savol.
   */
  const result = firstToTarget([
    stat({ coordinatorId: "ko‘p", confirmedSales: 20, targetReachedAt: "2026-09-19T13:00:00Z" }),
    stat({ coordinatorId: "erta", confirmedSales: 10, targetReachedAt: "2026-09-19T06:00:00Z" }),
  ]);
  assert.deepEqual(result.winners.map((w) => w.coordinatorId), ["erta"]);
  assert.match(result.explanation, /11:00/, "Toshkent vaqtida");
});

test("hech kim bajarmasa g‘olib YO‘Q — birontasi tanlanmaydi", () => {
  const result = firstToTarget([stat({ confirmedSales: 3 })]);
  assert.deepEqual(result.winners, []);
  assert.match(result.explanation, /hech kim bajarmadi/);
});

test("eng ko‘p sotuv — teng natijada HAMMASI ko‘rsatiladi", () => {
  // Tasodifan bittasini tanlash qolganlarining ishini ko'rinmas
  // qilardi.
  const result = mostSales([
    stat({ coordinatorId: "a", confirmedSales: 8 }),
    stat({ coordinatorId: "b", confirmedSales: 8 }),
    stat({ coordinatorId: "c", confirmedSales: 3 }),
  ]);
  assert.deepEqual(result.winners.map((w) => w.coordinatorId).sort(), ["a", "b"]);
  assert.equal(result.tied, true);
});

test("SAMARADORLIK: 1/1 = 100% 9/10 = 90% ni YENGMAYDI", () => {
  /*
   * Minimal maxrajsiz bu ko'rsatkich ma'nosiz: bitta lid olib
   * bittasini sotgan odam omad bilan, 10 tadan 9 tasini sotganni
   * — ish bilan — yengardi.
   */
  const result = mostEfficient([
    stat({ coordinatorId: "omad", claimedLeads: 1, confirmedSales: 1 }),
    stat({ coordinatorId: "ish", claimedLeads: 10, confirmedSales: 9 }),
  ], 5);
  assert.deepEqual(result.winners.map((w) => w.coordinatorId), ["ish"]);
});

test("samaradorlik MAXRAJNI ko‘rsatadi", () => {
  // "90%" o'zi hech narsa aytmaydi, "9 / 10" aytadi.
  const result = mostEfficient([stat({ claimedLeads: 10, confirmedSales: 9 })], 5);
  assert.match(result.explanation, /9 \/ 10 = 90%/);
  assert.match(result.explanation, /kamida 5/);
});

test("minimal namuna sozlanadi va majburlanadi", () => {
  const stats = [stat({ claimedLeads: 4, confirmedSales: 4 })];
  assert.deepEqual(mostEfficient(stats, 5).winners, []);
  assert.equal(mostEfficient(stats, 4).winners.length, 1);
});

/* ======================== 8. KOMISSIYA ================================= */

test("komissiya FAQAT tasdiqlangan to‘lovdan keyin", () => {
  for (const state of [
    "payment_requested", "payment_claimed", "payment_evidence",
    "intake_submitted", "claimed", "contacted",
  ]) {
    assert.equal(shouldCreateCommission(state), false, state);
  }
  assert.equal(shouldCreateCommission("payment_confirmed"), true);
  assert.equal(shouldCreateCommission("won"), true);
});

test("chek yuborilgani komissiya yaratmaydi", () => {
  const draft = buildCommission({
    leadState: "payment_evidence",
    coordinatorId: "c1",
    amountUzs: 10000,
  });
  assert.equal(draft, null);
});

test("tasdiqlangan to‘lov komissiya yaratadi — Toshkent kuni bilan", () => {
  const draft = buildCommission({
    leadState: "payment_confirmed",
    coordinatorId: "c1",
    amountUzs: 10000,
    // 19-sentabr 20:00 UTC = 20-sentabr 01:00 Toshkent.
    at: new Date("2026-09-19T20:00:00Z"),
  });
  assert.equal(draft?.businessDate, "2026-09-20");
  assert.equal(draft?.status, "earned");
  assert.equal(draft?.amountUzs, 10000);
});

test("koordinatorsiz komissiya yaratilmaydi", () => {
  assert.equal(
    buildCommission({ leadState: "payment_confirmed", coordinatorId: null, amountUzs: 10000 }),
    null,
  );
});

test("bitta lid — bitta komissiya (baza darajasida)", () => {
  // Shart bilan tekshirish yetarli emas: ikki parallel jarayon
  // ikkalasi ham "yo'q ekan" deb o'qishi mumkin.
  assert.match(migration, /create unique index[^;]*uq_commission_per_lead[^;]*lead_id/);
});

/* ==================== 9. TOSHKENT ISH KUNI ============================= */

test("ish kuni TOSHKENT bo‘yicha, UTC emas", () => {
  /*
   * UTC yarim tuni Toshkentda soat 05:00 — ertalab 04:00 da
   * qilingan sotuv "kecha" ga tushib, kunlik reytingni buzardi.
   */
  assert.equal(businessDate(new Date("2026-09-19T20:00:00Z")), "2026-09-20");
  assert.equal(businessDate(new Date("2026-09-19T18:59:00Z")), "2026-09-19");
  assert.equal(businessDate(new Date("2026-09-20T03:00:00Z")), "2026-09-20");
});

test("kun chegaralari UTC da to‘g‘ri", () => {
  const range = businessDayRange("2026-09-20");
  assert.equal(range.startIso, "2026-09-19T19:00:00.000Z");
  assert.equal(range.endIso, "2026-09-20T19:00:00.000Z");
});

/* ======================= 10. XAVFSIZLIK ================================ */

test("migratsiya non-destructive", () => {
  assert.ok(!/\bdrop table\b|\btruncate\b|\bdelete from\b/i.test(migration));
});

test("RLS yoqilgan va ruxsat talab qilinadi", () => {
  for (const table of [
    "coordinators", "coordinator_leads", "lead_routing_events",
    "coordinator_commissions",
  ]) {
    assert.ok(
      migration.includes(`alter table public.${table} enable row level security`),
      table,
    );
  }
  assert.match(migration, /coordinators\.view/);
});

test("bitta Telegram id — bitta FAOL koordinator", () => {
  // Aks holda bot bir odamni ikki koordinator deb bilib, lidni
  // ikki marta taklif qilardi.
  assert.match(
    migration,
    /create unique index[^;]*uq_coordinator_telegram_active[^;]*telegram_user_id[\s\S]*?where telegram_user_id is not null and is_active/,
  );
});

test("MARSHRUTLASH O‘CHIQ holatda keladi", () => {
  // Kod deploy bo'lgani bilan hech bir koordinatorga xabar
  // ketmasin: koordinatorlar hali kiritilmagan bo'lishi mumkin.
  assert.match(migration, /'coordinator\.routing_enabled', 'false'/);
});

test("tijoriy qiymatlar SOZLAMADA, kodda qotib qolmagan", () => {
  for (const key of [
    "coordinator.commission_uzs",
    "coordinator.claim_window_minutes",
    "coordinator.default_daily_target",
    "coordinator.efficiency_min_leads",
  ]) {
    assert.ok(migration.includes(key), key);
  }
});
