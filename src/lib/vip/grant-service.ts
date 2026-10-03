import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendMemberMessage } from "@/lib/member-bot/bot-api";
import { recordAudit } from "./audit-log";

/**
 * VIP KUNLARI — YAGONA SERVER XIZMATI.
 *
 * Barcha avtomatik va qo'lda kun qo'shish shu yerdan o'tadi va bazadagi
 * `vip_grant_days()` ni chaqiradi. Muddat hisobi, takrorlanmaslik va
 * navbat — BAZADA (bitta tranzaksiya, advisory lock, unikal kalit). Bu
 * yerda faqat: chaqirish, jurnal, xabarnoma.
 *
 * Brauzerdan kelgan kun soni, manba yoki kalitga hech qachon ishonilmaydi:
 * chaqiruvchi faqat server kodi (cron, admin amali).
 */

export type VipGrantSource = "admin" | "daily_challenge" | "referral";

export interface VipGrantResult {
  ok: boolean;
  /** Yangi kun qo'shildi. */
  granted: boolean;
  /** Shu kalit bilan avval berilgan — hech narsa o'zgarmadi. */
  duplicate: boolean;
  periodEnd: string | null;
  /** Referal: nega berilmadi (cap, not_published, self_referral, ...). */
  reason?: string;
  error?: string;
}

interface RpcGrant {
  granted?: boolean;
  duplicate?: boolean;
  period_end?: string | null;
  grant_id?: string;
  reason?: string;
}

function toResult(data: RpcGrant | null): VipGrantResult {
  return {
    ok: true,
    granted: data?.granted === true,
    duplicate: data?.duplicate === true,
    periodEnd: data?.period_end ?? null,
    reason: data?.reason,
  };
}

export async function grantVipDays(input: {
  profileId: string;
  days: number;
  source: VipGrantSource;
  sourceId: string | null;
  idempotencyKey: string;
  actorId: string | null;
  reason: string;
}): Promise<VipGrantResult> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("vip_grant_days", {
    p_profile_id: input.profileId,
    p_days: input.days,
    p_source: input.source,
    p_source_id: input.sourceId,
    p_idempotency_key: input.idempotencyKey,
    p_actor_id: input.actorId,
    p_reason: input.reason,
  });

  if (error) {
    console.error("[vip] kun berilmadi:", { source: input.source, code: error.code, message: error.message });
    return { ok: false, granted: false, duplicate: false, periodEnd: null, error: error.message };
  }

  const result = toResult(data as RpcGrant | null);
  if (result.granted) {
    await recordAudit("vip.days.granted", {
      actorId: input.actorId,
      entityId: input.profileId,
      reason: input.reason,
      after: { period_end: result.periodEnd },
      metadata: { source: input.source, days: input.days, source_id: input.sourceId },
    });
  }
  return result;
}

/** Referal: +10 kun, ko'pi bilan 30 — tekshiruvlar bazada (`vip_grant_referral_reward`). */
export async function grantReferralVip(referrerProfileId: string, attributionId: string): Promise<VipGrantResult> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("vip_grant_referral_reward", {
    p_referrer_profile_id: referrerProfileId,
    p_attribution_id: attributionId,
  });

  if (error) {
    console.error("[vip] referal mukofoti berilmadi:", { code: error.code, message: error.message });
    return { ok: false, granted: false, duplicate: false, periodEnd: null, error: error.message };
  }

  const result = toResult(data as RpcGrant | null);
  if (result.granted) {
    await recordAudit("vip.days.granted", {
      actorId: null,
      entityId: referrerProfileId,
      reason: "Promo-kod orqali taklif qilingan nomzod chop etildi",
      after: { period_end: result.periodEnd },
      metadata: { source: "referral", days: 10, source_id: attributionId },
    });
  }
  return result;
}

/* ========================================================================= *
 * XABARNOMA
 * ========================================================================= */

export interface NotifyOutcome {
  inApp: boolean;
  /** `null` — Telegram ulanmagan; `false` — yuborishda xato (yolg'on "yuborildi" yo'q). */
  telegram: boolean | null;
}

/**
 * Kabinetdagi bildirishnoma + (ulangan bo'lsa) Telegram.
 *
 * Telegram yiqilsa, buni YASHIRMAYMIZ: natija `telegram: false` qaytadi
 * va admin sahifasida ko'rinadi.
 */
export async function notifyMember(
  profileId: string,
  message: { title: string; body: string; link?: string },
): Promise<NotifyOutcome> {
  const db = createSupabaseAdminClient();

  const { error: notifyError } = await db.from("notifications").insert({
    recipient_id: profileId,
    title: message.title,
    body: message.body,
    kind: "vip",
    link: message.link ?? "/kabinet",
  });
  if (notifyError) console.error("[vip] bildirishnoma yozilmadi:", notifyError.message);

  const { data: link } = await db
    .from("member_telegram_links")
    .select("telegram_user_id")
    .eq("profile_id", profileId)
    .is("unlinked_at", null)
    .maybeSingle();

  let telegram: boolean | null = null;
  if (link?.telegram_user_id) {
    const sent = await sendMemberMessage(
      Number(link.telegram_user_id),
      `<b>${escapeHtml(message.title)}</b>\n\n${escapeHtml(message.body)}`,
    );
    telegram = sent.ok;
    if (!sent.ok) console.error("[vip] Telegram xabari ketmadi:", sent.error);
  }

  return { inApp: !notifyError, telegram };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
