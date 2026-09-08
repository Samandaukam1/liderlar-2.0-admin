import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { blacklistKey } from "./name-key";
import {
  findSimilarBlacklisted,
  type BlacklistCandidate,
  type BlacklistMatch,
} from "./blacklist-match";

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

/**
 * Kalit bo'yicha olib tashlash.
 *
 * Bot tugmasi aynan shundan foydalanadi: callback ichida ism emas,
 * KALIT yuboriladi. Ism yuborilsa, uzun F.I.Sh. Telegram'ning 64
 * baytlik chegarasiga sig'may qolardi va kesilgan matn boshqa odamni
 * ro'yxatdan chiqarib yuborishi mumkin edi.
 */
export async function removeFromBlacklistBySlug(nameSlug: string): Promise<void> {
  if (!nameSlug.trim()) return;
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("intake_blacklist")
    .delete()
    .eq("name_slug", nameSlug)
    .select("full_name");

  await logAudit({
    actorId: null,
    action: "intake.blacklist_removed",
    entityType: "candidate_intake",
    entityId: null,
    severity: "warning",
    metadata: { nameSlug, fullName: (data?.[0]?.full_name as string) ?? null },
  });
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

/**
 * Ro'yxatning boshi — o'xshash ism qidirish uchun.
 *
 * NEGA HAMMASI O'QILADI: o'xshashlik tahrir masofasiga tayanadi va uni
 * SQL `ilike` bilan ifodalab bo'lmaydi — "Ravshanava" hech qanday
 * `%ravshanova%` shabloniga tushmaydi. Ro'yxat shartnomasi buzilganlar
 * ro'yxati, ya'ni o'nlab yozuv; chegara esa xotira portlab ketmasligi
 * uchun ataylab qo'yilgan va u yetganda log'ga yoziladi.
 */
export const BLACKLIST_SCAN_LIMIT = 1000;

export async function listBlacklistEntries(
  limit = BLACKLIST_SCAN_LIMIT,
): Promise<BlacklistCandidate[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("intake_blacklist")
    .select("name_slug, full_name, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[blacklist] list failed", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length >= limit) {
    console.warn(`[blacklist] scan limit reached (${limit}) — o‘xshash qidiruv to‘liq emas`);
  }
  return rows.map((row) => ({
    nameSlug: row.name_slug as string,
    fullName: row.full_name as string,
    reason: (row.reason as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/** Shu ismga aniq va o'xshash mos keladigan yozuvlar. */
export async function findSimilarInBlacklist(fullName: string): Promise<BlacklistMatch[]> {
  const entries = await listBlacklistEntries();
  return findSimilarBlacklisted(fullName, entries);
}
