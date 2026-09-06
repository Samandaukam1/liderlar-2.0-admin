/**
 * Bot CRM ro'yxatlari — sof modul (matn, tugmalar, callback_data).
 *
 * I/O yo'q, shuning uchun sahifalash arifmetikasi, callback formati va
 * "telefon raqam KO'RSATILMAYDI" qoidasi haqiqiy unit testlar bilan qoplanadi.
 * Xabarlar ATAYLAB oddiy matn: MarkdownV2 bo'lganda ismdagi bitta nuqta yoki
 * username ichidagi pastki chiziq butun yuborishni 400 bilan yiqitadi.
 */

/** The three CRM buttons added to the editorial /start keyboard. */
export const PUBLISHED_BUTTON_LABEL = "📚 Hozirgacha chop etilganlar";
export const WAITING_BUTTON_LABEL = "⏳ Kutayotganlar";
export const FILLING_BUTTON_LABEL = "✍️ To‘ldirayotganlar";

export type CrmListKind = "published" | "waiting" | "filling";

/**
 * EXACT intake statuses behind each list, from 0010_candidate_intake_v2.sql:
 *
 *   status in ('draft','submitted','ai_reviewing','needs_clarification',
 *              'approved','promoted','published','archived')
 *
 *   • published — 'published'. Stamped by promote_candidate_intake(p_publish
 *     => true), the same call that publishes the candidate and the article.
 *     The real "live on the site" state, not "a post exists".
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
  waiting: "Anketani yuborgan, hali chop etilmagan nomzodlar.",
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

export function crmListCallbackData(kind: CrmListKind, page: number): string {
  return `${CALLBACK_PREFIX}${KIND_CODE[kind]}:${Math.max(1, Math.floor(page))}`;
}

export interface ParsedCrmListCallback {
  kind: CrmListKind;
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
  const [, code, rawPage] = data.split(":");
  const kind = CODE_KIND[code ?? ""];
  if (!kind) return null;
  if (!/^\d+$/.test(rawPage ?? "")) return null;
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1) return null;
  return { kind, page };
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
  ];

  if (input.total === 0 || input.rows.length === 0) {
    return [...header, "", "Hozircha bo‘sh."].join("\n");
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
  page: number,
  pageCount: number,
): CrmInlineButton[][] {
  if (pageCount <= 1) return [];
  const row: CrmInlineButton[] = [];
  if (page > 1) {
    row.push({ text: "◀️ Oldingi", callback_data: crmListCallbackData(kind, page - 1) });
  }
  if (page < pageCount) {
    row.push({ text: "Keyingi ▶️", callback_data: crmListCallbackData(kind, page + 1) });
  }
  return row.length > 0 ? [row] : [];
}
