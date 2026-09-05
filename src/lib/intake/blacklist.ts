import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { blacklistKey } from "./name-key";

/**
 * Qora ro'yxat — shartnomasi buzilgan nomzodlar.
 *
 * Kalit sifatida ism normallashtirilgan ko'rinishi ishlatiladi, anketa ID
 * emas. Odam qayta anketa to'ldirsa yangi qator va yangi ID paydo bo'ladi,
 * ism esa o'sha-o'sha — shuning uchun ro'yxat uni butunlay yangi anketa bilan
 * qaytib kelganda ham tanib oladi. Kalit qanday hisoblanishi blacklistKey()
 * da izohlangan.
 */

export interface BlacklistEntry {
  nameSlug: string;
  fullName: string;
  reason: string | null;
  createdAt: string;
}

export const BLACKLIST_REASON_CONTRACT = "Shartnoma buzildi";

export { blacklistKey };

/** Adds a candidate, keyed by their name. Repeating it is a no-op. */
export async function addToBlacklist(input: {
  fullName: string;
  intakeId: string | null;
  reason?: string;
  chatId: number | null;
}): Promise<{ ok: boolean; alreadyListed: boolean; nameSlug: string }> {
  const nameSlug = blacklistKey(input.fullName);
  if (!nameSlug) return { ok: false, alreadyListed: false, nameSlug: "" };

  const db = createSupabaseAdminClient();
  const existing = await isBlacklisted(input.fullName);

  const { error } = await db.from("intake_blacklist").upsert(
    {
      name_slug: nameSlug,
      full_name: input.fullName,
      intake_id: input.intakeId,
      reason: input.reason ?? BLACKLIST_REASON_CONTRACT,
      created_by_chat_id: input.chatId,
    },
    { onConflict: "name_slug" },
  );
  if (error) {
    console.error("[blacklist] write failed", error.message);
    return { ok: false, alreadyListed: Boolean(existing), nameSlug };
  }

  await logAudit({
    actorId: null,
    action: "intake.blacklisted",
    entityType: "candidate_intake",
    entityId: input.intakeId,
    severity: "warning",
    metadata: { fullName: input.fullName, nameSlug, reason: input.reason ?? BLACKLIST_REASON_CONTRACT },
  });

  return { ok: true, alreadyListed: Boolean(existing), nameSlug };
}

/** The entry for this name, if the person is listed. */
export async function isBlacklisted(fullName: string): Promise<BlacklistEntry | null> {
  const nameSlug = blacklistKey(fullName);
  if (!nameSlug) return null;

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("intake_blacklist")
    .select("name_slug, full_name, reason, created_at")
    .eq("name_slug", nameSlug)
    .maybeSingle();

  if (error) {
    // Fail loud but OPEN: a lookup failure must not quietly block a legitimate
    // candidate, so the reason reaches the logs and the caller sees "not listed".
    console.error("[blacklist] lookup failed", error.message);
    return null;
  }
  if (!data) return null;
  return {
    nameSlug: data.name_slug as string,
    fullName: data.full_name as string,
    reason: (data.reason as string | null) ?? null,
    createdAt: data.created_at as string,
  };
}

/**
 * Which of these names are listed.
 *
 * One query for a whole board, so rendering the day's queue does not turn into
 * a lookup per row.
 */
export async function findBlacklistedSlugs(fullNames: readonly string[]): Promise<Set<string>> {
  const slugs = [...new Set(fullNames.map(blacklistKey))].filter(Boolean);
  if (slugs.length === 0) return new Set();

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("intake_blacklist")
    .select("name_slug")
    .in("name_slug", slugs);

  if (error) {
    console.error("[blacklist] bulk lookup failed", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.name_slug as string));
}

export async function removeFromBlacklist(fullName: string): Promise<void> {
  const nameSlug = blacklistKey(fullName);
  if (!nameSlug) return;
  const db = createSupabaseAdminClient();
  await db.from("intake_blacklist").delete().eq("name_slug", nameSlug);
  await logAudit({
    actorId: null,
    action: "intake.blacklist_removed",
    entityType: "candidate_intake",
    entityId: null,
    severity: "warning",
    metadata: { fullName, nameSlug },
  });
}
