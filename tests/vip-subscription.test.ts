import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activate,
  cancel,
  canApply,
  checkReason,
  dueTransition,
  extend,
  isTerminal,
  restore,
  suspend,
  SUBSCRIPTION_STATES,
  type PlanTerms,
  type SubscriptionState,
  type SubscriptionTimes,
} from "../src/lib/vip/subscription-rules.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-10-01T12:00:00Z");

const PLAN: PlanTerms = { durationDays: 365, graceDays: 14 };

function times(overrides: Partial<SubscriptionTimes> = {}): SubscriptionTimes {
  return {
    startedAt: new Date("2026-01-01T00:00:00Z"),
    currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
    graceUntil: new Date("2027-01-15T00:00:00Z"),
    ...overrides,
  };
}

function unwrap(outcome: ReturnType<typeof activate>) {
  assert.equal(outcome.ok, true, "ok: false kutilmagan");
  if (!outcome.ok) throw new Error("unreachable");
  return outcome.result;
}

/* ------------------------------------------------------------------ *
 * FAOLLASHTIRISH
 * ------------------------------------------------------------------ */

test("faollashtirish muddatni NOW dan hisoblaydi", () => {
  // Odam to'lovni kech qilgan bo'lsa, kutgan kunlari uning hisobidan ketmaydi.
  const result = unwrap(activate("pending", PLAN, NOW));

  assert.equal(result.state, "active");
  assert.equal(result.event, "activated");
  assert.equal(result.times.startedAt?.toISOString(), NOW.toISOString());
  assert.equal(
    result.times.currentPeriodEnd?.getTime(),
    NOW.getTime() + 365 * DAY,
  );
});

test("faollashtirish imtiyoz sanasini davr oxiridan qo'yadi", () => {
  const result = unwrap(activate("pending", PLAN, NOW));
  assert.equal(
    result.times.graceUntil!.getTime() - result.times.currentPeriodEnd!.getTime(),
    14 * DAY,
  );
});

test("imtiyozsiz tarifda graceUntil null bo'ladi", () => {
  // 0 kun imtiyozni "davr oxiri bilan bir xil" deb yozish uni bor ko'rsatardi.
  const result = unwrap(activate("pending", { durationDays: 30, graceDays: 0 }, NOW));
  assert.equal(result.times.graceUntil, null);
});

test("muddatsiz tarif null davr oxiri beradi", () => {
  const result = unwrap(activate("pending", { durationDays: null, graceDays: 14 }, NOW));
  assert.equal(result.times.currentPeriodEnd, null);
  assert.equal(result.times.graceUntil, null);
});

test("allaqachon faol obunani qayta faollashtirib bo'lmaydi", () => {
  /*
   * Aks holda muddat jimgina qayta hisoblanib, odam to'lagan kunlarini
   * yo'qotishi mumkin edi. Buning uchun `extend` bor.
   */
  const outcome = activate("active", PLAN, NOW);
  assert.equal(outcome.ok, false);
});

/* ------------------------------------------------------------------ *
 * UZAYTIRISH — eng nozik qoida
 * ------------------------------------------------------------------ */

test("tugamagan muddat OXIRIDAN uzaytiriladi, qolgan kunlar yo'qolmaydi", () => {
  const t = times({ currentPeriodEnd: new Date("2027-01-01T00:00:00Z") });
  const result = unwrap(extend("active", t, 30, NOW, 14));

  assert.equal(
    result.times.currentPeriodEnd?.toISOString(),
    new Date("2027-01-31T00:00:00Z").toISOString(),
  );
});

test("o'tgan muddat NOW dan uzaytiriladi, o'tmishga kun qo'shilmaydi", () => {
  /*
   * Imtiyoz ichidagi obuna: davr oxiri o'tgan. O'tmishdagi sanaga kun
   * qo'shilsa, uzaytirish qisqa yoki butunlay foydasiz chiqardi.
   */
  const t = times({
    currentPeriodEnd: new Date("2026-09-20T00:00:00Z"),
    graceUntil: new Date("2026-10-04T00:00:00Z"),
  });
  const result = unwrap(extend("grace_period", t, 30, NOW, 14));

  assert.equal(result.times.currentPeriodEnd?.getTime(), NOW.getTime() + 30 * DAY);
});

test("uzaytirish boshlanish sanasini o'zgartirmaydi", () => {
  const t = times();
  const result = unwrap(extend("active", t, 10, NOW, 14));
  assert.equal(result.times.startedAt?.toISOString(), t.startedAt!.toISOString());
});

test("muddatsiz obunani uzaytirish XATO qaytaradi", () => {
  // null ga kun qo'shish obunani QISQARTIRARDI.
  const outcome = extend("active", times({ currentPeriodEnd: null }), 30, NOW, 14);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.error, /Muddatsiz/);
});

test("nol va manfiy kun rad etiladi", () => {
  for (const days of [0, -5, 1.5]) {
    const outcome = extend("active", times(), days, NOW, 14);
    assert.equal(outcome.ok, false, String(days));
  }
});

test("bekor qilingan obunani uzaytirib bo'lmaydi", () => {
  assert.equal(extend("cancelled", times(), 30, NOW, 14).ok, false);
  assert.equal(extend("expired", times(), 30, NOW, 14).ok, false);
});

/* ------------------------------------------------------------------ *
 * TO'XTATISH VA BEKOR QILISH
 * ------------------------------------------------------------------ */

test("to'xtatish sanalarni SAQLAYDI", () => {
  // Tekshiruv holati, jazo emas: tiklanganda qolgan kunlar qaytishi kerak.
  const t = times();
  const result = unwrap(suspend("active", t));

  assert.equal(result.state, "suspended");
  assert.equal(result.times.currentPeriodEnd?.toISOString(), t.currentPeriodEnd!.toISOString());
});

test("bekor qilish ham sanalarni saqlaydi", () => {
  const t = times();
  const result = unwrap(cancel("active", t));
  assert.equal(result.state, "cancelled");
  assert.equal(result.times.currentPeriodEnd?.toISOString(), t.currentPeriodEnd!.toISOString());
});

/* ------------------------------------------------------------------ *
 * TIKLASH
 * ------------------------------------------------------------------ */

test("muddati bor obuna active holga tiklanadi", () => {
  const result = unwrap(restore("suspended", times(), NOW));
  assert.equal(result.state, "active");
  assert.equal(result.event, "restored");
});

test("imtiyoz ichidagi obuna grace_period ga tiklanadi", () => {
  const t = times({
    currentPeriodEnd: new Date("2026-09-25T00:00:00Z"),
    graceUntil: new Date("2026-10-09T00:00:00Z"),
  });
  const result = unwrap(restore("suspended", t, NOW));
  assert.equal(result.state, "grace_period");
});

test("butunlay tugagan obunani tiklash XATO — tekin kun berilmaydi", () => {
  /*
   * Tiklash muddatni o'zidan uzaytirmasligi kerak: tekin kun berish
   * tijoriy qaror va u ongli `extend` bilan qilinadi.
   */
  const t = times({
    currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    graceUntil: new Date("2026-08-15T00:00:00Z"),
  });
  const outcome = restore("expired", t, NOW);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.error, /uzaytirish/i);
});

/* ------------------------------------------------------------------ *
 * FON VAZIFASI
 * ------------------------------------------------------------------ */

test("muddat tugaganda active -> grace_period", () => {
  const t = times({
    currentPeriodEnd: new Date("2026-09-30T00:00:00Z"),
    graceUntil: new Date("2026-10-14T00:00:00Z"),
  });
  const next = dueTransition("active", t, NOW);
  assert.equal(next?.state, "grace_period");
  assert.equal(next?.event, "grace_started");
});

test("imtiyoz ham tugaganda expired", () => {
  const t = times({
    currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
    graceUntil: new Date("2026-09-15T00:00:00Z"),
  });
  assert.equal(dueTransition("grace_period", t, NOW)?.state, "expired");
});

test("imtiyozsiz obuna to'g'ridan-to'g'ri expired bo'ladi", () => {
  const t = times({
    currentPeriodEnd: new Date("2026-09-30T00:00:00Z"),
    graceUntil: null,
  });
  assert.equal(dueTransition("active", t, NOW)?.state, "expired");
});

test("fon vazifasi IDEMPOTENT: ikkinchi chaqiruvda null", () => {
  /*
   * §73 — vazifa qayta ishga tushsa, qo'shimcha yozuv tushmasligi kerak.
   */
  const t = times({
    currentPeriodEnd: new Date("2026-09-30T00:00:00Z"),
    graceUntil: new Date("2026-10-14T00:00:00Z"),
  });

  const first = dueTransition("active", t, NOW);
  assert.equal(first?.state, "grace_period");

  // Holat yangilangandan keyin ikkinchi chaqiruv.
  assert.equal(dueTransition("grace_period", t, NOW), null);
});

test("muddati kelmagan obunaga tegilmaydi", () => {
  assert.equal(dueTransition("active", times(), NOW), null);
});

test("fon vazifasi suspended ga TEGMAYDI — admin qarori bosilmaydi", () => {
  const t = times({
    currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
    graceUntil: new Date("2026-09-15T00:00:00Z"),
  });
  assert.equal(dueTransition("suspended" as SubscriptionState, t, NOW), null);
});

test("muddatsiz obuna hech qachon tugamaydi", () => {
  const t = times({ currentPeriodEnd: null, graceUntil: null });
  assert.equal(dueTransition("active", t, new Date("2099-01-01T00:00:00Z")), null);
});

/* ------------------------------------------------------------------ *
 * O'TISH RUXSATLARI
 * ------------------------------------------------------------------ */

test("tugallangan holatlar belgilangan", () => {
  assert.equal(isTerminal("expired"), true);
  assert.equal(isTerminal("cancelled"), true);
  assert.equal(isTerminal("active"), false);
  assert.equal(isTerminal("suspended"), false);
});

test("har bir holat uchun ruxsat jadvali aniq javob beradi", () => {
  // Noma'lum holat uchun `undefined.includes` yiqilmasligi kerak.
  for (const state of SUBSCRIPTION_STATES) {
    for (const action of ["activate", "extend", "suspend", "cancel", "restore"] as const) {
      assert.equal(typeof canApply(action, state), "boolean", `${action}/${state}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * SABAB
 * ------------------------------------------------------------------ */

test("admin amali sababsiz qolmaydi", () => {
  assert.ok(checkReason(null));
  assert.ok(checkReason("  "));
  assert.ok(checkReason("ok"));
  assert.equal(checkReason("To'lov tasdiqlandi"), null);
  assert.ok(checkReason("x".repeat(501)));
});

/* ------------------------------------------------------------------ *
 * Chegara
 * ------------------------------------------------------------------ */

test("subscription-rules.ts hech narsa import qilmaydi", () => {
  const source = readFileSync("src/lib/vip/subscription-rules.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  assert.equal(/^\s*import\s/m.test(source), false, "import topildi");
});

/* ------------------------------------------------------------------ *
 * RUXSATLAR: TS va SQL ajralib ketmasin
 * ------------------------------------------------------------------ */

test("vip ruxsatlari TS va SQL matritsalarida bir xil", () => {
  /*
   * `permissions.ts` dagi izoh buni TALAB qiladi: RLS siyosatlari
   * `has_permission('vip.view')` ga tayanadi va u SQL jadvalidan
   * o'qiydi. Ikkovi ajralib ketsa, panel tugmani ko'rsatadi-yu,
   * baza amalni rad etardi — admin uchun bu "tugma ishlamayapti"
   * degan tushunarsiz holat.
   */
  const ts = readFileSync("src/lib/permissions.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261001140000_vip_core.sql", "utf8");

  const tsPerms = new Set(
    [...ts.matchAll(/"(vip\.[a-z_]+)"/g)].map((m) => m[1]),
  );
  const sqlPerms = new Set(
    [...sql.matchAll(/\('(?:admin|moderator|analyst|editor|viewer)',\s*'(vip\.[a-z_]+)'\)/g)].map(
      (m) => m[1],
    ),
  );

  assert.ok(tsPerms.size > 0, "TS da vip ruxsati topilmadi");

  for (const perm of tsPerms) {
    assert.ok(sqlPerms.has(perm), `SQL matritsasida yo'q: ${perm}`);
  }
  for (const perm of sqlPerms) {
    assert.ok(tsPerms.has(perm), `TS ro'yxatida yo'q: ${perm}`);
  }
});

test("feature flaglar migratsiyada seed qilingan va hammasi o'chiq", () => {
  /*
   * §67 — bosqichma-bosqich chiqarish. Yoniq holda seed qilingan flag
   * migratsiya qo'llanishi bilan imkoniyatni hammaga ochib qo'yardi.
   */
  const sql = readFileSync("supabase/migrations/20261001140000_vip_core.sql", "utf8");
  const seeds = [...sql.matchAll(/\('((?:vip|liderlar_online)\.[a-z_]+)',\s*(true|false),/g)];

  assert.ok(seeds.length >= 9, `kutilgan flaglar soni kam: ${seeds.length}`);
  for (const [, key, value] of seeds) {
    assert.equal(value, "false", `${key} yoniq holda seed qilingan`);
  }
});

/* ------------------------------------------------------------------ *
 * KO'RIK NAVBATI SIYOSAT BILAN MOS KELSIN
 * ------------------------------------------------------------------ */

test("ko'rik navbati FAQAT review siyosatidagi turlarni oladi", () => {
  /*
   * `books_read` va `social_links` darhol nashr bo'ladi — ularda
   * kutayotgan yozuv paydo bo'lmaydi va ro'yxatga qo'shish har
   * safar bo'sh so'rov qilardi.
   *
   * Teskari xato battarroq: `review` siyosatidagi tur ro'yxatdan
   * qolib ketsa, o'sha bo'limga yuborilgan yozuvni HECH KIM
   * tasdiqlay olmaydi va u navbatda abadiy qolib ketardi.
   */
  const source = readFileSync("src/lib/profile-editor/entry-review-service.ts", "utf8");

  const match = source.match(/const REVIEWED_KINDS = \[([^\]]+)\]/);
  assert.ok(match, "REVIEWED_KINDS topilmadi");

  const kinds = [...match![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).sort();

  assert.deepEqual(kinds, ["achievements", "education", "events", "work_experiences"]);
});

test("tasdiqlash va qaytarish holat shartini qo'llaydi", () => {
  /*
   * Ikki admin bir vaqtda bosgan bo'lsa, ikkinchisi hech narsa
   * yangilamasligi kerak — aks holda uning izohi birinchisining
   * izohini bosib ketardi.
   */
  const source = readFileSync("src/lib/profile-editor/entry-review-service.ts", "utf8");
  const matches = source.match(/\.eq\("review_state", "pending_review"\)/g) ?? [];
  assert.ok(matches.length >= 2, `holat sharti yetarli emas: ${matches.length}`);
});

test("qaytarilgan yozuv O'CHIRILMAYDI", () => {
  /*
   * O'chirish odamning yozganini yo'q qilardi va u nima
   * yuborganini ham ko'rmasdi. `rejected` holatida esa u
   * muharrirda izoh bilan turadi va tuzatilishi mumkin.
   */
  const source = readFileSync("src/lib/profile-editor/entry-review-service.ts", "utf8");
  assert.equal(/\.delete\(\)/.test(source), false, "delete() topildi");
  assert.match(source, /review_state: "rejected"/);
});

/* ------------------------------------------------------------------ *
 * SERVER-ONLY CHEGARASI
 * ------------------------------------------------------------------ */

test("mijoz komponentlari server-only modullardan QIYMAT import qilmaydi", () => {
  /*
   * Bu xatoni `tsc` ham, `eslint` ham TUTMAYDI — faqat
   * `npm run build` tutadi. Shuning uchun test kerak.
   *
   * Tip importi xavfsiz (o'chib ketadi), ish vaqti qiymati esa
   * server-only modulni mijoz paketiga tortadi va build yiqiladi.
   */
  const clientFiles = [
    "src/app/(admin)/profil-tahrirlari/certificate-review-list.tsx",
    "src/app/(admin)/profil-tahrirlari/entry-review-list.tsx",
    "src/app/(admin)/profil-tahrirlari/edit-review-list.tsx",
    "src/app/(admin)/vip/vip-manager.tsx",
  ];

  const serverOnlyModules = [
    "@/lib/profile-editor/certificate-review-service",
    "@/lib/profile-editor/entry-review-service",
    "@/lib/profile-editor/review-service",
    "@/lib/vip/subscription-service",
  ];

  for (const file of clientFiles) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /^"use client";/m, `${file}: "use client" yo'q`);

    for (const moduleName of serverOnlyModules) {
      // Shu moduldan importlarni topamiz.
      const pattern = new RegExp(
        `import\\s+([^;]*?)\\s+from\\s+"${moduleName.replace(/[/@-]/g, "\\$&")}"`,
        "g",
      );
      for (const match of source.matchAll(pattern)) {
        const clause = match[1]!;
        /*
         * Butun import `type` bo'lsa yoki har bir nom `type` bilan
         * belgilangan bo'lsa — xavfsiz.
         */
        if (/^type\s/.test(clause.trim())) continue;

        const names = clause.replace(/[{}]/g, "").split(",").map((n) => n.trim());
        for (const name of names) {
          if (name === "") continue;
          assert.ok(
            name.startsWith("type "),
            `${file}: ${moduleName} dan qiymat import qilingan (${name})`,
          );
        }
      }
    }
  }
});

test("umumiy sertifikat qiymatlari sof modulda", () => {
  const pure = readFileSync("src/lib/profile-editor/certificate-trust.ts", "utf8");
  // Izohda so'z sifatida uchrashi mumkin — IMPORT bor-yo'qligini tekshiramiz.
  assert.equal(/^\s*import\s+"server-only"/m.test(pure), false);
  assert.match(pure, /export const TRUST_CHOICES/);
  assert.match(pure, /export const TRUST_LABEL/);
});

/* ------------------------------------------------------------------ *
 * A'ZO MAQOLALARI — BIOGRAFIYAGA TEGMASLIK
 * ------------------------------------------------------------------ */

test("tahririyat xizmati FAQAT member_articles bilan ishlaydi", () => {
  /*
   * Mavjud `articles` — nomzod BIOGRAFIYASI va u profil sahifasida
   * biografiya matni sifatida ko'rsatiladi. Bu xizmat o'sha jadvalga
   * tegsa, a'zo maqolasi biografiya o'rniga chiqib ketardi.
   */
  const source = readFileSync("src/lib/articles/editorial-service.ts", "utf8");
  assert.match(source, /from\("member_articles"\)/);
  assert.equal(/from\("articles"\)/.test(source), false, "articles jadvaliga tegilgan");
});

test("nashr slug'ni saqlaydi, nashrdan qaytarish esa o'chirmaydi", () => {
  /*
   * Slug o'chirilsa, maqola qayta nashr qilinganda boshqa manzil
   * olardi va tashqaridan kelgan eski havolalar yo'qolardi.
   */
  const source = readFileSync("src/lib/articles/editorial-service.ts", "utf8");
  const at = source.indexOf('if (input.action === "unpublish")');
  assert.ok(at > 0, "unpublish tarmog'i topilmadi");
  const body = source.slice(at, at + 400);
  assert.equal(/patch\.slug = null/.test(body), false, "unpublish slug'ni o'chiryapti");
  assert.match(body, /published_at = null/);
});

test("mavjud slug qayta ishlatiladi", () => {
  const source = readFileSync("src/lib/articles/editorial-service.ts", "utf8");
  const at = source.indexOf("async function preparePublish");
  const body = source.slice(at, at + 500);
  assert.match(body, /if \(existingSlug\) return \{ ok: true, slug: existingSlug \}/);
});

test("kanal xatosi nashrni yiqitmaydi", () => {
  /*
   * §25: maqola allaqachon nashr qilingan va Liderlar Online uni
   * ko'rsatadi. Kanal qatorini keyin tiklash mumkin; nashrni
   * qaytarish esa o'quvchi uchun yomonroq.
   */
  const source = readFileSync("src/lib/articles/editorial-service.ts", "utf8");
  const at = source.indexOf("async function openChannels");
  const body = source.slice(at);
  // Xato faqat logga tushadi, qaytarilmaydi.
  assert.match(body, /console\.error\("\[maqola-korik\] kanallar ochilmadi:"/);
  assert.equal(/return \{ ok: false/.test(body), false);
});

test("AdabiyotX kanali kutilmoqda holatida ochiladi", () => {
  /*
   * Yozish API'si hali yo'q. Qator "pending" bo'lib qolishi kerak —
   * ochilmasa, nashr jimgina yo'qolardi (§25).
   */
  const source = readFileSync("src/lib/articles/editorial-service.ts", "utf8");
  assert.match(source, /channel: "adabiyotx", state: "pending"/);
  assert.match(source, /channel: "liderlar_online",\s*state: "synced"/);
});

/* ------------------------------------------------------------------ *
 * AdabiyotX UZATISH — §25
 * ------------------------------------------------------------------ */

test("mavjud integratsiya kaliti qayta ishlatiladi", () => {
  /*
   * AdabiyotX bizning o'z loyihamiz va o'qish funksiyasi
   * (`liderlar-catalog-search`) allaqachon shu kalit bilan
   * ishlaydi. Yangi maxfiy ma'lumot yaratish ikki kalitni
   * boshqarishni talab qilardi.
   */
  const sync = readFileSync("src/lib/articles/adabiyotx-sync.ts", "utf8");
  assert.match(sync, /ADABIYOTX_INTEGRATION_API_KEY/);
  assert.match(sync, /"x-adabiyotx-api-key"/);
});

test("faqat NASHR QILINGAN maqola uzatiladi", () => {
  /*
   * Tasdiqlanmagan matnni yuborish uni ikki joyda boshqa holatda
   * qoldirardi.
   */
  const sync = readFileSync("src/lib/articles/adabiyotx-sync.ts", "utf8");
  assert.match(sync, /article\.state !== "published"/);
});

test("4xx qayta urinilmaydi, 5xx urinilaDI", () => {
  /*
   * Bizning xatomiz uchun qayta urinish yordam bermaydi va cron
   * har yurishda bir xil xatoga urilardi.
   */
  const sync = readFileSync("src/lib/articles/adabiyotx-sync.ts", "utf8");
  assert.match(sync, /response\.status >= 500 \|\| response\.status === 429/);
});

test("urinishlar soni cheklangan", () => {
  /*
   * Cheksiz urinish yiqilgan integratsiyaga abadiy so'rov yuborib
   * turardi.
   */
  const sync = readFileSync("src/lib/articles/adabiyotx-sync.ts", "utf8");
  assert.match(sync, /MAX_ATTEMPTS/);
  assert.match(sync, /\.lt\("attempts", MAX_ATTEMPTS\)/);
});

test("so'rovda vaqt chegarasi bor", () => {
  /*
   * Busiz serverless funksiya javob kutib turib, o'z muddatiga
   * yetib borardi va cron yurishi tugallanmay qolardi.
   */
  const sync = readFileSync("src/lib/articles/adabiyotx-sync.ts", "utf8");
  assert.match(sync, /AbortSignal\.timeout\(/);
});

test("flag o'chiq bo'lsa kanal qatorlari SAQLANADI", () => {
  /*
   * §25: "never silently lose publication". Flag yoqilganda
   * `pending` qatorlarning hammasi uzatiladi.
   */
  const route = readFileSync("src/app/api/cron/adabiyotx-sync/route.ts", "utf8");
  assert.match(route, /vip\.adabiyotx_sync_enabled/);
  // Flag o'chiq bo'lsa hech narsa o'chirilmasligi kerak.
  assert.equal(/delete\(\)/.test(route), false);
});

test("flaglar xatoda O'CHIQ deb qaraladi", () => {
  /*
   * Teskarisi — xatoda ochib qo'yish — baza uzilganda imkoniyatni
   * o'z-o'zidan yoqib yuborardi.
   */
  const flags = readFileSync("src/lib/feature-flags.ts", "utf8");
  assert.match(flags, /return cache\?\.flags \?\? \{\}/);
  assert.match(flags, /flags\[key\] === true/);
});
