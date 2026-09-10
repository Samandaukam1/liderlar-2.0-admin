import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCrmListKeyboard,
  buildCrmListText,
  clampCrmPage,
  crmListCallbackData,
  crmPeriodRange,
  CRM_PERIODS,
  CRM_PERIOD_LABELS,
  crmPageCount,
  crmPageOffset,
  CRM_LIST_BY_BUTTON,
  CRM_LIST_BY_COMMAND,
  CRM_LIST_PAGE_SIZE,
  CRM_LIST_STATUSES,
  FILLING_BUTTON_LABEL,
  parseCrmListCallback,
  PUBLISHED_BUTTON_LABEL,
  WAITING_BUTTON_LABEL,
  type CrmListRow,
} from "../src/lib/intake/crm-list-messages.ts";

const rows = (n: number, offset = 0): CrmListRow[] =>
  Array.from({ length: n }, (_, i) => ({
    fullName: `Nomzod ${offset + i + 1}`,
    telegramUsername: `@user${offset + i + 1}`,
  }));

/* --------------------------- status semantics --------------------------- */

test("each list maps to the exact intake statuses it claims", () => {
  // `published` endi so'rovda ishlatilmaydi — ro'yxat saytdan
  // so'raydi (`article_live`). Qiymat tarixiy ma'lumot sifatida qoladi.
  assert.deepEqual(CRM_LIST_STATUSES.published, ["published"]);
  assert.deepEqual(CRM_LIST_STATUSES.filling, ["draft"]);
  assert.deepEqual(CRM_LIST_STATUSES.waiting, [
    "submitted",
    "ai_reviewing",
    "needs_clarification",
    "approved",
    "promoted",
  ]);
});

test("“kutayotgan” va “chop etilgan” SAYTDAN so‘raladi, holatdan emas", () => {
  // Anketa holati hujjatning holati; sayt esa haqiqat. Ikkalasi
  // ajralganda bot chiqib bo'lgan odamni "kutayapti" deb ko'rsatardi.
  const source = readFileSync(new URL("../src/lib/intake/crm-lists.ts", import.meta.url), "utf8");
  assert.match(source, /from\("candidate_intake_crm"\)/);
  assert.match(source, /case "published":[\s\S]{0,200}\.eq\("article_live", true\)/);
  assert.match(source, /case "waiting":[\s\S]{0,200}\.eq\("article_live", false\)/);
  // Eski shart butunlay olib tashlangan.
  assert.ok(!/\.eq\("status", "published"\)/.test(source));
});

test("ko‘rinish saytning javobini jonli hisoblaydi", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260910140000_crm_article_live.sql", import.meta.url),
    "utf8",
  );
  // Anketa holati `article_live` hisobiga umuman qatnashmaydi.
  assert.match(migration, /c\.status = 'published' and c\.deleted_at is null\)\s+as article_live/);
  assert.ok(!/i\.status[^\n]*as article_live/.test(migration));
  // Ko'rinish anon uchun ochiq qoldirilmaydi.
  assert.match(migration, /revoke all on public\.candidate_intake_crm from anon, authenticated/);
  assert.match(migration, /security_invoker = true/);
  // Ortda qolgan qatorlar bir marta to'g'irlanadi, boshqasi tegilmaydi.
  assert.match(migration, /and i\.status in \('submitted', 'ai_reviewing'/);
  assert.ok(!/delete from|drop table|truncate/i.test(migration));
});

test("waiting is strictly between filling and published, and excludes archived", () => {
  // A candidate can be in at most one list; 'archived' is in none of them.
  const all = [
    ...CRM_LIST_STATUSES.published,
    ...CRM_LIST_STATUSES.waiting,
    ...CRM_LIST_STATUSES.filling,
  ];
  assert.equal(new Set(all).size, all.length, "a status must not appear in two lists");
  assert.ok(!all.includes("archived"));
  assert.ok(!CRM_LIST_STATUSES.waiting.includes("draft"));
  assert.ok(!CRM_LIST_STATUSES.waiting.includes("published"));
});

/* ------------------------------ callbacks ------------------------------ */

test("callback data round-trips and stays inside Telegram's 64-byte cap", () => {
  for (const kind of ["published", "waiting", "filling"] as const) {
    for (const period of CRM_PERIODS) {
      const data = crmListCallbackData(kind, period, 7);
      assert.ok(Buffer.byteLength(data, "utf8") <= 64);
      assert.deepEqual(parseCrmListCallback(data), { kind, period, page: 7 });
    }
  }
});

test("a stale three-part button still means the WHOLE list", () => {
  // Eski xabarlar chatlarda osilib qoladi. O'shanda davr tushunchasi
  // yo'q edi va tugma butun ro'yxatni bildirardi — uni "bugun" deb
  // o'qish ro'yxatni jimgina qisqartirib yuborardi.
  assert.deepEqual(parseCrmListCallback("crm:p:2"), {
    kind: "published",
    period: "all",
    page: 2,
  });
});

test("callback data rejects anything that is not ours", () => {
  assert.equal(parseCrmListCallback(undefined), null);
  assert.equal(parseCrmListCallback(""), null);
  assert.equal(parseCrmListCallback("pay:y:abc"), null, "another feature's button");
  assert.equal(parseCrmListCallback("crm:x:2"), null, "unknown list code");
  assert.equal(parseCrmListCallback("crm:p:0"), null, "pages are 1-based");
  assert.equal(parseCrmListCallback("crm:p:z:2"), null, "unknown period code");
  assert.equal(parseCrmListCallback("crm:p:-3"), null);
  assert.equal(parseCrmListCallback("crm:p:abc"), null, "page NaN must never reach a query");
  assert.equal(parseCrmListCallback("crm:p:"), null);
});

/* ------------------------------ pagination ------------------------------ */

test("page count covers the partial last page and never drops below one", () => {
  assert.equal(crmPageCount(0), 1);
  assert.equal(crmPageCount(1), 1);
  assert.equal(crmPageCount(CRM_LIST_PAGE_SIZE), 1);
  assert.equal(crmPageCount(CRM_LIST_PAGE_SIZE + 1), 2);
  assert.equal(crmPageCount(2000, 20), 100);
});

test("a stale page number from an old message is clamped, not queried", () => {
  assert.equal(clampCrmPage(99, 7), 7);
  assert.equal(clampCrmPage(0, 7), 1);
  assert.equal(clampCrmPage(-5, 7), 1);
  assert.equal(clampCrmPage(3, 7), 3);
});

test("offsets follow the page size", () => {
  assert.equal(crmPageOffset(1), 0);
  assert.equal(crmPageOffset(2), CRM_LIST_PAGE_SIZE);
  assert.equal(crmPageOffset(5, 20), 80);
});

test("2000 results are never one message — the page carries only its own rows", () => {
  const text = buildCrmListText({
    kind: "published",
    period: "all",
    rows: rows(CRM_LIST_PAGE_SIZE),
    page: 1,
    total: 2000,
  });
  assert.ok(text.includes("2000 ta"), "the header still reports the true total");
  assert.ok(text.includes("Sahifa 1/100"));
  assert.ok(!text.includes("Nomzod 21"), "only this page's rows are rendered");
  // Telegram rejects a message over 4096 characters outright.
  assert.ok(text.length < 4096, `page text was ${text.length} characters`);
});

/* -------------------------------- content ------------------------------- */

test("rows carry the name and the Telegram handle — never a phone number", () => {
  const text = buildCrmListText({
    kind: "waiting",
    period: "all",
    rows: [
      { fullName: "Rasulova Gulnoza Avazjon qizi", telegramUsername: "@gulnoza_r" },
      { fullName: "Karimov Aziz", telegramUsername: null },
    ],
    page: 1,
    total: 2,
  });
  assert.ok(text.includes("1. Rasulova Gulnoza Avazjon qizi"));
  assert.ok(text.includes("@gulnoza_r"));
  assert.ok(text.includes("2. Karimov Aziz"));
  assert.ok(text.includes("—"), "a missing handle shows a dash, not an empty line");
  assert.ok(!/\+?998\d|\+\d{7,}/.test(text), "no phone number may appear");
});

test("numbering continues across pages", () => {
  const text = buildCrmListText({
    kind: "filling",
    period: "all",
    rows: rows(3, 40),
    page: 3,
    total: 43,
  });
  assert.ok(text.includes("41. Nomzod 41"));
  assert.ok(text.includes("43. Nomzod 43"));
  assert.ok(text.includes("Sahifa 3/3"));
});

test("a handle stored without its @ is still rendered with one", () => {
  const text = buildCrmListText({
    kind: "filling",
    period: "all",
    rows: [{ fullName: "Aliyev Bek", telegramUsername: "bek_aliyev" }],
    page: 1,
    total: 1,
  });
  assert.ok(text.includes("@bek_aliyev"));
  assert.ok(!text.includes("@@"));
});

test("an empty list says so instead of rendering a bare header", () => {
  const text = buildCrmListText({ kind: "published", period: "today", rows: [], page: 1, total: 0 });
  assert.ok(text.includes("0 ta"));
  assert.ok(text.includes("Bu kesimda hech kim yo‘q."));
});

/* ------------------------------- keyboard ------------------------------- */

/** Kesim tugmalari doim ikkita birinchi qatorda turadi. */
const paginationRow = (rows: ReturnType<typeof buildCrmListKeyboard>) => rows[2];

test("kesim tugmalari HAR DOIM ko‘rinadi — bitta sahifali ro‘yxatda ham", () => {
  // Ular sahifalash emas, kesim tanlash: bugungi ro'yxat bitta
  // sahifaga sig'sa ham, "Kecha" ga o'tish yo'li qolishi kerak.
  const keyboard = buildCrmListKeyboard("published", "today", 1, 1);
  assert.equal(keyboard.length, 2, "faqat kesim qatorlari");
  const labels = keyboard.flat().map((b) => b.text);
  assert.equal(labels.length, 4);
  for (const period of CRM_PERIODS) {
    assert.ok(
      labels.some((label) => label.includes(CRM_PERIOD_LABELS[period])),
      period,
    );
  }
});

test("aktiv kesim belgilanadi", () => {
  const keyboard = buildCrmListKeyboard("published", "yesterday", 1, 1);
  const active = keyboard.flat().filter((b) => b.text.startsWith("▪️"));
  assert.equal(active.length, 1);
  assert.ok(active[0].text.includes("Kecha"));
});

test("kesim almashganda sahifa 1 dan boshlanadi", () => {
  // 5-sahifada turib "Bugun" bosilsa, u kesimda 5-sahifa bo'lmasligi mumkin.
  const keyboard = buildCrmListKeyboard("waiting", "all", 5, 9);
  for (const button of keyboard[0].concat(keyboard[1])) {
    assert.equal(parseCrmListCallback(button.callback_data)?.page, 1);
  }
});

test("a single-page list gets no pagination buttons", () => {
  assert.equal(paginationRow(buildCrmListKeyboard("published", "today", 1, 1)), undefined);
});

test("the first page offers only next, the last only previous", () => {
  const first = paginationRow(buildCrmListKeyboard("waiting", "today", 1, 5));
  assert.equal(first.length, 1);
  assert.deepEqual(parseCrmListCallback(first[0].callback_data), {
    kind: "waiting",
    period: "today",
    page: 2,
  });

  const last = paginationRow(buildCrmListKeyboard("waiting", "today", 5, 5));
  assert.equal(last.length, 1);
  assert.deepEqual(parseCrmListCallback(last[0].callback_data), {
    kind: "waiting",
    period: "today",
    page: 4,
  });

  const middle = paginationRow(buildCrmListKeyboard("waiting", "earlier", 3, 5));
  assert.equal(middle.length, 2);
  // Sahifalash kesimni SAQLAYDI — aks holda "keyingi" bosilganda
  // ro'yxat boshqa kunga sakrab ketardi.
  assert.deepEqual(parseCrmListCallback(middle[0].callback_data), {
    kind: "waiting",
    period: "earlier",
    page: 2,
  });
  assert.deepEqual(parseCrmListCallback(middle[1].callback_data), {
    kind: "waiting",
    period: "earlier",
    page: 4,
  });
});

/* -------------------------------- kesimlar ------------------------------ */

test("kesimlar butun to‘plamni QOLDIRIQSIZ bo‘ladi", () => {
  // Bugun + kecha + undan avval = hammasi. Oraliqda tushib qolgan
  // yozuv hech qaysi tugmada ko‘rinmasdi.
  const now = new Date("2026-09-07T10:00:00.000Z");
  const today = crmPeriodRange("today", now);
  const yesterday = crmPeriodRange("yesterday", now);
  const earlier = crmPeriodRange("earlier", now);

  // Chegaralar tutashadi: kechaning oxiri = bugunning boshi.
  assert.equal(yesterday.endIso, today.startIso);
  // "Undan avval" kechaning boshigacha.
  assert.equal(earlier.endIso, yesterday.startIso);
  assert.equal(earlier.startIso, null);

  // Sanasi yo'q yozuvlar "undan avval" ga tushadi va yo'qolmaydi.
  assert.equal(earlier.includeNull, true);
  assert.equal(today.includeNull, false);
  assert.equal(yesterday.includeNull, false);
});

test("“hammasi” hech narsani filtrlamaydi", () => {
  const all = crmPeriodRange("all");
  assert.equal(all.startIso, null);
  assert.equal(all.endIso, null);
});

test("kun chegarasi Toshkent bo‘yicha, UTC bo‘yicha emas", () => {
  // UTC 20:00 — Toshkentda ertasi kun 01:00. Server UTC'da ishlaydi,
  // shuning uchun "bugun" UTC kuni bo'yicha olinsa, kechqurun
  // topshirilgan anketa "kecha" ga tushib qolardi.
  const evening = new Date("2026-09-07T20:00:00.000Z");
  const today = crmPeriodRange("today", evening);
  assert.ok(today.startIso! <= evening.toISOString());
  assert.ok(today.endIso! > evening.toISOString());
  // Toshkent kuni 19:00 UTC da boshlanadi (00:00 +05).
  assert.ok(today.startIso!.endsWith("19:00:00.000Z"));
});

test("sarlavhada qaysi kesim ekani DOIM yoziladi", () => {
  // "12 ta" degan son qaysi kunga tegishli ekani aytilmasa, chalg'itadi.
  for (const period of CRM_PERIODS) {
    const text = buildCrmListText({
      kind: "waiting",
      period,
      rows: rows(2),
      page: 1,
      total: 2,
    });
    assert.ok(text.includes(CRM_PERIOD_LABELS[period]), period);
  }
});

/* -------------------------------- routing ------------------------------- */

test("every button label and command routes to its own list", () => {
  assert.equal(CRM_LIST_BY_BUTTON[PUBLISHED_BUTTON_LABEL], "published");
  assert.equal(CRM_LIST_BY_BUTTON[WAITING_BUTTON_LABEL], "waiting");
  assert.equal(CRM_LIST_BY_BUTTON[FILLING_BUTTON_LABEL], "filling");
  assert.equal(CRM_LIST_BY_COMMAND["/chopetilganlar"], "published");
  assert.equal(CRM_LIST_BY_COMMAND["/kutayotganlar"], "waiting");
  assert.equal(CRM_LIST_BY_COMMAND["/toldirayotganlar"], "filling");
  assert.equal(CRM_LIST_BY_BUTTON["salom"], undefined, "ordinary text routes nowhere");
});
