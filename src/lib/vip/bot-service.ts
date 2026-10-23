import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getSiteUrl } from "@/lib/site-url";
import { candidateArticlePath } from "@/lib/public-site";
import { resolvePublicWebUrl } from "@/lib/post-studio/site-origin";
import { createActivation, revokeActivation } from "@/lib/accounts/activation-service";
import { activationUrl } from "@/lib/accounts/activation-token";
import { grantVipDays, notifyMember } from "./grant-service";
import { buildSearchIndex, searchIndex, type IndexedEntry, type SearchEntry } from "./bot-search";
import {
  buildMemberVipNotice,
  canGrantNow,
  monthsToDays,
  vipLineKind,
  type CandidateRef,
  type VipCard,
  type VipMonths,
} from "./bot-messages";
import type { SubscriptionState } from "./subscription-rules";

/**
 * POST BOT: VIP BERISH — BAZA QISMI.
 *
 * Qidiruv indeksida faqat ism turadi (2 daqiqa xotirada): har harfda ~3 000
 * qatorni bazadan o'qish shart emas. Akkaunt, VIP va havola holati esa har
 * safar YANGI o'qiladi — ko'pi bilan 20 nomzod uchun, uchta parallel so'rov:
 * hozirgina berilgan VIP keyingi harfdayoq ko'rinsin.
 */

const INDEX_TTL_MS = 2 * 60 * 1000;
const PAGE = 1000;
const RESULT_LIMIT = 20;
const OPEN_STATES: readonly SubscriptionState[] = ["pending", "active", "grace_period", "suspended"];

type IndexEntry = SearchEntry;

let indexCache: { at: number; index: IndexedEntry<IndexEntry>[] } | null = null;
let indexLoading: Promise<IndexedEntry<IndexEntry>[]> | null = null;

async function fetchIndex(): Promise<IndexedEntry<IndexEntry>[]> {
  const db = createSupabaseAdminClient();
  const entries: IndexEntry[] = [];
  // PostgREST bir so'rovda ko'pi bilan 1 000 qator beradi — sahifalab o'qiladi.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("candidates")
      .select("id, full_name, status")
      .is("deleted_at", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`nomzodlar o‘qilmadi: ${error.message}`);
    for (const row of data ?? []) {
      entries.push({
        id: row.id as string,
        fullName: (row.full_name as string) ?? "",
        published: row.status === "published",
      });
    }
    if ((data ?? []).length < PAGE) break;
  }
  return buildSearchIndex(entries);
}

async function loadIndex(): Promise<IndexedEntry<IndexEntry>[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.index;
  // Bir vaqtda kelgan harflar bitta yuklashni kutadi.
  indexLoading ??= fetchIndex()
    .then((index) => {
      indexCache = { at: Date.now(), index };
      return index;
    })
    .finally(() => {
      indexLoading = null;
    });
  return indexLoading;
}

/* ========================================================================= *
 * KARTALAR
 * ========================================================================= */

export interface LoadedCard {
  card: VipCard;
  userId: string | null;
  avatarUrl: string | null;
}

interface CandidateRow {
  id: string;
  full_name: string;
  slug: string | null;
  status: string;
  user_id: string | null;
  avatar_url: string | null;
  regions: { name?: string } | null;
}

interface SubscriptionRow {
  profile_id: string;
  state: SubscriptionState;
  started_at: string | null;
  current_period_end: string | null;
  grace_until: string | null;
}

const toDate = (value: string | null): Date | null => (value ? new Date(value) : null);

/** Kartalar YANGI ma'lumot bilan, kirish tartibida. */
export async function loadCards(candidateIds: readonly string[]): Promise<LoadedCard[]> {
  if (candidateIds.length === 0) return [];
  const db = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: candidateData, error } = await db
    .from("candidates")
    .select("id, full_name, slug, status, user_id, avatar_url, regions(name)")
    .in("id", candidateIds as string[])
    .is("deleted_at", null);
  if (error) throw new Error(`nomzod o‘qilmadi: ${error.message}`);
  const candidates = (candidateData ?? []) as unknown as CandidateRow[];
  const userIds = candidates.map((c) => c.user_id).filter((id): id is string => Boolean(id));

  const [subscriptions, links, pending, origin] = await Promise.all([
    userIds.length > 0
      ? db
          .from("vip_subscriptions")
          .select("profile_id, state, started_at, current_period_end, grace_until")
          .in("profile_id", userIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    db
      .from("candidate_activations")
      .select("id, candidate_id, expires_at")
      .in("candidate_id", candidateIds as string[])
      .is("consumed_at", null)
      .is("revoked_at", null)
      .gt("expires_at", nowIso),
    db
      .from("vip_pending_grants")
      .select("activation_id, days")
      .in("candidate_id", candidateIds as string[])
      .is("applied_at", null),
    resolvePublicWebUrl(),
  ]);
  if (subscriptions.error) throw new Error(`VIP o‘qilmadi: ${subscriptions.error.message}`);

  // Ochiq obuna bo'lsa — o'sha; bo'lmasa eng oxirgisi (ro'yxat yangidan eskiga).
  const subscriptionOf = new Map<string, SubscriptionRow>();
  for (const row of (subscriptions.data ?? []) as SubscriptionRow[]) {
    const current = subscriptionOf.get(row.profile_id);
    if (!current || (!OPEN_STATES.includes(current.state) && OPEN_STATES.includes(row.state))) {
      subscriptionOf.set(row.profile_id, row);
    }
  }
  const vipDaysOf = new Map(
    ((pending.data ?? []) as { activation_id: string; days: number }[]).map((p) => [p.activation_id, p.days]),
  );
  const linkOf = new Map(
    ((links.data ?? []) as { id: string; candidate_id: string; expires_at: string }[]).map((l) => [
      l.candidate_id,
      { expiresAt: new Date(l.expires_at), vipDays: vipDaysOf.get(l.id) ?? null },
    ]),
  );

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out: LoadedCard[] = [];
  for (const id of candidateIds) {
    const c = byId.get(id);
    if (!c) continue;
    const sub = c.user_id ? subscriptionOf.get(c.user_id) : undefined;
    out.push({
      userId: c.user_id,
      avatarUrl: c.avatar_url,
      card: {
        candidateId: c.id,
        fullName: c.full_name,
        articleUrl: c.slug ? `${origin}${candidateArticlePath(c.slug)}` : null,
        regionName: c.regions?.name ?? null,
        published: c.status === "published",
        linked: Boolean(c.user_id),
        subscription: sub
          ? {
              state: sub.state,
              times: {
                startedAt: toDate(sub.started_at),
                currentPeriodEnd: toDate(sub.current_period_end),
                graceUntil: toDate(sub.grace_until),
              },
            }
          : null,
        liveLink: c.user_id ? null : linkOf.get(c.id) ?? null,
      },
    });
  }
  return out;
}

/** "Faqat o'z nomzodlari" rejimi: shu chat bot orqali anketa yaratgan nomzodlar. */
async function ownCandidateIds(chatId: number): Promise<Set<string>> {
  const { data, error } = await createSupabaseAdminClient()
    .from("candidate_intakes")
    .select("candidate_id")
    .eq("created_by_telegram_id", chatId)
    .not("candidate_id", "is", null);
  if (error) throw new Error(`anketalar o‘qilmadi: ${error.message}`);
  return new Set((data ?? []).map((row) => row.candidate_id as string));
}

export async function isOwnCandidate(chatId: number, candidateId: string): Promise<boolean> {
  return (await ownCandidateIds(chatId)).has(candidateId);
}

/**
 * Bo'sh so'rov: VIP'i tugagan yoki 7 kun ichida tugaydiganlar — "yana VIP
 * berish" kerak bo'lganlar ism yozmasdan ham ko'rinsin. Avval tugayotganlar
 * (eng yaqini birinchi), keyin tugaganlar (eng yangisi birinchi).
 */
async function renewalCandidateIds(own: Set<string> | null): Promise<string[]> {
  const db = createSupabaseAdminClient();
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("vip_subscriptions")
    .select("profile_id")
    .in("state", ["active", "grace_period", "expired"])
    .not("current_period_end", "is", null)
    .lt("current_period_end", soon)
    .order("current_period_end", { ascending: false })
    .limit(200);
  if (error) throw new Error(`VIP o‘qilmadi: ${error.message}`);
  const profiles = [...new Set((data ?? []).map((row) => row.profile_id as string))];
  if (profiles.length === 0) return [];

  const { data: candidates } = await db
    .from("candidates")
    .select("id, user_id")
    .in("user_id", profiles)
    .is("deleted_at", null);
  const idOf = new Map((candidates ?? []).map((c) => [c.user_id as string, c.id as string]));
  return profiles
    .map((p) => idOf.get(p))
    .filter((id): id is string => Boolean(id) && (!own || own.has(id as string)));
}

/** Inline qidiruv: ism bo'yicha (yoki bo'sh so'rovda — VIP'i tugayotganlar). */
export async function searchVipCards(query: string, ownerChatId: number | null): Promise<LoadedCard[]> {
  const own = ownerChatId == null ? null : await ownCandidateIds(ownerChatId);

  if (!query.trim()) {
    const now = new Date();
    const soon = now.getTime() + 7 * 86_400_000;
    const end = (c: LoadedCard) => (c.card.subscription?.times.currentPeriodEnd ?? now).getTime();
    const cards = await loadCards(await renewalCandidateIds(own));
    // Ochiq obunasi uzoqroqqa uzaytirilganlar chiqmaydi — ular endi "tugayotgan" emas.
    const ending = cards
      .filter((c) => vipLineKind(c.card, now) === "active" && end(c) < soon)
      .sort((a, b) => end(a) - end(b));
    const expired = cards.filter((c) => vipLineKind(c.card, now) === "expired");
    return [...ending, ...expired].slice(0, RESULT_LIMIT);
  }

  const index = await loadIndex();
  const pool = own ? index.filter(({ entry }) => own.has(entry.id)) : index;
  return loadCards(searchIndex(pool, query, RESULT_LIMIT).map((entry) => entry.id));
}

export type CardLookup =
  | { ok: true; loaded: LoadedCard }
  | { ok: false; reason: "not_found" | "not_own" };

/** Xabardagi havola yoki ID bo'yicha bitta karta. */
export async function loadVipCard(ref: CandidateRef, ownerChatId: number | null): Promise<CardLookup> {
  const db = createSupabaseAdminClient();
  let candidateId: string | null = null;

  if (ref.kind === "id") {
    candidateId = ref.id;
  } else {
    const { data } = await db
      .from("candidates")
      .select("id")
      .eq("slug", ref.slug)
      .is("deleted_at", null)
      .limit(1);
    candidateId = (data?.[0]?.id as string | undefined) ?? null;
    if (!candidateId) {
      // Havola katta-kichik harfi o'zgartirilgan bo'lishi mumkin.
      const { data: loose } = await db
        .from("candidates")
        .select("id")
        .ilike("slug", ref.slug.replace(/[%_\\]/g, ""))
        .is("deleted_at", null)
        .limit(1);
      candidateId = (loose?.[0]?.id as string | undefined) ?? null;
    }
  }

  if (!candidateId) return { ok: false, reason: "not_found" };
  if (ownerChatId != null && !(await isOwnCandidate(ownerChatId, candidateId))) {
    return { ok: false, reason: "not_own" };
  }
  const [loaded] = await loadCards([candidateId]);
  return loaded ? { ok: true, loaded } : { ok: false, reason: "not_found" };
}

/* ========================================================================= *
 * BIR KARTA — BIR AMAL
 * ========================================================================= */

/** Birinchi bosish `true`; shu kartadagi ikkinchisi `false` (unikal kalit). */
export async function claimCard(input: {
  chatId: number;
  messageId: number;
  candidateId: string;
  action: string;
}): Promise<boolean> {
  const { error } = await createSupabaseAdminClient().from("vip_bot_card_actions").insert({
    chat_id: input.chatId,
    message_id: input.messageId,
    candidate_id: input.candidateId,
    action: input.action,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`karta belgilanmadi: ${error.message}`);
}

/** Amal bajarilmasa karta qayta ishlatiladigan bo'ladi — muharrir yana bosa olsin. */
export async function releaseCard(chatId: number, messageId: number): Promise<void> {
  await createSupabaseAdminClient()
    .from("vip_bot_card_actions")
    .delete()
    .eq("chat_id", chatId)
    .eq("message_id", messageId);
}

/* ========================================================================= *
 * AMALLAR
 * ========================================================================= */

export interface BotEditor {
  telegramId: number;
  name: string | null;
}

export type VipLinkResult =
  | {
      ok: true;
      link: string;
      expiresAt: Date;
      vipDays: number | null;
      replacedPrevious: boolean;
    }
  | { ok: false; reason: "disabled" | "already_linked" | "not_found" | "error" };

/**
 * Faollashtirish havolasi; `months > 0` bo'lsa — shu havolaga kutib turgan VIP.
 *
 * VIP yozilmasa havola BEKOR qilinadi: muharrir "VIP bilan" deb tanlagan
 * havola VIPsiz ketib qolmasin.
 */
export async function createVipLink(input: {
  candidateId: string;
  months: 0 | VipMonths;
  editor: BotEditor;
}): Promise<VipLinkResult> {
  const created = await createActivation(input.candidateId, { actorId: null });
  if (!created.ok || !created.token || !created.activationId || !created.expiresAt) {
    const reason = created.reason;
    return {
      ok: false,
      reason:
        reason === "disabled" || reason === "already_linked"
          ? reason
          : reason === "candidate_not_found"
            ? "not_found"
            : "error",
    };
  }

  const vipDays = input.months > 0 ? monthsToDays(input.months as VipMonths) : null;
  if (vipDays) {
    const { error } = await createSupabaseAdminClient().from("vip_pending_grants").insert({
      candidate_id: input.candidateId,
      activation_id: created.activationId,
      days: vipDays,
      granted_by_telegram_id: input.editor.telegramId,
      granted_by_name: input.editor.name?.slice(0, 120) ?? null,
    });
    if (error) {
      console.error("[vip-bot] kutib turgan VIP yozilmadi:", error.message);
      await revokeActivation(created.activationId, "Post bot: VIP yozilmadi — havola bekor qilindi");
      return { ok: false, reason: "error" };
    }
  }

  await logAudit({
    actorId: null,
    action: "vip.bot.link_created",
    entityType: "candidate",
    entityId: input.candidateId,
    severity: "warning",
    metadata: {
      telegram_id: input.editor.telegramId,
      editor: input.editor.name,
      vip_days: vipDays,
      expires_at: created.expiresAt,
    },
  });

  return {
    ok: true,
    link: activationUrl(getSiteUrl(), created.token),
    expiresAt: new Date(created.expiresAt),
    vipDays,
    replacedPrevious: created.replacedPrevious ?? false,
  };
}

export type VipGrantNowResult =
  | { ok: true; fullName: string; periodEnd: Date | null; notified: boolean }
  | { ok: false; reason: "not_found" | "not_linked" | "not_allowed" | "error" };

/** Akkaunti bor nomzodga darhol VIP — yagona `vip_grant_days` orqali. */
export async function grantVipNow(input: {
  candidateId: string;
  months: VipMonths;
  editor: BotEditor;
  idempotencyKey: string;
}): Promise<VipGrantNowResult> {
  const [loaded] = await loadCards([input.candidateId]);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (!loaded.userId) return { ok: false, reason: "not_linked" };
  if (!canGrantNow(loaded.card, new Date())) return { ok: false, reason: "not_allowed" };

  const editorLabel = `${input.editor.name ?? "muharrir"} (tg ${input.editor.telegramId})`;
  const granted = await grantVipDays({
    profileId: loaded.userId,
    days: monthsToDays(input.months),
    source: "admin",
    sourceId: `post_bot:${input.editor.telegramId}`,
    idempotencyKey: input.idempotencyKey,
    actorId: null,
    reason: `Post bot: +${input.months} oy VIP — ${editorLabel}`,
  });
  if (!granted.ok) return { ok: false, reason: "error" };

  const periodEnd = granted.periodEnd ? new Date(granted.periodEnd) : null;
  let notified = false;
  if (granted.granted) {
    const outcome = await notifyMember(loaded.userId, buildMemberVipNotice(input.months, periodEnd));
    notified = outcome.telegram === true;
  }
  return { ok: true, fullName: loaded.card.fullName, periodEnd, notified };
}

/** Zaxira yo'l (soatlik cron): trigger o'tkazib yuborgan kutib turgan VIP'lar. */
export async function applyPendingVipGrants(): Promise<number> {
  const { data, error } = await createSupabaseAdminClient().rpc("vip_apply_pending_grants", {
    p_candidate_id: null,
  });
  if (error) {
    console.error("[vip-bot] kutib turgan VIP'lar qo‘llanmadi:", error.message);
    return 0;
  }
  return Number(data ?? 0);
}
