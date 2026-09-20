import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCheckinToken } from "./checkin-token.ts";
import { checkLocation } from "./geo.ts";

/**
 * Check-in — ishonch zanjirining eng ko'p hujumga uchraydigan bo'g'ini.
 *
 * TEKSHIRUV TARTIBI ATAYLAB SHUNDAY:
 *
 *   1. Shaxs   — kim? (imzolangan Telegram identifikatoridan)
 *   2. Token   — QR haqiqiymi va muddati o'tmaganmi?
 *   3. Seans   — ochiqmi?
 *   4. Joy     — talab qilinsa, yaqinmi?
 *   5. Yozuv   — takroriy emasmi?
 *
 * Shaxs birinchi: token to'g'ri bo'lsa ham, kim ekani noma'lum
 * bo'lsa yozib bo'lmaydi. Joy oxirida: uni so'rashdan oldin
 * QR haqiqiyligiga ishonch hosil qilamiz — aks holda soxta QR
 * bilan odamlardan joylashuvini undirib olish mumkin bo'lardi.
 */

export type CheckinFailure =
  | "not_linked"
  | "bad_token"
  | "expired"
  | "wrong_session"
  | "session_closed"
  | "already_checked_in"
  | "location_required"
  | "too_far"
  | "event_has_no_location"
  | "error";

export type CheckinResult =
  | {
      ok: true;
      activityId: string;
      activityTitle: string;
      participantId: string;
      locationVerified: boolean;
      distanceMeters: number | null;
    }
  | { ok: false; reason: CheckinFailure; distanceMeters?: number | null };

export interface CheckinInput {
  token: string;
  profileId: string | null;
  telegramUserId: number | null;
  reportedLocation: { latitude: number; longitude: number; accuracyMeters?: number } | null;
  now?: Date;
}

export async function performCheckin(input: CheckinInput): Promise<CheckinResult> {
  // 1. SHAXS
  if (!input.profileId) return { ok: false, reason: "not_linked" };

  const db = createSupabaseAdminClient();
  const now = input.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);

  /*
   * Token ichidagi seans id imzolangan, shuning uchun unga
   * tayanib seansni o'qish xavfsiz: imzo tekshirilmaguncha
   * hech nima yozilmaydi.
   */
  const unsafePayload = decodeSessionId(input.token);
  if (!unsafePayload) return { ok: false, reason: "bad_token" };

  const { data: sessionRow } = await db
    .from("mehr_activity_sessions")
    .select(
      "id, signing_secret, status, activity_id, " +
        "mehr_activities(id, title, requires_location, latitude, longitude, checkin_radius_meters, status)",
    )
    .eq("id", unsafePayload)
    .maybeSingle();

  if (!sessionRow) return { ok: false, reason: "wrong_session" };

  /*
   * PostgREST ichma-ich bog'lanish uchun union tip qaytaradi.
   * Shakl bizga ma'lum — so'rovdagi ustunlar ro'yxati aynan
   * shu yerda yozilgan, shuning uchun bir marta aniqlashtiramiz.
   */
  const session = sessionRow as unknown as {
    id: string;
    signing_secret: string;
    status: string;
    activity_id: string;
    mehr_activities: {
      id: string;
      title: string;
      requires_location: boolean;
      latitude: number | null;
      longitude: number | null;
      checkin_radius_meters: number | null;
      status: string;
    } | null;
  };

  // 2. TOKEN — imzo, keyin muddat.
  const verdict = verifyCheckinToken(
    input.token,
    session.signing_secret,
    nowSeconds,
    session.id,
  );

  if (!verdict.ok) {
    if (verdict.reason === "expired") return { ok: false, reason: "expired" };
    if (verdict.reason === "wrong_session") return { ok: false, reason: "wrong_session" };
    return { ok: false, reason: "bad_token" };
  }

  // 3. SEANS
  if (session.status !== "open") return { ok: false, reason: "session_closed" };

  const activity = session.mehr_activities;
  if (!activity) return { ok: false, reason: "wrong_session" };

  // 4. JOY
  const location = checkLocation({
    requiresLocation: activity.requires_location,
    event: {
      latitude: activity.latitude,
      longitude: activity.longitude,
      radiusMeters: activity.checkin_radius_meters,
    },
    reported: input.reportedLocation,
  });

  if (!location.ok) {
    if (location.reason === "location_missing") {
      return { ok: false, reason: "location_required" };
    }
    if (location.reason === "event_has_no_location") {
      return { ok: false, reason: "event_has_no_location" };
    }
    return { ok: false, reason: "too_far", distanceMeters: location.distanceMeters };
  }

  /*
   * 5. YOZUV — TEKSHIRIB-KEYIN-YOZISH EMAS.
   *
   * "Avval bormi deb qarab, keyin qo'shish" ikki so'rov bir
   * vaqtda kelganda ikkalasiga ham "yo'q ekan" deb ko'rinardi.
   * Shuning uchun to'g'ridan-to'g'ri yozamiz va unikal indeks
   * qarshiligini takror deb o'qiymiz.
   */
  const { data: participant, error: participantError } = await db
    .from("mehr_participants")
    .insert({
      activity_id: activity.id,
      profile_id: input.profileId,
      role: "participant",
      status: "checked_in",
      checked_in_at: now.toISOString(),
    })
    .select("id")
    .maybeSingle();

  let participantId: string;

  if (participantError) {
    // 23505 — unikal indeks. Ya'ni bu odam allaqachon ro'yxatda.
    if (participantError.code !== "23505") {
      console.error("MEHR_CHECKIN_PARTICIPANT_FAILED", {
        code: participantError.code,
        message: participantError.message,
      });
      return { ok: false, reason: "error" };
    }

    const { data: existing } = await db
      .from("mehr_participants")
      .select("id, checked_in_at")
      .eq("activity_id", activity.id)
      .eq("profile_id", input.profileId)
      .maybeSingle();

    if (!existing) return { ok: false, reason: "error" };

    /*
     * Tashkilotchi tadbir yaratilganda ro'yxatga tushadi, lekin
     * hali check-in qilmagan bo'ladi. U QR'ni skanerlasa,
     * bu TAKROR emas — birinchi kelishi.
     */
    if (existing.checked_in_at) return { ok: false, reason: "already_checked_in" };

    await db
      .from("mehr_participants")
      .update({ status: "checked_in", checked_in_at: now.toISOString() })
      .eq("id", existing.id as string);

    participantId = existing.id as string;
  } else {
    if (!participant) return { ok: false, reason: "error" };
    participantId = participant.id as string;
  }

  /*
   * Dalil yozuvi. Nonce shu yerda saqlanadi — qaysi token bilan
   * kirgani ko'rinib tursin. Aniq koordinata YOZILMAYDI, faqat
   * masofa: tekshirish uchun shu yetarli (§8).
   */
  const { error: checkinError } = await db.from("mehr_checkins").insert({
    activity_session_id: session.id,
    participant_id: participantId,
    nonce: verdict.payload.nonce,
    location_verified: location.verified,
    distance_meters: location.distanceMeters,
    telegram_user_id: input.telegramUserId,
  });

  if (checkinError && checkinError.code !== "23505") {
    console.error("MEHR_CHECKIN_RECORD_FAILED", {
      code: checkinError.code,
      message: checkinError.message,
    });
  }

  return {
    ok: true,
    activityId: activity.id,
    activityTitle: activity.title,
    participantId,
    locationVerified: location.verified,
    distanceMeters: location.distanceMeters,
  };
}

/**
 * Tokendagi seans id sini imzoni tekshirmasdan o'qiydi.
 *
 * FAQAT SEANSNI TOPISH UCHUN. Bu qiymatga hech qanday qaror
 * bog'lanmaydi: seans topilgach, token uning kaliti bilan
 * to'liq tekshiriladi va faqat shundan keyin ishonchli bo'ladi.
 */
function decodeSessionId(token: string): string | null {
  const [body] = token.split(".");
  if (!body) return null;

  try {
    const pad = body.length % 4 === 0 ? "" : "=".repeat(4 - (body.length % 4));
    const json = Buffer.from(
      body.replace(/-/g, "+").replace(/_/g, "/") + pad,
      "base64",
    ).toString("utf8");
    const parsed = JSON.parse(json) as { s?: unknown };
    return typeof parsed.s === "string" ? parsed.s : null;
  } catch {
    return null;
  }
}
