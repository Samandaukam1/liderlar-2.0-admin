import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { identifyWebAppRequest, identityError } from "@/lib/member-bot/webapp-session";
import {
  openEventSession,
  currentQrToken,
  closeEventSession,
} from "@/lib/mehr/session-service";
import { getMehrFlags } from "@/lib/mehr/flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  initData: z.string().min(1),
  action: z.enum(["open", "qr", "close", "status"]),
  activityId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
});

/**
 * POST /api/mehr-app/session
 *
 * Tashkilotchining seans boshqaruvi.
 *
 * TASHKILOTCHILIK HAR SO'ROVDA QAYTA TEKSHIRILADI: xizmat
 * qatlami profilni tadbirning `organizer_profile_id` bilan
 * solishtiradi. "Bir marta tekshirdik" degan seans yo'q —
 * Mini App'ning har bir chaqiruvi mustaqil.
 */
export async function POST(request: Request) {
  const flags = await getMehrFlags();
  if (!flags.activityCreationEnabled) {
    return NextResponse.json(
      { ok: false, code: "DISABLED", error: "Tadbir boshqaruvi hozircha yopiq." },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_JSON", error: "So'rov noto'g'ri." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "BAD_INPUT", error: "So'rov noto'g'ri." }, { status: 400 });
  }

  const identity = await identifyWebAppRequest(parsed.data.initData);
  if (!identity.ok) {
    const err = identityError(identity);
    return NextResponse.json(err.body, { status: err.status });
  }

  const { action, activityId, sessionId } = parsed.data;

  if (action === "open") {
    if (!activityId) {
      return NextResponse.json({ ok: false, code: "BAD_INPUT", error: "Tadbir ko'rsatilmagan." }, { status: 400 });
    }
    const result = await openEventSession(activityId, identity.profileId);
    if (!result.ok) {
      const status = result.reason === "not_organizer" ? 403 : result.reason === "not_found" ? 404 : 409;
      return NextResponse.json(
        { ok: false, code: result.reason.toUpperCase(), error: sessionErrorText(result.reason) },
        { status },
      );
    }
    return NextResponse.json({ ok: true, sessionId: result.sessionId, reason: result.reason });
  }

  if (action === "qr") {
    if (!sessionId) {
      return NextResponse.json({ ok: false, code: "BAD_INPUT", error: "Seans ko'rsatilmagan." }, { status: 400 });
    }
    const qr = await currentQrToken(sessionId, identity.profileId);
    if (!qr) {
      return NextResponse.json(
        { ok: false, code: "NOT_AVAILABLE", error: "Seans ochiq emas yoki sizga tegishli emas." },
        { status: 403 },
      );
    }

    /*
     * QR rasmi SERVERDA chiziladi.
     *
     * Mini App tadbir joyida, ko'pincha zaif internetda ochiladi.
     * Mijoz tomonida chizish uchun qo'shimcha kutubxona yuklash
     * kerak bo'lardi — har 30 soniyada yangilanadigan ekran uchun
     * bu keraksiz og'irlik.
     */
    const dataUrl = await QRCode.toDataURL(qr.token, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 512,
    });

    return NextResponse.json({ ok: true, ...qr, dataUrl });
  }

  if (action === "close") {
    if (!sessionId) {
      return NextResponse.json({ ok: false, code: "BAD_INPUT", error: "Seans ko'rsatilmagan." }, { status: 400 });
    }
    const result = await closeEventSession(sessionId, identity.profileId);
    if (!result.ok) {
      const status = result.reason === "not_organizer" ? 403 : result.reason === "not_found" ? 404 : 500;
      return NextResponse.json(
        { ok: false, code: result.reason.toUpperCase(), error: sessionErrorText(result.reason) },
        { status },
      );
    }
    return NextResponse.json({ ok: true, checkedIn: result.checkedIn, reason: result.reason });
  }

  // action === "status" — jonli ko'rinish uchun (§9).
  if (!activityId) {
    return NextResponse.json({ ok: false, code: "BAD_INPUT", error: "Tadbir ko'rsatilmagan." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();

  const { data: activity } = await db
    .from("mehr_activities")
    .select("id, title, status, organizer_profile_id, requires_location")
    .eq("id", activityId)
    .maybeSingle();

  if (!activity) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Tadbir topilmadi." }, { status: 404 });
  }
  if (activity.organizer_profile_id !== identity.profileId) {
    return NextResponse.json({ ok: false, code: "NOT_ORGANIZER", error: "Bu tadbir sizga tegishli emas." }, { status: 403 });
  }

  const [{ data: session }, { count: checkedIn }, { data: verified }] = await Promise.all([
    db
      .from("mehr_activity_sessions")
      .select("id, status, opens_at, closes_at, rotation_seconds")
      .eq("activity_id", activityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("mehr_participants")
      .select("id", { count: "exact", head: true })
      .eq("activity_id", activityId)
      .eq("status", "checked_in"),
    db
      .from("mehr_checkins")
      .select("location_verified, mehr_participants!inner(activity_id)")
      .eq("mehr_participants.activity_id", activityId),
  ]);

  const rows = (verified ?? []) as { location_verified: boolean | null }[];

  return NextResponse.json({
    ok: true,
    activity: {
      id: activity.id,
      title: activity.title,
      status: activity.status,
      requiresLocation: activity.requires_location,
    },
    session: session
      ? {
          id: session.id,
          status: session.status,
          opensAt: session.opens_at,
          closesAt: session.closes_at,
          rotationSeconds: session.rotation_seconds,
        }
      : null,
    checkedIn: checkedIn ?? 0,
    /*
     * Joy tekshiruvi XULOSASI — aniq koordinata emas (§8).
     * Adminga ham, tashkilotchiga ham shu yetarli.
     */
    locationVerifiedCount: rows.filter((r) => r.location_verified === true).length,
  });
}

function sessionErrorText(reason: string): string {
  switch (reason) {
    case "not_organizer":
      return "Bu tadbir sizga tegishli emas.";
    case "not_found":
      return "Tadbir topilmadi.";
    case "wrong_state":
      return "Bu tadbir uchun seans ochib bo'lmaydi — u allaqachon yuborilgan yoki tasdiqlangan.";
    default:
      return "Xatolik yuz berdi.";
  }
}
