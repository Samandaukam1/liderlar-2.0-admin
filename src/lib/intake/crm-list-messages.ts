/**
 * Bot CRM ro'yxatlari — sof modul (matn, tugmalar, callback_data).
 *
 * I/O yo'q, shuning uchun sahifalash arifmetikasi, callback formati va
 * "telefon raqam KO'RSATILMAYDI" qoidasi haqiqiy unit testlar bilan qoplanadi.
 * Xabarlar ATAYLAB oddiy matn: MarkdownV2 bo'lganda ismdagi bitta nuqta yoki
 * username ichidagi pastki chiziq butun yuborishni 400 bilan yiqitadi.
 */

// Nisbiy yo'l: bu modulni node:test to'g'ridan-to'g'ri yuklaydi va u
// tsconfig alias'larini bilmaydi.
import {
  shiftCalendarDate,
  tashkentDayRange,
  tashkentDayRangeForDate,
} from "../tashkent-day.ts";

/** The three CRM buttons added to the editorial /start keyboard. */
export const PUBLISHED_BUTTON_LABEL = "📚 Hozirgacha chop etilganlar";
export const WAITING_BUTTON_LABEL = "⏳ Kutayotganlar";
export const FILLING_BUTTON_LABEL = "✍️ To‘ldirayotganlar";

export type CrmListKind = "published" | "waiting" | "filling";

/**
 * Ro'yxat qaysi kun bo'yicha ko'rsatiladi.
 *
 * Standart — BUGUN. Ilgari har bosishda butun ro'yxat kelardi va ikki
 * mingta yozuv ichidan bugungisini topish uchun sahifalarni varaqlash
 * kerak bo'lardi. Muharrirga eng ko'p kerak bo'ladigan kesim — bugun.
 *
 * To'rt davr butun to'plamni QOLDIRIQSIZ bo'ladi: bugun + kecha +
 * undan avval = hammasi. Sanasi yo'q yozuvlar "undan avval" ga
 * qo'shiladi, aks holda ular hech qaysi kesimda ko'rinmay, jimgina
 * yo'qolib qolardi.
 */
export const CRM_PERIODS = ["today", "yesterday", "earlier", "all"] as const;
export type CrmPeriod = (typeof CRM_PERIODS)[number];

export const CRM_PERIOD_LABELS: Record<CrmPeriod, string> = {
  today: "Bugun",
  yesterday: "Kecha",
  earlier: "Undan avval",
  all: "Hammasi",
};

export function isCrmPeriod(value: unknown): value is CrmPeriod {
  return typeof value === "string" && (CRM_PERIODS as readonly string[]).includes(value);
}

/**
 * Davr chegaralari — Toshkent kunlari bo'yicha.
 *
 * `endIso` DOIM eksklyuziv (`.gte(start).lt(end)`), shuning uchun
 * yarim tunda muhrlangan yozuv faqat bitta kunga tegishli bo'ladi.
 * `earlier` uchun faqat yuqori chegara bor.
 */
export interface CrmPeriodRange {
  startIso: string | null;
  endIso: string | null;
  /** Sanasi yo'q yozuvlar ham shu kesimga kiradimi. */
  includeNull: boolean;
}

export function crmPeriodRange(period: CrmPeriod, now: Date = new Date()): CrmPeriodRange {
  if (period === "all") return { startIso: null, endIso: null, includeNull: true };

  const today = tashkentDayRange(now);
  const yesterday = tashkentDayRangeForDate(shiftCalendarDate(today.date, -1));

  if (period === "today") {
    return { startIso: today.startIso, endIso: today.endIso, includeNull: false };
  }
  if (period === "yesterday") {
    return { startIso: yesterday.startIso, endIso: yesterday.endIso, includeNull: false };
  }
  // "Undan avval" — kechadan oldingi hammasi, sanasizlar bilan birga.
  return { startIso: null, endIso: yesterday.startIso, includeNull: true };
}

/**
 * EXACT intake statuses behind each list, from 0010_candidate_intake_v2.sql:
 *
 *   status in ('draft','submitted','ai_reviewing','needs_clarification',
 *              'approved','promoted','published','archived')
 *
 * MUHIM O'ZGARISH: "chop etilgan" va "kutayotgan" endi anketa holatiga
 * EMAS, saytning o'ziga qaraydi (`candidate_intake_crm.article_live`).
 * Anketa holati hujjatning holati — u saytdan ajralib qolishi mumkin
 * va ajralganda bot allaqachon chiqib bo'lgan odamni "kutayapti" deb
 * ko'rsatardi. `CRM_LIST_STATUSES.waiting` esa hamon kerak: u
 * "yuborilgan, lekin tashlab yuborilmagan" doirasini belgilaydi.
 *
 *   • published — endi `article_live`, ya'ni saytda turgan nomzod.
 *     `CRM_LIST_STATUSES.published` faqat tarixiy ma'lumot uchun
 *     qoldirilgan va so'rovda ISHLATILMAYDI.
 *   • waiting   — every status between draft and published: the candidate
 *     submitted and is not live yet. 'ai_reviewing' and 'needs_clarification'
 *     are in, because from the editorial side those people are still waiting;
 *     'archived' is out, because that intake was abandoned, not queued.
 *   • filling   — 'draft'. The form exists and submit_candidate_intake(...)
 *     has not run. The same set the /hisobot report counts as
 *     "✍️ To'ldirmoqda", so a button and the report can never disagree.
 *
 * Kept here, in the pure module, so the semantics are asserted by a real test
 * rather than living only inside a query builder.
 */
export const CRM_LIST_STATUSES: Record<CrmListKind, readonly string[]> = {
  published: ["published"],
  waiting: ["submitted", "ai_reviewing", "needs_clarification", "approved", "promoted"],
  filling: ["draft"],
};

/**
 * How many rows one message carries.
 *
 * Telegram caps a message at 4096 characters and there are thousands of
 * intakes: one un-paged list would either be rejected outright or arrive as an
 * unreadable wall. Twenty name+handle pairs sit comfortably under the cap.
 */
export const CRM_LIST_PAGE_SIZE = 20;

export const CRM_LIST_TITLES: Record<CrmListKind, string> = {
  published: "📚 HOZIRGACHA CHOP ETILGANLAR",
  waiting: "⏳ KUTAYOTGANLAR",
  filling: "✍️ TO‘LDIRAYOTGANLAR",
};

/** One line under each title, so the reader knows what the list actually is. */
export const CRM_LIST_SUBTITLES: Record<CrmListKind, string> = {
  published: "Saytda maqolasi chop etilgan nomzodlar.",
  waiting: "Anketani yuborgan, maqolasi hali saytda yo‘q nomzodlar.",
  filling: "Anketani boshlagan, hali yubormagan nomzodlar.",
};

/** A pressed reply-keyboard button arrives as an ordinary message with its label. */
export const CRM_LIST_BY_BUTTON: Record<string, CrmListKind> = {
  [PUBLISHED_BUTTON_LABEL]: "published",
  [WAITING_BUTTON_LABEL]: "waiting",
  [FILLING_BUTTON_LABEL]: "filling",
};

/** Every list is also reachable as a typed command, like the other actions. */
export const CRM_LIST_BY_COMMAND: Record<string, CrmListKind> = {
  "/chopetilganlar": "published",
  "/kutayotganlar": "waiting",
  "/toldirayotganlar": "filling",
};

/**
 * Callback payload.
 *
 * Telegram caps callback_data at 64 BYTES. "crm:p:12" is eight, which leaves
 * the format room to grow without ever approaching the limit.
 */
const CALLBACK_PREFIX = "crm:";

const KIND_CODE: Record<CrmListKind, string> = {
  published: "p",
  waiting: "w",
  filling: "f",
};

const CODE_KIND: Record<string, CrmListKind> = {
  p: "published",
  w: "waiting",
  f: "filling",
};

const PERIOD_CODE: Record<CrmPeriod, string> = {
  today: "t",
  yesterday: "y",
  earlier: "e",
  all: "a",
};

const CODE_PERIOD: Record<string, CrmPeriod> = {
  t: "today",
  y: "yesterday",
  e: "earlier",
  a: "all",
};

export function crmListCallbackData(
  kind: CrmListKind,
  period: CrmPeriod,
  page: number,
): string {
  return `${CALLBACK_PREFIX}${KIND_CODE[kind]}:${PERIOD_CODE[period]}:${Math.max(1, Math.floor(page))}`;
}

export interface ParsedCrmListCallback {
  kind: CrmListKind;
  period: CrmPeriod;
  page: number;
}

/**
 * Reads a tapped pagination button back into a list and a page.
 *
 * Anything that is not ours — another feature's button, a truncated payload, a
 * page that is not a positive integer — returns null so the caller ignores it
 * instead of querying for page NaN.
 */
export function parseCrmListCallback(
  data: string | undefined | null,
): ParsedCrmListCallback | null {
  if (!data || !data.startsWith(CALLBACK_PREFIX)) return null;
  const parts = data.split(":");

  // Eski uch bo'lakli shakl ("crm:p:2") hali chatlarda osilib turgan
  // xabarlarda uchraydi. O'shanda davr tushunchasi yo'q edi va tugma
  // BUTUN ro'yxatni bildirardi — shuning uchun u "hammasi" deb
  // o'qiladi, "bugun" deb emas: aks holda eski tugma bosilganda
  // ro'yxat jimgina qisqarib qolardi.
  const [, code, third, fourth] = parts;
  const kind = CODE_KIND[code ?? ""];
  if (!kind) return null;

  const hasPeriod = parts.length >= 4;
  const period = hasPeriod ? CODE_PERIOD[third ?? ""] : "all";
  if (!period) return null;

  const rawPage = hasPeriod ? fourth : third;
  if (!/^\d+$/.test(rawPage ?? "")) return null;
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1) return null;
  return { kind, period, page };
}

/** Total pages for a row count, never less than one (an empty list has page 1). */
export function crmPageCount(total: number, pageSize = CRM_LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** Clamps a requested page into the list's real range. */
export function clampCrmPage(page: number, pageCount: number): number {
  if (!Number.isSafeInteger(page)) return 1;
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}

/** Zero-based index of the first row on a page — the query's offset. */
export function crmPageOffset(page: number, pageSize = CRM_LIST_PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * pageSize;
}

export interface CrmListRow {
  fullName: string;
  /** Stored canonically as "@name"; null when the candidate never gave one. */
  telegramUsername: string | null;
}

export interface CrmListPageInput {
  kind: CrmListKind;
  period: CrmPeriod;
  rows: CrmListRow[];
  page: number;
  total: number;
  pageSize?: number;
}

/**
 * One page of a list.
 *
 * Deliberately carries F.I.Sh. and the Telegram handle ONLY. Phone numbers are
 * never rendered here: the lists go to a chat, chats get forwarded, and a phone
 * number is the one field in this table that cannot be un-leaked.
 */
export function buildCrmListText(input: CrmListPageInput): string {
  const pageSize = input.pageSize ?? CRM_LIST_PAGE_SIZE;
  const pageCount = crmPageCount(input.total, pageSize);
  const page = clampCrmPage(input.page, pageCount);
  const offset = crmPageOffset(page, pageSize);

  const header = [
    `${CRM_LIST_TITLES[input.kind]} — ${input.total} ta`,
    CRM_LIST_SUBTITLES[input.kind],
    // Qaysi kesim ko'rsatilayotgani DOIM yoziladi: "12 ta" degan son
    // qaysi kunga tegishli ekani aytilmasa, chalg'itadi.
    `🗓 ${CRM_PERIOD_LABELS[input.period]}`,
  ];

  if (input.total === 0 || input.rows.length === 0) {
    return [...header, "", "Bu kesimda hech kim yo‘q."].join("\n");
  }

  const lines = input.rows.flatMap((row, index) => {
    const name = row.fullName.trim() || "(ismi yo‘q)";
    const handle = normalizeHandleForDisplay(row.telegramUsername);
    return [`${offset + index + 1}. ${name}`, `   ${handle}`];
  });

  return [...header, `Sahifa ${page}/${pageCount}`, "", ...lines].join("\n");
}

/** "@name" whether it was stored with the "@" or without; "—" when absent. */
function normalizeHandleForDisplay(raw: string | null): string {
  const value = (raw ?? "").trim().replace(/^@+/, "");
  return value ? `@${value}` : "—";
}

/** Structural shape of telegram-api's InlineButton, without importing it. */
export interface CrmInlineButton {
  text: string;
  callback_data: string;
}

/**
 * Prev/next row, or nothing at all on a single-page list.
 *
 * The page number lives in the text rather than in a third button: every inline
 * button needs its own callback_data, and a button that answers nothing is a
 * button people tap expecting something to happen.
 */
export function buildCrmListKeyboard(
  kind: CrmListKind,
  period: CrmPeriod,
  page: number,
  pageCount: number,
): CrmInlineButton[][] {
  const rows: CrmInlineButton[][] = [];

  // Davr tugmalari DOIM ko'rinadi — bitta sahifali ro'yxatda ham,
  // chunki ular sahifalash emas, kesim tanlash. Aktiv kesim belgi
  // bilan ajratiladi, aks holda qaysi ro'yxat ochiqligi bilinmaydi.
  const periodButton = (value: CrmPeriod): CrmInlineButton => ({
    text: value === period ? `▪️ ${CRM_PERIOD_LABELS[value]}` : CRM_PERIOD_LABELS[value],
    // Kesim almashganda sahifa 1 dan boshlanadi: 5-sahifada turib
    // "Bugun" bosilsa, u yerda 5-sahifa bo'lmasligi mumkin.
    callback_data: crmListCallbackData(kind, value, 1),
  });

  rows.push([periodButton("today"), periodButton("yesterday")]);
  rows.push([periodButton("earlier"), periodButton("all")]);

  if (pageCount > 1) {
    const row: CrmInlineButton[] = [];
    if (page > 1) {
      row.push({
        text: "◀️ Oldingi",
        callback_data: crmListCallbackData(kind, period, page - 1),
      });
    }
    if (page < pageCount) {
      row.push({
        text: "Keyingi ▶️",
        callback_data: crmListCallbackData(kind, period, page + 1),
      });
    }
    if (row.length > 0) rows.push(row);
  }

  return rows;
}
