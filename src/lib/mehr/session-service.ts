import "server-only";
import { randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { issueCheckinToken, newNonce } from "./checkin-token.ts";

/**
 * Tadbir seansi — QR shu yerda aylanadi (§7).
 *
 * Seans kaliti (`signing_secret`) BAZADA QOLADI va hech qachon
 * brauzerga chiqmaydi. Mini App faqat TAYYOR TOKENNI oladi:
 * kalitni bilgan odam o'zi uchun haqiqiy check-in tokeni yasay
 * olardi va butun ishtirok tekshiruvi ma'nosini yo'qotardi.
 */

export const DEFAULT_ROTATION_SECONDS = 30;

export interface OpenSessionResult {
  ok: boolean;
  sessionId: string | null;
  reason: "opened" | "already_open" | "not_organizer" | "not_found" | "wrong_state" | "error";
}

/**
 * Seansni ochadi.
 *
 * TASHKILOTCHILIK SERVERDA TEKSHIRILADI. Mijoz "men
 * tashkilotchiman" deb ayta olmaydi: profil id imzolangan
 * Telegram identifikatoridan kelib chiqadi va tadbirning
 * `organizer_profile_id` bilan solishtiriladi.
 */
export async function openEventSession(
  activityId: string,
  organizerProfileId: string,
): Promise<OpenSessionResult> {
  const db = createSupabaseAdminClient();

  const { data: activity } = await db
    .from("mehr_activities")
    .select("id, organizer_profile_id, status")
    .eq("id", activityId)
    .maybeSingle();

  if (!activity) return { ok: false, sessionId: null, reason: "not_found" };
  if (activity.organizer_profile_id !== organizerProfileId) {
    return { ok: false, sessionId: null, reason: "not_organizer" };
  }

  /*
   * Tasdiqlangan yoki rad etilgan tadbirga check-in ochilmaydi:
   * ball allaqachon berilgan yoki berilmaydi, keyingi ishtirok
   * esa hech qayerga yozilmasdi.
   */
  if (!["draft", "changes_requested"].includes(activity.status)) {
    return { ok: false, sessionId: null, reason: "wrong_state" };
  }

  const { data: existing } = await db
    .from("mehr_activity_sessions")
    .select("id")
    .eq("activity_id", activityId)
    .eq("status", "open")
    .maybeSingle();

  if (existing) {
    return { ok: true, sessionId: existing.id as string, reason: "already_open" };
  }

  const { data: created, error } = await db
    .from("mehr_activity_sessions")
    .insert({
      activity_id: activityId,
      // Har seansga alohida kalit: bittasi sizsa, boshqalari zararlanmaydi.
      signing_secret: randomBytes(32).toString("hex"),
      rotation_seconds: DEFAULT_ROTATION_SECONDS,
      status: "open",
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    console.error("MEHR_SESSION_OPEN_FAILED", { code: error?.code, message: error?.message });
    return { ok: false, sessionId: null, reason: "error" };
  }

  return { ok: true, sessionId: created.id as string, reason: "opened" };
}

export interface QrToken {
  token: string;
  expiresAt: number;
  rotationSeconds: number;
}

/**
 * Amaldagi QR tokenini beradi.
 *
 * BIR TOKENNI KO'P ODAM SKANERLAYDI. Token "sarflanmaydi":
 * u tadbirdagi ekranda turadi va o'nlab odam bir vaqtda o'qiydi.
 * Takroriy ishtirokni token emas, `(tadbir, odam)` unikal
 * indeksi to'sadi.
 */
export async function currentQrToken(
  sessionId: string,
  organizerProfileId: string,
  now: Date = new Date(),
): Promise<QrToken | null> {
  const db = createSupabaseAdminClient();

  const { data } = await db
    .from("mehr_activity_sessions")
    .select("id, signing_secret, rotation_seconds, status, mehr_activities(organizer_profile_id)")
    .eq("id", sessionId)
    .maybeSingle();

  if (!data || data.status !== "open") return null;

  const owner = (data.mehr_activities as { organizer_profile_id?: string } | null)
    ?.organizer_profile_id;
  if (owner !== organizerProfileId) return null;

  const rotation = Number(data.rotation_seconds ?? DEFAULT_ROTATION_SECONDS);
  const nowSeconds = Math.floor(now.getTime() / 1000);

  return {
    token: issueCheckinToken(
      { sessionId, nonce: newNonce() },
      data.signing_secret as string,
      rotation,
      nowSeconds,
    ),
    expiresAt: nowSeconds + rotation,
    rotationSeconds: rotation,
  };
}

export interface CloseSessionResult {
  ok: boolean;
  reason: "closed" | "already_closed" | "not_organizer" | "not_found" | "error";
  checkedIn: number;
}

export async function closeEventSession(
  sessionId: string,
  organizerProfileId: string,
): Promise<CloseSessionResult> {
  const db = createSupabaseAdminClient();

  const { data: session } = await db
    .from("mehr_activity_sessions")
    .select("id, status, activity_id, mehr_activities(organizer_profile_id)")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return { ok: false, reason: "not_found", checkedIn: 0 };

  const owner = (session.mehr_activities as { organizer_profile_id?: string } | null)
    ?.organizer_profile_id;
  if (owner !== organizerProfileId) return { ok: false, reason: "not_organizer", checkedIn: 0 };

  const { count } = await db
    .from("mehr_participants")
    .select("id", { count: "exact", head: true })
    .eq("activity_id", session.activity_id as string)
    .eq("status", "checked_in");

  if (session.status === "closed") {
    return { ok: true, reason: "already_closed", checkedIn: count ?? 0 };
  }

  const { error } = await db
    .from("mehr_activity_sessions")
    .update({ status: "closed", closes_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "open");

  if (error) {
    console.error("MEHR_SESSION_CLOSE_FAILED", { code: error.code, message: error.message });
    return { ok: false, reason: "error", checkedIn: count ?? 0 };
  }

  return { ok: true, reason: "closed", checkedIn: count ?? 0 };
}
