import { NextResponse } from "next/server";
import { z } from "zod";
import { identifyWebAppRequest, identityError } from "@/lib/member-bot/webapp-session";
import { createMehrActivity, createActivitySchema } from "@/lib/mehr/activity-service";
import { getMehrFlags } from "@/lib/mehr/flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * DALIL YUBORISH BU YERDA YO'Q — ATAYLAB.
 *
 * Tashkilotchi tadbirni yakunlagach, dalilni (muqova rasmi,
 * fotolar, tavsif) shaxsiy kabinetda to'ldiradi. Fayl yuklash
 * uchun brauzer muhiti ancha qulay, va eng muhimi — yuborish
 * mantig'i BITTA joyda qoladi. Ikki ilovada ikki nusxa bo'lsa,
 * ular vaqt o'tib bir-biridan ajralib ketardi.
 *
 * Mini App'ning ishi — tadbirning O'ZI: seans, QR, jonli hisob.
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    initData: z.string().min(1),
    activity: createActivitySchema,
  }),
  z.object({
    action: z.literal("list"),
    initData: z.string().min(1),
  }),
]);

/**
 * POST /api/mehr-app/activity
 *
 * TASHKILOTCHI SO'ROVDAN OLINMAYDI. `organizerProfileId`
 * imzolangan Telegram identifikatoridan chiqadi — mijoz uni
 * yubora olmaydi va o'zgartira olmaydi.
 */
export async function POST(request: Request) {
  const flags = await getMehrFlags();
  if (!flags.activityCreationEnabled) {
    return NextResponse.json(
      { ok: false, code: "DISABLED", error: "Tadbir yaratish hozircha yopiq." },
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
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_INPUT",
        error: parsed.error.issues[0]?.message ?? "Ma'lumot to'liq emas.",
      },
      { status: 400 },
    );
  }

  const identity = await identifyWebAppRequest(parsed.data.initData);
  if (!identity.ok) {
    const err = identityError(identity);
    return NextResponse.json(err.body, { status: err.status });
  }

  const db = createSupabaseAdminClient();

  if (parsed.data.action === "list") {
    const { data } = await db
      .from("mehr_activities")
      .select("id, title, status, starts_at, requires_location")
      .eq("organizer_profile_id", identity.profileId)
      .order("created_at", { ascending: false })
      .limit(20);

    return NextResponse.json({ ok: true, activities: data ?? [] });
  }

  if (parsed.data.action === "create") {
    const result = await createMehrActivity(identity.profileId, parsed.data.activity);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, code: "CREATE_FAILED", error: result.error },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, activityId: result.activityId });
  }

  return NextResponse.json({ ok: false, code: "BAD_INPUT", error: "Noma'lum amal." }, { status: 400 });
}
