import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  checkSubmission,
  canTransition,
  type SubmissionDraft,
  type ActivityStatus,
} from "./activity-rules.ts";

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

export const submitActivitySchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(20000),
  purpose: z.string().trim().min(1).max(2000),
  resultSummary: z.string().trim().max(5000).nullable().optional(),
  coverImageUrl: z.string().url(),
  beneficiaryCount: z.number().int().min(0).max(1000000),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export type SubmitActivityInput = z.infer<typeof submitActivitySchema>;

export interface SubmitResult {
  ok: boolean;
  reason: "submitted" | "not_organizer" | "not_found" | "wrong_state" | "incomplete" | "error";
  missing: string[];
}

/**
 * Dalilni saqlab, tekshiruvga yuboradi.
 *
 * To'liqlik SERVERDA tekshiriladi: brauzerdagi tekshiruv
 * qulaylik, chegara emas.
 */
export async function submitMehrActivity(
  activityId: string,
  organizerProfileId: string,
  input: SubmitActivityInput,
): Promise<SubmitResult> {
  const db = createSupabaseAdminClient();

  const { data: activity } = await db
    .from("mehr_activities")
    .select("id, organizer_profile_id, status, starts_at")
    .eq("id", activityId)
    .maybeSingle();

  if (!activity) return { ok: false, reason: "not_found", missing: [] };
  if (activity.organizer_profile_id !== organizerProfileId) {
    return { ok: false, reason: "not_organizer", missing: [] };
  }

  /*
   * Holat mashinasi BITTA joyda turadi (activity-rules.ts):
   * 'draft' va 'changes_requested' yuboriladi, qolganlari yo'q.
   * Bu yerda ro'yxatni qayta yozsak, ikkalasi ajralib ketardi.
   */
  if (!canTransition(activity.status as ActivityStatus, "submit")) {
    return { ok: false, reason: "wrong_state", missing: [] };
  }

  const [{ count: mediaCount }, { count: participantCount }] = await Promise.all([
    db.from("mehr_media").select("id", { count: "exact", head: true }).eq("activity_id", activityId),
    db
      .from("mehr_participants")
      .select("id", { count: "exact", head: true })
      .eq("activity_id", activityId)
      .eq("status", "checked_in"),
  ]);

  const draft: SubmissionDraft = {
    title: input.title,
    description: input.description,
    purpose: input.purpose,
    coverImageUrl: input.coverImageUrl,
    beneficiaryCount: input.beneficiaryCount,
    mediaCount: mediaCount ?? 0,
    participantCount: participantCount ?? 0,
    startsAt: activity.starts_at as string | null,
  };

  const verdict = checkSubmission(draft);
  if (!verdict.ok) return { ok: false, reason: "incomplete", missing: verdict.missing };

  /*
   * SHARTLI UPDATE. Holat shartini yozuvning ichiga qo'yamiz:
   * shu orada admin tadbirni rad etgan bo'lsa, bu yozuv 0 qator
   * o'zgartiradi va biz buni ko'ramiz.
   */
  const { data: updated, error } = await db
    .from("mehr_activities")
    .update({
      title: input.title,
      description: input.description,
      purpose: input.purpose,
      result_summary: input.resultSummary ?? null,
      cover_image_url: input.coverImageUrl,
      beneficiary_count: input.beneficiaryCount,
      notes: input.notes ?? null,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    })
    .eq("id", activityId)
    .in("status", ["draft", "changes_requested"])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("MEHR_SUBMIT_FAILED", { code: error.code, message: error.message });
    return { ok: false, reason: "error", missing: [] };
  }
  if (!updated) return { ok: false, reason: "wrong_state", missing: [] };

  await db.from("mehr_reviews").insert({
    activity_id: activityId,
    action: "submitted",
    actor_user_id: organizerProfileId,
  });

  return { ok: true, reason: "submitted", missing: [] };
}
