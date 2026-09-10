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
  describeWaitingReason,
  type CrmListRow,
  type WaitingContext,
} from "../src/lib/intake/crm-list-messages.ts";
import { PIPELINE_STAGE_LABELS, splitPipelineError } from "../src/lib/post-studio/pipeline-stages.ts";
import { isStaleRun, PIPELINE_STALE_AFTER_MS } from "../src/lib/post-studio/pipeline-recovery.ts";

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

/* ---------------------------- nega kutayapti ---------------------------- */

const waitingContext = (over: Partial<WaitingContext> = {}): WaitingContext => ({
  status: "promoted",
  paymentStatus: "paid",
  pipelineStatus: null,
  pipelineError: null,
  pipelineStartedAt: null,
  processAfter: null,
  ...over,
});

const AT = new Date("2026-09-10T09:00:00Z");
const minutesBefore = (n: number) => new Date(AT.getTime() - n * 60_000).toISOString();
const minutesAfter = (n: number) => new Date(AT.getTime() + n * 60_000).toISOString();

test("to‘lov qilmagan odam aynan shu so‘z bilan ajratiladi", () => {
  const unpaid = describeWaitingReason(
    waitingContext({ status: "submitted", paymentStatus: "unpaid" }),
    AT,
  );
  assert.match(unpaid.label, /to‘lov qilmagan/);

  // 'unknown' — hech kim tekshirmagan, 'unpaid' — tekshirilib rad etilgan.
  // Ikkalasini bir xil aytish muharrirni yo'q qarorga ishontirardi.
  const unknown = describeWaitingReason(
    waitingContext({ status: "submitted", paymentStatus: "unknown" }),
    AT,
  );
  assert.match(unknown.label, /tasdiqlanmagan/);
  assert.notEqual(unknown.label, unpaid.label);
});

test("to‘lov yo‘qligi eski xato yozuvidan USTUN turadi", () => {
  // Quvur to'lovsiz bu odamni umuman olmaydi, ya'ni o'sha xato hozirgi
  // to'siq emas. Aks holda muharrir boshlanmagan ishni tuzatishga o'tardi.
  const reason = describeWaitingReason(
    waitingContext({
      paymentStatus: "unpaid",
      pipelineStatus: "failed",
      pipelineError: "render: eski urinish",
    }),
    AT,
  );
  assert.match(reason.label, /to‘lov qilmagan/);
  assert.ok(!reason.label.includes("render"));
});

test("texnik xato AYNAN qaysi bosqichda bo‘lganini aytadi", () => {
  const reason = describeWaitingReason(
    waitingContext({
      pipelineStatus: "failed",
      pipelineError: "render: sharp: unsupported image format",
    }),
    AT,
  );
  assert.equal(reason.label, `Texnik xato: ${PIPELINE_STAGE_LABELS.render}`);
  assert.equal(reason.detail, "sharp: unsupported image format");
});

test("pipeline.ts dagi `fail()` yozgan satr aynan shu shaklda o‘qiladi", () => {
  // Format bitta joyda yoziladi va boshqa joyda o'qiladi; ikkisi
  // ajralib ketsa ro'yxat bosqich o'rniga xom satrni ko'rsatib qo'yardi.
  const source = readFileSync("src/lib/post-studio/pipeline.ts", "utf8");
  assert.ok(
    source.includes("post_pipeline_error: `${stage}: ${error}`"),
    "fail() endi xatoni boshqa shaklda yozmoqda — o‘qish qoidasi yangilansin",
  );

  for (const stage of Object.keys(PIPELINE_STAGE_LABELS)) {
    const stored = `${stage}: nimadir buzildi`;
    const parsed = splitPipelineError(stored);
    assert.equal(parsed.stage, stage);
    assert.equal(parsed.message, "nimadir buzildi");
  }
});

test("notanish prefiks bosqich deb o‘qilmaydi — butun satr tafsilot bo‘ladi", () => {
  const reason = describeWaitingReason(
    waitingContext({
      pipelineStatus: "failed",
      pipelineError: "Error: connect ETIMEDOUT 10.0.0.1:443",
    }),
    AT,
  );
  assert.match(reason.label, /Texnik xato/);
  assert.ok(!reason.label.includes("Error"), "o‘ylab topilgan bosqich nomi bo‘lmasin");
  assert.equal(reason.detail, "Error: connect ETIMEDOUT 10.0.0.1:443");
});

test("“ishlanmoqda” bilan “qotib qolgan” bir xil aytilmaydi", () => {
  const fresh = describeWaitingReason(
    waitingContext({ pipelineStatus: "running", pipelineStartedAt: minutesBefore(2) }),
    AT,
  );
  assert.equal(fresh.icon, "⏳");
  assert.match(fresh.label, /ishlanmoqda/);

  const stuck = describeWaitingReason(
    waitingContext({
      pipelineStatus: "running",
      pipelineStartedAt: new Date(AT.getTime() - PIPELINE_STALE_AFTER_MS - 60_000).toISOString(),
    }),
    AT,
  );
  assert.equal(stuck.icon, "⚠️");
  assert.match(stuck.label, /Qotib qolgan/);
});

test("qotish chegarasi tiklovchi bilan BIR XIL sonda", () => {
  // Ro'yxat "hammasi joyida" deyayotganda tiklovchi allaqachon uni
  // o'lgan deb bilsa, ikkisi bir-birini yolg'onga chiqaradi.
  const justUnder = new Date(AT.getTime() - PIPELINE_STALE_AFTER_MS + 1_000).toISOString();
  const justOver = new Date(AT.getTime() - PIPELINE_STALE_AFTER_MS - 1_000).toISOString();
  assert.ok(!isStaleRun(justUnder, AT), "sanity: tiklovchi hali o‘lgan demaydi");
  assert.ok(isStaleRun(justOver, AT), "sanity: tiklovchi endi o‘lgan deydi");

  assert.match(
    describeWaitingReason(
      waitingContext({ pipelineStatus: "running", pipelineStartedAt: justUnder }),
      AT,
    ).label,
    /ishlanmoqda/,
  );
  assert.match(
    describeWaitingReason(
      waitingContext({ pipelineStatus: "running", pipelineStartedAt: justOver }),
      AT,
    ).label,
    /Qotib qolgan/,
  );
});

test("navbat vaqti kelmagani bilan kechikkani ajratiladi", () => {
  const soon = describeWaitingReason(
    waitingContext({ pipelineStatus: "pending", processAfter: minutesAfter(40) }),
    AT,
  );
  assert.equal(soon.icon, "⏳");
  assert.match(soon.label, /keyin boshlanadi/);

  // Vaqti o'tib ketgan, lekin hech kim olmagan — cron ishlamayotganining
  // belgisi va bu odamning aybi emas.
  const late = describeWaitingReason(
    waitingContext({ pipelineStatus: "pending", processAfter: minutesBefore(180) }),
    AT,
  );
  assert.equal(late.icon, "⚠️");
  assert.match(late.label, /boshlanmagan/);
});

test("quvur tugagan, lekin odam saytda yo‘q — bu yashirilmaydi", () => {
  const reason = describeWaitingReason(waitingContext({ pipelineStatus: "completed" }), AT);
  assert.equal(reason.icon, "⚠️");
  assert.match(reason.label, /saytda chiqmagan/);
});

test("noma’lum holat o‘ylab topilmaydi — holat nomi o‘zi ko‘rsatiladi", () => {
  const reason = describeWaitingReason(
    waitingContext({ status: "yangi_holat", pipelineStatus: null }),
    AT,
  );
  assert.ok(reason.label.includes("yangi_holat"));

  // Kontekst umuman yo'q bo'lsa ham sabab O'YLAB TOPILMAYDI.
  assert.match(describeWaitingReason(undefined, AT).label, /aniqlanmadi/);
});

test("sabab FAQAT kutayotganlar ro‘yxatida chiqadi", () => {
  const row: CrmListRow = {
    fullName: "Karimov Aziz",
    telegramUsername: "@aziz",
    waiting: waitingContext({ status: "submitted", paymentStatus: "unpaid" }),
  };

  const waiting = buildCrmListText({
    kind: "waiting",
    period: "all",
    rows: [row],
    page: 1,
    total: 1,
  });
  assert.match(waiting, /to‘lov qilmagan/);
  // Sabab ISM BILAN BIR QATORDA emas, uning tagida — ism qidirish
  // uchun ro'yxat ustuni tekis qolishi kerak.
  const lines = waiting.split("\n");
  const nameLine = lines.findIndex((l) => l.startsWith("1. "));
  assert.equal(lines[nameLine], "1. Karimov Aziz");
  assert.ok(lines[nameLine + 2].includes("to‘lov qilmagan"));

  for (const kind of ["published", "filling"] as const) {
    const text = buildCrmListText({ kind, period: "all", rows: [row], page: 1, total: 1 });
    assert.ok(!text.includes("to‘lov qilmagan"), kind);
  }
});

test("uzun texnik xato ham to‘liq sahifani Telegram chegarasida ushlab turadi", () => {
  const long = `render: ${"x".repeat(800)}`;
  const page: CrmListRow[] = Array.from({ length: CRM_LIST_PAGE_SIZE }, (_, i) => ({
    fullName: `Juda Uzun Ismli Nomzod Familiyasi ${i + 1}`,
    telegramUsername: `@nomzod_${i + 1}`,
    waiting: waitingContext({ pipelineStatus: "failed", pipelineError: long }),
  }));

  const text = buildCrmListText({
    kind: "waiting",
    period: "all",
    rows: page,
    page: 1,
    total: 2000,
  });
  assert.ok(text.length < 4096, `sahifa ${text.length} belgi — Telegram 4096 da rad etadi`);
  assert.ok(text.includes("…"), "kesilgani ko‘rinib tursin");
});

test("chegaraga sig‘magan yozuvlar jimgina yo‘qolmaydi", () => {
  // F.I.Sh. erkin matn — uzunligiga hech qanday kafolat yo'q, va
  // sabab qatorlari bilan birga sahifa chegaradan oshib ketishi mumkin.
  const page: CrmListRow[] = Array.from({ length: CRM_LIST_PAGE_SIZE }, (_, i) => ({
    fullName: `Nomzod ${i + 1} ${"Familiyasi".repeat(12)}`,
    telegramUsername: `@nomzod_${i + 1}`,
    waiting: waitingContext({
      pipelineStatus: "failed",
      pipelineError: `render: ${"x".repeat(400)}`,
    }),
  }));

  const text = buildCrmListText({
    kind: "waiting",
    period: "all",
    rows: page,
    page: 1,
    total: 20,
  });

  const shown = text.split("\n").filter((l) => /^\d+\. /.test(l)).length;
  assert.ok(shown < CRM_LIST_PAGE_SIZE, "sanity: bu sahifa haqiqatan sig‘maydi");
  assert.ok(
    text.includes(`yana ${CRM_LIST_PAGE_SIZE - shown} ta`),
    "nechtasi tushib qolgani AYNAN aytilsin",
  );
  // Tushgan yozuv yarim qolmasin: oxirgi ko'rsatilgan odamning
  // username qatori ham joyida bo'lishi kerak.
  assert.ok(text.includes(`@nomzod_${shown}`));
  assert.ok(!text.includes(`${shown + 1}. Nomzod ${shown + 1} `));
  assert.ok(text.length < 4096);
});
