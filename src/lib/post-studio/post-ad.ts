import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AdPosition, CaptionAd } from "./caption-ad.ts";

/**
 * POSTGA REKLAMA BIRIKTIRISH — I/O qismi.
 *
 * Bitta post ↔ bitta reklama. Birinchi yuborishda navbatdagi reklama
 * olinadi (`claim_next_bot_post_ad`, bazada atomar) va postga
 * yopishtiriladi (`telegram_ad_id`). Qayta yuborish, faqat xatolarni qayta
 * yuborish va majburiy qayta yuborish o'sha reklamani saqlaydi — obunachilar
 * bitta postni ikki xil reklama bilan ko'rmaydi, navbat esa faqat HAQIQATAN
 * yuborilgan postlar bo'yicha yuradi.
 *
 * HAMMASI YUMSHOQ YIQILADI: reklama bilan bog'liq istalgan xato post
 * yuborishni to'xtatmaydi — post reklamasiz ketadi, xato logga yoziladi.
 * Shu sababli post ustunlari ham `repository.ts` dagi asosiy so'rovga
 * qo'shilmagan: migratsiya kechiksa Studio ochilaveradi.
 */

export interface PostAdTarget {
  id: string;
  telegramAdEnabled: boolean;
  telegramAdId: string | null;
}

export interface BotAdOption {
  id: string;
  title: string;
  text: string;
  url: string;
}

const AD_COLUMNS = "id, title, text, url, placement, is_active, starts_at, ends_at";

type AdRow = {
  id: string;
  title: string;
  text: string | null;
  url: string;
  placement: string;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

function isLiveBotAd(row: AdRow, now = Date.now()): boolean {
  if (row.placement !== "bot_post" || !row.is_active || !row.text) return false;
  if (row.starts_at && Date.parse(row.starts_at) > now) return false;
  if (row.ends_at && Date.parse(row.ends_at) <= now) return false;
  return true;
}

function toCaptionAd(row: Pick<AdRow, "id" | "text" | "url">): CaptionAd {
  return { id: row.id, text: row.text ?? "", url: row.url };
}

function logSoft(where: string, err: unknown): void {
  console.error(`[post-ad] ${where}:`, err instanceof Error ? err.message : err);
}

/** Postning reklama holati — alohida so'rov, asosiy `getPost` ga tegilmaydi. */
export async function loadPostAdTarget(postId: string): Promise<PostAdTarget | null> {
  try {
    const db = createSupabaseAdminClient();
    const { data, error } = await db
      .from("candidate_social_posts")
      .select("id, telegram_ad_enabled, telegram_ad_id")
      .eq("id", postId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id as string,
      telegramAdEnabled: (data.telegram_ad_enabled as boolean | null) !== false,
      telegramAdId: (data.telegram_ad_id as string | null) ?? null,
    };
  } catch (err) {
    logSoft("post holati o'qilmadi", err);
    return null;
  }
}

/** Admin tanlagan o'rin: postning oxiri yoki footer qatoridan oldin. */
export async function getBotPostPosition(): Promise<AdPosition> {
  try {
    const db = createSupabaseAdminClient();
    const { data } = await db.from("ads_settings").select("bot_post_position").eq("id", true).maybeSingle();
    return data?.bot_post_position === "before_footer" ? "before_footer" : "end";
  } catch (err) {
    logSoft("sozlama o'qilmadi", err);
    return "end";
  }
}

async function loadLiveAd(adId: string): Promise<CaptionAd | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("ads").select(AD_COLUMNS).eq("id", adId).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as AdRow;
  return isLiveBotAd(row) ? toCaptionAd(row) : null;
}

async function claimNextAd(): Promise<CaptionAd | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("claim_next_bot_post_ad");
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Pick<AdRow, "id" | "text" | "url"> | undefined;
  return row?.id ? toCaptionAd(row) : null;
}

async function peekNextAd(): Promise<CaptionAd | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("peek_next_bot_post_ad");
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Pick<AdRow, "id" | "text" | "url"> | undefined;
  return row?.id ? toCaptionAd(row) : null;
}

/**
 * Yuborish uchun reklama: yopishtirilgani bo'lsa va hali faol bo'lsa — o'sha;
 * aks holda navbatdagisi olinadi va postga SHARTLI yangilash bilan
 * yopishtiriladi. Ikki yuborish bir vaqtda kelsa, bittasi yutadi; ikkinchisi
 * postni qayta o'qib g'olibning reklamasini ishlatadi — bitta post, bitta reklama.
 */
export async function resolvePostAd(post: PostAdTarget): Promise<CaptionAd | null> {
  try {
    if (!post.telegramAdEnabled) return null;

    if (post.telegramAdId) {
      const assigned = await loadLiveAd(post.telegramAdId);
      if (assigned) return assigned;
      // O'chirilgan yoki muddati tugagan reklama bilan yubormaymiz — yangisi olinadi.
    }

    const next = await claimNextAd();
    if (!next) return null;

    const db = createSupabaseAdminClient();
    const base = db
      .from("candidate_social_posts")
      .update({ telegram_ad_id: next.id, telegram_ad_assigned_at: new Date().toISOString() })
      .eq("id", post.id);
    const guarded = post.telegramAdId ? base.eq("telegram_ad_id", post.telegramAdId) : base.is("telegram_ad_id", null);
    const { data: stamped } = await guarded.select("id");
    if ((stamped?.length ?? 0) > 0) return next;

    const { data: fresh } = await db
      .from("candidate_social_posts")
      .select("telegram_ad_id")
      .eq("id", post.id)
      .maybeSingle();
    const winnerId = (fresh?.telegram_ad_id as string | null) ?? null;
    if (winnerId && winnerId !== next.id) {
      const winner = await loadLiveAd(winnerId);
      if (winner) return winner;
    }
    return next;
  } catch (err) {
    logSoft("reklama aniqlanmadi, post reklamasiz ketadi", err);
    return null;
  }
}

/** Ko'rish uchun — navbatni SURMAYDI (Studio va sinov yuborish). */
export async function peekPostAd(post: PostAdTarget): Promise<CaptionAd | null> {
  try {
    if (!post.telegramAdEnabled) return null;
    if (post.telegramAdId) {
      const assigned = await loadLiveAd(post.telegramAdId);
      if (assigned) return assigned;
    }
    return await peekNextAd();
  } catch (err) {
    logSoft("navbat ko'rilmadi", err);
    return null;
  }
}

/** Studio'dagi tanlov uchun faol bot reklamalari. */
export async function listLiveBotAds(): Promise<BotAdOption[]> {
  try {
    const db = createSupabaseAdminClient();
    const { data, error } = await db
      .from("ads")
      .select(AD_COLUMNS)
      .eq("placement", "bot_post")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as unknown as AdRow[])
      .filter((row) => isLiveBotAd(row))
      .map((row) => ({ id: row.id, title: row.title, text: row.text ?? "", url: row.url }));
  } catch (err) {
    logSoft("ro'yxat o'qilmadi", err);
    return [];
  }
}

export type PostAdMode = "auto" | "fixed" | "off";

/**
 * Studio tanlovi: avtomatik navbat / aniq reklama / reklamasiz.
 * Aniq reklama faqat faol bot reklamasi bo'lishi mumkin.
 */
export async function setPostAdMode(
  postId: string,
  mode: PostAdMode,
  adId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createSupabaseAdminClient();
  let patch: Record<string, unknown>;
  if (mode === "off") {
    patch = { telegram_ad_enabled: false };
  } else if (mode === "fixed") {
    if (!adId) return { ok: false, error: "Reklama tanlanmagan" };
    const ad = await loadLiveAd(adId);
    if (!ad) return { ok: false, error: "Bu reklama faol emas" };
    patch = { telegram_ad_enabled: true, telegram_ad_id: adId, telegram_ad_assigned_at: new Date().toISOString() };
  } else {
    patch = { telegram_ad_enabled: true, telegram_ad_id: null, telegram_ad_assigned_at: null };
  }
  const { error } = await db.from("candidate_social_posts").update(patch).eq("id", postId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface StudioAdPanel {
  target: PostAdTarget | null;
  options: BotAdOption[];
  /** Yuborishda qo'shiladigan qator (yopishtirilgani yoki navbatdagisi). */
  preview: CaptionAd | null;
  position: AdPosition;
}

/** Studio sahifasi uchun hamma narsa bir joyda; har qismi yumshoq yiqiladi. */
export async function loadStudioAdPanel(postId: string): Promise<StudioAdPanel> {
  const target = await loadPostAdTarget(postId);
  const [options, preview, position] = await Promise.all([
    listLiveBotAds(),
    target ? peekPostAd(target) : Promise.resolve(null),
    getBotPostPosition(),
  ]);
  return { target, options, preview, position };
}
