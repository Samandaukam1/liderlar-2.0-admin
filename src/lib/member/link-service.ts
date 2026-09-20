import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { issueLinkToken, hashLinkToken, LINK_TOKEN_TTL_SECONDS } from "./link-token.ts";

/**
 * Telegram hisobini bog'lash (§5, §16).
 *
 * YO'NALISH MUHIM: token SAYTDAGI AUTENTIFIKATSIYALANGAN
 * SEANSDAN chiqadi va Telegram'da ISHLATILADI — teskarisi emas.
 *
 * Agar bot tokenni o'zi yaratsa, Telegram raqamini bilgan odam
 * o'zini boshqa a'zo deb ko'rsatib, uning hisobiga ulanib
 * olardi. Token esa faqat hisobga kirgan odamda paydo bo'ladi,
 * ya'ni bog'lanish har doim haqiqiy egadan boshlanadi.
 */

export interface IssuedLink {
  /** Telegram deep-link uchun. Bazaga TUSHMAYDI. */
  token: string;
  expiresAt: string;
  deepLink: string | null;
}

/**
 * Bog'lash tokenini yaratadi.
 *
 * Eski ishlatilmagan tokenlar BEKOR QILINADI: bir vaqtda bir
 * nechta amaldagi havola bo'lsa, eskisi ekran suratida qolib,
 * keyin kimdir undan foydalanishi mumkin edi.
 */
export async function issueTelegramLink(
  profileId: string,
  options: { botUsername?: string | null; now?: Date } = {},
): Promise<IssuedLink> {
  const db = createSupabaseAdminClient();
  const now = options.now ?? new Date();

  await db
    .from("member_link_tokens")
    .update({ used_at: now.toISOString() })
    .eq("profile_id", profileId)
    .is("used_at", null);

  const issued = issueLinkToken(now, LINK_TOKEN_TTL_SECONDS);

  const { error } = await db.from("member_link_tokens").insert({
    profile_id: profileId,
    token_hash: issued.tokenHash,
    expires_at: issued.expiresAt,
  });

  if (error) {
    console.error("MEMBER_LINK_TOKEN_INSERT_FAILED", { code: error.code, message: error.message });
    throw new Error("Bog'lash havolasini yaratib bo'lmadi.");
  }

  const username = options.botUsername?.replace(/^@/, "").trim();

  return {
    token: issued.token,
    expiresAt: issued.expiresAt,
    deepLink: username ? `https://t.me/${username}?start=${issued.token}` : null,
  };
}

export type ConsumeResult =
  | { ok: true; profileId: string; displayName: string | null }
  | { ok: false; reason: "not_found" | "already_used" | "expired" | "taken" };

/**
 * Tokenni ishlatadi va Telegram raqamini hisobga bog'laydi.
 *
 * IKKI ATOMIK QADAM:
 *
 *   1. Tokenni SHARTLI UPDATE bilan "ishlatilgan" deb belgilash.
 *      Shart ichida `used_at is null` va muddat turadi — ya'ni
 *      ikki so'rov bir vaqtda kelsa, faqat bittasi 1 qator
 *      o'zgartiradi. Avval o'qib keyin yozsak, ikkalasiga ham
 *      "bo'sh ekan" ko'rinardi.
 *
 *   2. Bog'lanishni yozish. Unikal indeks bitta Telegram
 *      hisobining ikki a'zoga ulanishiga yo'l qo'ymaydi.
 */
export async function consumeTelegramLink(
  rawToken: string,
  telegramUserId: number,
  telegramUsername: string | null,
  options: { now?: Date } = {},
): Promise<ConsumeResult> {
  const db = createSupabaseAdminClient();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const { data: claimed, error: claimError } = await db
    .from("member_link_tokens")
    .update({ used_at: nowIso, used_by_telegram_id: telegramUserId })
    .eq("token_hash", hashLinkToken(rawToken))
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("profile_id")
    .maybeSingle();

  if (claimError) {
    console.error("MEMBER_LINK_CLAIM_FAILED", { code: claimError.code, message: claimError.message });
    return { ok: false, reason: "not_found" };
  }

  if (!claimed) {
    /*
     * Nega bo'lmadi — aniqlashtiramiz. Foydalanuvchiga
     * "muddati tugagan" va "allaqachon ishlatilgan" boshqa-boshqa
     * ma'no beradi: birinchisida yangi havola olish kifoya.
     */
    const { data: existing } = await db
      .from("member_link_tokens")
      .select("used_at, expires_at")
      .eq("token_hash", hashLinkToken(rawToken))
      .maybeSingle();

    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.used_at) return { ok: false, reason: "already_used" };
    return { ok: false, reason: "expired" };
  }

  const profileId = claimed.profile_id as string;

  /*
   * EGALLAB OLISHNI TO'SISH.
   *
   * Bu Telegram hisobi allaqachon BOSHQA a'zoga bog'langan
   * bo'lsa, bog'lash rad etiladi. Aks holda bitta Telegram
   * bir nechta hisobga ulanib, kimning ballari kimga
   * tegishliligi chalkashardi.
   */
  const { data: taken } = await db
    .from("member_telegram_links")
    .select("profile_id")
    .eq("telegram_user_id", telegramUserId)
    .is("unlinked_at", null)
    .maybeSingle();

  if (taken && taken.profile_id !== profileId) {
    await db.from("member_security_events").insert({
      profile_id: profileId,
      event_type: "telegram_linked",
      actor: "system",
      metadata: { result: "rejected", reason: "telegram_already_linked" },
    });
    return { ok: false, reason: "taken" };
  }

  if (!taken) {
    // Bu a'zoning eski bog'lanishi bo'lsa — uziladi, tarix qoladi.
    await db
      .from("member_telegram_links")
      .update({ unlinked_at: nowIso })
      .eq("profile_id", profileId)
      .is("unlinked_at", null);

    const { error: linkError } = await db.from("member_telegram_links").insert({
      profile_id: profileId,
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername,
    });

    if (linkError) {
      console.error("MEMBER_LINK_INSERT_FAILED", { code: linkError.code, message: linkError.message });
      return { ok: false, reason: "taken" };
    }
  }

  await db.from("member_security_events").insert({
    profile_id: profileId,
    event_type: "telegram_linked",
    actor: "member",
    // Raqamning O'ZI yozilmaydi — u shaxsiy identifikator.
    metadata: { result: "linked" },
  });

  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", profileId)
    .maybeSingle();

  return {
    ok: true,
    profileId,
    displayName: (profile?.full_name as string | null)?.trim() || null,
  };
}

/** Telegram raqami bo'yicha bog'langan profilni topadi. */
export async function findProfileByTelegramId(telegramUserId: number): Promise<string | null> {
  const db = createSupabaseAdminClient();

  const { data } = await db
    .from("member_telegram_links")
    .select("profile_id")
    .eq("telegram_user_id", telegramUserId)
    .is("unlinked_at", null)
    .maybeSingle();

  return (data?.profile_id as string | undefined) ?? null;
}
