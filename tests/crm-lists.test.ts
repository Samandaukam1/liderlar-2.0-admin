import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCrmListKeyboard,
  buildCrmListText,
  clampCrmPage,
  crmListCallbackData,
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
    const data = crmListCallbackData(kind, 7);
    assert.ok(Buffer.byteLength(data, "utf8") <= 64);
    assert.deepEqual(parseCrmListCallback(data), { kind, page: 7 });
  }
});

test("callback data rejects anything that is not ours", () => {
  assert.equal(parseCrmListCallback(undefined), null);
  assert.equal(parseCrmListCallback(""), null);
  assert.equal(parseCrmListCallback("pay:y:abc"), null, "another feature's button");
  assert.equal(parseCrmListCallback("crm:x:2"), null, "unknown list code");
  assert.equal(parseCrmListCallback("crm:p:0"), null, "pages are 1-based");
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
    rows: [{ fullName: "Aliyev Bek", telegramUsername: "bek_aliyev" }],
    page: 1,
    total: 1,
  });
  assert.ok(text.includes("@bek_aliyev"));
  assert.ok(!text.includes("@@"));
});

test("an empty list says so instead of rendering a bare header", () => {
  const text = buildCrmListText({ kind: "published", rows: [], page: 1, total: 0 });
  assert.ok(text.includes("0 ta"));
  assert.ok(text.includes("Hozircha bo‘sh."));
});

/* ------------------------------- keyboard ------------------------------- */

test("a single-page list gets no pagination buttons", () => {
  assert.deepEqual(buildCrmListKeyboard("published", 1, 1), []);
});

test("the first page offers only next, the last only previous", () => {
  const first = buildCrmListKeyboard("waiting", 1, 5);
  assert.equal(first[0].length, 1);
  assert.deepEqual(parseCrmListCallback(first[0][0].callback_data), { kind: "waiting", page: 2 });

  const last = buildCrmListKeyboard("waiting", 5, 5);
  assert.equal(last[0].length, 1);
  assert.deepEqual(parseCrmListCallback(last[0][0].callback_data), { kind: "waiting", page: 4 });

  const middle = buildCrmListKeyboard("waiting", 3, 5);
  assert.equal(middle[0].length, 2);
  assert.deepEqual(parseCrmListCallback(middle[0][0].callback_data), { kind: "waiting", page: 2 });
  assert.deepEqual(parseCrmListCallback(middle[0][1].callback_data), { kind: "waiting", page: 4 });
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
