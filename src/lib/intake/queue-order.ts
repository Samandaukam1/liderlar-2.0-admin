/**
 * Navbat tartibi va tanlov qoidalari — sof modul.
 *
 * Batch nimani va QAYSI TARTIBDA ishlashi mahsulot talabining o'zagi, shuning
 * uchun u DB so'roviga emas, shu yerdagi funksiyalarga tayanadi: ular haqiqiy
 * unit testlar bilan qoplanadi va SQL `order by` tasodifan o'zgarsa ham
 * tartib buzilmaydi.
 */

export interface OrderableIntake {
  id: string;
  submittedAt: string | null;
  status: string;
  paymentStatus: string;
  /**
   * Set when someone of this name is already published on the site. Such a
   * candidate is never re-processed — a second run would rewrite their article
   * and post them again as if they were new.
   */
  alreadyPublished?: { candidateId: string; slug: string } | null;
  /**
   * Published on the site, but their post never made it out. These are repairs:
   * the article stands, only the post half of the run has to be redone.
   */
  postPending?: boolean;
}

/**
 * Earliest submission first.
 *
 * Whoever sent their form first is published first — that is the promise the
 * board makes, and it must not depend on the order rows came back in. Ties and
 * missing timestamps fall back to the id so the sort is total and stable: an
 * unstable order would shuffle the queue between two renders of the same list.
 */
export function sortBySubmittedAt<T extends OrderableIntake>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const at = a.submittedAt ? Date.parse(a.submittedAt) : Number.NaN;
    const bt = b.submittedAt ? Date.parse(b.submittedAt) : Number.NaN;
    const aValid = Number.isFinite(at);
    const bValid = Number.isFinite(bt);
    // A row with no submission time cannot claim a place in a queue ordered by
    // submission time, so it goes last rather than silently first.
    if (!aValid && !bValid) return a.id.localeCompare(b.id);
    if (!aValid) return 1;
    if (!bValid) return -1;
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
}

/** Statuses a publish run can still move forward. */
export const PROCESSABLE_STATUSES = ["submitted", "approved", "promoted"] as const;

/**
 * What a batch may actually queue.
 *
 * Four rules, all of them deliberate:
 *
 *  - payment must be CONFIRMED. `unknown` is not `unpaid`, but neither is it
 *    permission to publish — an unanswered question means nobody has said yes.
 *  - `published` candidates are already done and are never re-run.
 *  - neither is anyone already on the site under the same name, even from an
 *    earlier intake: re-running them would rewrite a live article and post the
 *    same person a second time.
 *  - selection, when present, only ever narrows. It cannot reorder: the result
 *    comes back in submission order no matter which order the boxes were
 *    ticked in.
 */
export function selectEligibleForBatch<T extends OrderableIntake>(
  rows: readonly T[],
  selectedIds: readonly string[] | null,
): T[] {
  const selected = selectedIds ? new Set(selectedIds) : null;
  const processable = new Set<string>(PROCESSABLE_STATUSES);
  const eligible = rows.filter(
    (row) =>
      (!selected || selected.has(row.id)) &&
      row.paymentStatus === "paid" &&
      !row.alreadyPublished &&
      // Either there is still a publication to do, or the publication is done
      // and only the post is outstanding.
      (processable.has(row.status) || row.postPending === true),
  );

  // Repairs run first, and only then the new work.
  //
  // Someone published this morning whose post never went out is already
  // half-delivered: they are on the site with nothing announcing them. Finishing
  // them costs one post each, while a fresh candidate costs the whole chain — so
  // putting repairs behind the queue would leave the visible gap open longest.
  const repairs = eligible.filter((row) => row.postPending === true);
  const fresh = eligible.filter((row) => row.postPending !== true);
  return [...sortBySubmittedAt(repairs), ...sortBySubmittedAt(fresh)];
}

export type PaymentClassification = "paid" | "unpaid" | "unknown";

/**
 * Reads a stored payment status.
 *
 * Anything that is not an explicit yes or no is `unknown`. Collapsing that into
 * `unpaid` is the one mistake this feature cannot make: it would put a
 * candidate nobody has ruled on into the "did not pay" list.
 */
export function classifyPayment(raw: string | null | undefined): PaymentClassification {
  if (raw === "paid") return "paid";
  if (raw === "unpaid") return "unpaid";
  return "unknown";
}
