import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildCrmListKeyboard,
  buildCrmListText,
  clampCrmPage,
  crmPageCount,
  crmPageOffset,
  CRM_LIST_PAGE_SIZE,
  CRM_LIST_STATUSES,
  type CrmInlineButton,
  type CrmListKind,
  type CrmListRow,
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
async function fetchRows(
  kind: CrmListKind,
  page: number,
): Promise<{ rows: CrmListRow[]; total: number; page: number; pageCount: number }> {
  const db = createSupabaseAdminClient();

  const base = () =>
    db
      .from("candidate_intakes")
      .select("full_name, telegram_username", { count: "exact" })
      .is("deleted_at", null);

  // Two round trips at most: the first learns the real total so a stale page
  // number from an old message can be clamped instead of returning nothing.
  const countQuery = (() => {
    switch (kind) {
      case "published":
        return base().eq("status", "published");
      case "waiting":
        return base().in("status", CRM_LIST_STATUSES.waiting).not("submitted_at", "is", null);
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
          .eq("status", "published")
          .order("published_at", { ascending: false, nullsFirst: false });
      case "waiting":
        // Oldest submission first: the person who has waited longest is on top.
        return base()
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

  const rows: CrmListRow[] = (data ?? []).map((row) => ({
    fullName: (row.full_name as string) ?? "",
    telegramUsername: (row.telegram_username as string | null) ?? null,
  }));

  return { rows, total, page: safePage, pageCount };
}

/** Rendered page, ready to send or to edit an existing message into. */
export async function buildCrmListPage(
  kind: CrmListKind,
  page: number,
): Promise<CrmListPage> {
  const { rows, total, page: safePage, pageCount } = await fetchRows(kind, page);
  return {
    text: buildCrmListText({ kind, rows, page: safePage, total }),
    keyboard: buildCrmListKeyboard(kind, safePage, pageCount),
    page: safePage,
    pageCount,
    total,
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
export type { CrmListKind } from "./crm-list-messages";
