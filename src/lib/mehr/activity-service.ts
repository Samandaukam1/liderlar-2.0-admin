import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";


/**
 * Ezgulik ishini yaratish va tekshiruvga yuborish (§3, §10).
 *
 * TASHKILOTCHI MIJOZDAN QABUL QILINMAYDI.
 *
 * `organizerProfileId` har doim serverda aniqlangan shaxsdan
 * keladi — imzolangan Telegram identifikatoridan yoki sayt
 * seansidan. Uni parametr sifatida brauzerdan olsak, istalgan
 * odam boshqa a'zo nomidan tadbir ochib, unga ball yozdira
 * olardi.
 */

export const createActivitySchema = z.object({
  title: z.string().trim().min(3, "Nom kamida 3 belgi bo'lsin.").max(200),
  categoryId: z.uuid().nullable().optional(),
  regionId: z.uuid().nullable().optional(),
  purpose: z.string().trim().max(2000).nullable().optional(),

  locationName: z.string().trim().max(300).nullable().optional(),
  requiresLocation: z.boolean().default(true),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  checkinRadiusMeters: z.number().int().min(20).max(20000).nullable().optional(),

  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),

  expectedParticipants: z.number().int().min(0).max(100000).nullable().optional(),
  expectedBeneficiaries: z.number().int().min(0).max(1000000).nullable().optional(),
});

export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export interface CreateActivityResult {
  ok: boolean;
  activityId: string | null;
  error: string | null;
}

export async function createMehrActivity(
  organizerProfileId: string,
  input: CreateActivityInput,
): Promise<CreateActivityResult> {
  const db = createSupabaseAdminClient();

  /*
   * Joy talab qilinsa, koordinata va radius birga bo'lishi kerak.
   * Baza ham buni cheklov bilan ushlaydi, lekin foydalanuvchi
   * bazaning xato matnini emas, tushunarli javobni ko'rsin.
   */
  if (input.requiresLocation && (input.latitude === null || input.latitude === undefined)) {
    return {
      ok: false,
      activityId: null,
      error: "Jismoniy tadbir uchun joyni xaritada belgilang yoki «onlayn» deb tanlang.",
    };
  }

  const { data, error } = await db
    .from("mehr_activities")
    .insert({
      organizer_profile_id: organizerProfileId,
      title: input.title,
      category_id: input.categoryId ?? null,
      region_id: input.regionId ?? null,
      purpose: input.purpose ?? null,
      location_name: input.locationName ?? null,
      requires_location: input.requiresLocation,
      latitude: input.requiresLocation ? (input.latitude ?? null) : null,
      longitude: input.requiresLocation ? (input.longitude ?? null) : null,
      checkin_radius_meters: input.requiresLocation ? (input.checkinRadiusMeters ?? 300) : null,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      expected_participants: input.expectedParticipants ?? null,
      beneficiary_count: null,
      // HOLAT — QORALAMA. Ommaviy bo'lish faqat tasdiqdan keyin.
      status: "draft",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("MEHR_ACTIVITY_CREATE_FAILED", { code: error?.code, message: error?.message });
    return { ok: false, activityId: null, error: "Tadbirni yaratib bo'lmadi." };
  }

  const activityId = data.id as string;

  /*
   * TASHKILOTCHI — DARHOL ISHTIROKCHI RO'YXATIDA.
   *
   * Busiz tasdiq paytida unga ball yozadigan qator bo'lmasdi:
   * ball rejasi aynan `mehr_participants` dan chiqadi.
   *
   * `checked_in_at` ATAYLAB bo'sh: tashkilotchi ham tadbirga
   * kelganini QR bilan tasdiqlaydi. Roli esa 'organizer' bo'lib
   * qoladi va u +60 oladi.
   */
  const { error: participantError } = await db.from("mehr_participants").insert({
    activity_id: activityId,
    profile_id: organizerProfileId,
    role: "organizer",
    status: "checked_in",
    checked_in_at: new Date().toISOString(),
  });

  if (participantError) {
    console.error("MEHR_ORGANIZER_PARTICIPANT_FAILED", {
      code: participantError.code,
      message: participantError.message,
    });
  }

  return { ok: true, activityId, error: null };
}

/*
 * Dalil yuborish SHU YERDA EMAS.
 *
 * U liderlar-web kabinetida turadi: fayl yuklash brauzerda
 * ishonchliroq va qoida bitta nusxada qoladi. Bazaviy kafolat
 * esa ikkalasi uchun ham bir xil — shartli UPDATE tashkilotchi
 * va holatni yozuvning ichida tekshiradi.
 */
