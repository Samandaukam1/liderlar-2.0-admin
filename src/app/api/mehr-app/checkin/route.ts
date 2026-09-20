import { NextResponse } from "next/server";
import { z } from "zod";
import { identifyWebAppRequest, identityError } from "@/lib/member-bot/webapp-session";
import { performCheckin } from "@/lib/mehr/checkin-service";
import { getMehrFlags } from "@/lib/mehr/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  initData: z.string().min(1),
  token: z.string().min(1),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracyMeters: z.number().min(0).max(100000).optional(),
    })
    .nullable()
    .optional(),
});

/**
 * POST /api/mehr-app/checkin
 *
 * SHAXS MIJOZDAN QABUL QILINMAYDI. `profileId` so'rov tanasida
 * umuman yo'q — u Telegram imzosidan chiqariladi. Aks holda
 * istalgan odam boshqa a'zo nomidan check-in qilardi.
 */
export async function POST(request: Request) {
  const flags = await getMehrFlags();
  if (!flags.qrCheckinEnabled) {
    return NextResponse.json(
      { ok: false, code: "DISABLED", error: "QR check-in hozircha yopiq." },
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

  const result = await performCheckin({
    token: parsed.data.token,
    profileId: identity.profileId,
    telegramUserId: identity.telegramUser.id,
    reportedLocation: parsed.data.location ?? null,
  });

  if (!result.ok) {
    const MESSAGES: Record<string, { status: number; text: string }> = {
      bad_token: { status: 400, text: "QR kod tanilmadi. Ekrandagi kodni qayta skanerlang." },
      expired: { status: 410, text: "QR kodning muddati tugagan. Ekranda yangisi turibdi — qayta skanerlang." },
      wrong_session: { status: 404, text: "Bu QR boshqa tadbirga tegishli." },
      session_closed: { status: 409, text: "Tadbir yopilgan — check-in qabul qilinmaydi." },
      already_checked_in: { status: 409, text: "Siz allaqachon qayd etilgansiz." },
      location_required: { status: 400, text: "Bu tadbir uchun joylashuv ruxsati kerak." },
      too_far: { status: 403, text: "Siz tadbir joyidan uzoqdasiz." },
      event_has_no_location: { status: 409, text: "Tadbir joyi belgilanmagan — tashkilotchiga ayting." },
      error: { status: 500, text: "Xatolik. Qaytadan urinib ko'ring." },
    };

    const m = MESSAGES[result.reason] ?? MESSAGES.error;
    return NextResponse.json(
      {
        ok: false,
        code: result.reason.toUpperCase(),
        error: m.text,
        // Masofa ko'rsatiladi: odam nima qilishini bilsin.
        ...(result.distanceMeters != null ? { distanceMeters: result.distanceMeters } : {}),
      },
      { status: m.status },
    );
  }

  return NextResponse.json({
    ok: true,
    activityTitle: result.activityTitle,
    locationVerified: result.locationVerified,
  });
}
