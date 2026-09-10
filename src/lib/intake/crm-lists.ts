import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildCrmListKeyboard,
  buildCrmListText,
  clampCrmPage,
  crmPageCount,
  crmPageOffset,
  crmPeriodRange,
  CRM_LIST_PAGE_SIZE,
  CRM_LIST_STATUSES,
  type CrmInlineButton,
  type CrmListKind,
  type CrmListRow,
  type CrmPeriod,
} from "./crm-list-messages";

/**
 * The bot's three CRM lists, read LIVE from Supabase on every press.
 *
 * The exact intake statuses behind each list — and why each one belongs there —
 * are documented and asserted next to CRM_LIST_STATUSES in
 * crm-list-messages.ts. This module only turns those sets into queries.
 *
 * Soft-deleted intakes (`deleted_at`) are excluded everywhere, as they are in
 * every other count in this codebase.
 */

export interface CrmListPage {
  text: string;
  keyboard: CrmInlineButton[][];
  page: number;
  pageCount: number;
  total: number;
  period: CrmPeriod;
}

/**
 * One page of rows plus the exact total.
 *
 * `count: "exact"` with `.range(...)` is what keeps a 2000-row list off the
 * wire: only the twenty rows being shown are fetched, and the header's total
 * comes from the database's own count rather than from the fetched length.
 *
 * The select carries full_name and telegram_username ONLY — phone_e164 is not
 * requested, so a phone number cannot reach a chat even by accident.
 */
/**
 * Har ro'yxatning O'Z sanasi bor.
 *
 * Kesim aynan ro'yxat saralanadigan ustun bo'yicha olinadi — aks holda
 * "bugun chop etilganlar" ro'yxati bugun YARATILGANLARNI ko'rsatib,
 * ikkisi bir-biriga umuman mos kelmasdi.
 */
const CRM_LIST_DATE_COLUMN: Record<CrmListKind, string> = {
  published: "published_at",
  waiting: "submitted_at",
  filling: "created_at",
};

/**
 * Har ro'yxat O'ZIGA kerak bo'lgan ustunlarni so'raydi.
 *
 * "Kutayotganlar" uchun sabab ustunlari ham kerak — ular ro'yxatda har
 * ismning tagida chiqadi. Boshqa ikkitasida bu savolning ma'nosi yo'q,
 * shuning uchun ular so'ralmaydi.
 *
 * Ikkalasida ham `phone_e164` YO'Q: ro'yxatlar chatga boradi, chatlar
 * uzatiladi, telefon raqami esa bu jadvaldagi yagona qaytarib
 * bo'lmaydigan maydon.
 */
const CRM_LIST_COLUMNS: Record<CrmListKind, string> = {
  published: "full_name, telegram_username",
  waiting:
    "full_name, telegram_username, status, payment_status, post_pipeline_status, " +
    "post_pipeline_error, post_pipeline_started_at, post_pipeline_process_after",
  filling: "full_name, telegram_username",
};

/** Kesim shartini so'rovga qo'yadi. */
function applyPeriod<T extends {
  gte: (column: string, value: string) => T;
  lt: (column: string, value: string) => T;
  or: (filter: string) => T;
}>(query: T, kind: CrmListKind, period: CrmPeriod, now: Date): T {
  const range = crmPeriodRange(period, now);
  const column = CRM_LIST_DATE_COLUMN[kind];

  if (range.startIso === null && range.endIso === null) return query;

  if (range.startIso !== null && range.endIso !== null) {
    return query.gte(column, range.startIso).lt(column, range.endIso);
  }

  // "Undan avval": sanasi yo'q yozuvlar ham shu yerga tushadi, aks
  // holda ular hech qaysi kesimda ko'rinmay, jimgina yo'qolib qolardi.
  if (range.endIso !== null) {
    return range.includeNull
      ? query.or(`${column}.lt.${range.endIso},${column}.is.null`)
      : query.lt(column, range.endIso);
  }
  return query.gte(column, range.startIso!);
}

async function fetchRows(
  kind: CrmListKind,
  period: CrmPeriod,
  page: number,
  now: Date = new Date(),
): Promise<{ rows: CrmListRow[]; total: number; page: number; pageCount: number }> {
  const db = createSupabaseAdminClient();

  /*
   * SAYTNING javobi so'raladi, anketa holatiniki emas.
   *
   * Ilgari ro'yxat `candidate_intakes.status` ga qarardi — bu anketa
   * hujjatining holati, saytning holati emas. Ikkalasi ajralib
   * qolganda (uzilgan yugurish, yoki nomzod anketadan tashqari yo'l
   * bilan chop etilgani) bot allaqachon chiqib bo'lgan odamlarni
   * "kutayapti" deb ko'rsatardi.
   *
   * `candidate_intake_crm` ko'rinishidagi `article_live` har so'rovda
   * jonli hisoblanadi, ya'ni u eskirib qola olmaydi.
   */
  const base = () =>
    applyPeriod(
      db
        .from("candidate_intake_crm")
        .select(CRM_LIST_COLUMNS[kind], { count: "exact" })
        .is("deleted_at", null),
      kind,
      period,
      now,
    );

  // Two round trips at most: the first learns the real total so a stale page
  // number from an old message can be clamped instead of returning nothing.
  const countQuery = (() => {
    switch (kind) {
      case "published":
        // "Chop etilgan" = SAYTDA turgan. Anketa holati emas.
        return base().eq("article_live", true);
      case "waiting":
        // "Kutayotgan" = anketani yuborgan, lekin hali saytda YO'Q.
        return base()
          .eq("article_live", false)
          .in("status", CRM_LIST_STATUSES.waiting)
          .not("submitted_at", "is", null);
      case "filling":
        return base().eq("status", "draft");
    }
  })();

  const { count } = await countQuery.range(0, 0);
  const total = count ?? 0;
  const pageCount = crmPageCount(total, CRM_LIST_PAGE_SIZE);
  const safePage = clampCrmPage(page, pageCount);

  if (total === 0) return { rows: [], total, page: safePage, pageCount };

  const offset = crmPageOffset(safePage, CRM_LIST_PAGE_SIZE);
  const ordered = (() => {
    switch (kind) {
      case "published":
        // Newest publication first — that is the order an editor scans for.
        return base()
          .eq("article_live", true)
          .order("published_at", { ascending: false, nullsFirst: false });
      case "waiting":
        // Oldest submission first: the person who has waited longest is on top.
        return base()
          .eq("article_live", false)
          .in("status", CRM_LIST_STATUSES.waiting)
          .not("submitted_at", "is", null)
          .order("submitted_at", { ascending: true });
      case "filling":
        return base().eq("status", "draft").order("created_at", { ascending: false });
    }
  })();

  const { data, error } = await ordered.range(offset, offset + CRM_LIST_PAGE_SIZE - 1);
  if (error) {
    console.error(`[crm-list] ${kind} query failed`, error.message);
    return { rows: [], total, page: safePage, pageCount };
  }

  /*
   * Ustunlar ro'yxati ro'yxat turiga qarab tanlanadi, ya'ni u literal
   * emas — PostgREST tiplari esa aynan literal matndan qator shaklini
   * chiqaradi. Shu sababli qator bu yerda oddiy xarita sifatida
   * o'qiladi; qaysi kalitlar borligini yuqoridagi CRM_LIST_COLUMNS
   * belgilaydi va yo'q kalit `null` bo'lib keladi.
   */
  const raw = (data ?? []) as unknown as Record<string, unknown>[];

  const rows: CrmListRow[] = raw.map((row) => ({
    fullName: (row.full_name as string) ?? "",
    telegramUsername: (row.telegram_username as string | null) ?? null,
    // Sabab konteksti faqat "kutayotganlar" so'rovida so'raladi;
    // qolganlarida bu maydon berilmaydi va matn uni so'ramaydi ham.
    waiting:
      kind === "waiting"
        ? {
            status: (row.status as string) ?? "",
            paymentStatus: (row.payment_status as string | null) ?? null,
            pipelineStatus: (row.post_pipeline_status as string | null) ?? null,
            pipelineError: (row.post_pipeline_error as string | null) ?? null,
            pipelineStartedAt: (row.post_pipeline_started_at as string | null) ?? null,
            processAfter: (row.post_pipeline_process_after as string | null) ?? null,
          }
        : undefined,
  }));

  return { rows, total, page: safePage, pageCount };
}

/** Rendered page, ready to send or to edit an existing message into. */
export async function buildCrmListPage(
  kind: CrmListKind,
  page: number,
  period: CrmPeriod = "today",
): Promise<CrmListPage> {
  const { rows, total, page: safePage, pageCount } = await fetchRows(kind, period, page);
  return {
    text: buildCrmListText({ kind, period, rows, page: safePage, total }),
    keyboard: buildCrmListKeyboard(kind, period, safePage, pageCount),
    page: safePage,
    pageCount,
    total,
    period,
  };
}

export {
  CRM_LIST_BY_BUTTON,
  CRM_LIST_BY_COMMAND,
  CRM_LIST_STATUSES,
  FILLING_BUTTON_LABEL,
  parseCrmListCallback,
  PUBLISHED_BUTTON_LABEL,
  WAITING_BUTTON_LABEL,
} from "./crm-list-messages";
export type { CrmListKind, CrmPeriod } from "./crm-list-messages";
