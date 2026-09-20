import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * MEHR tasdiqlash xizmati.
 *
 * Bu modul HECH QANDAY biznes qoidani o'zi bajarmaydi — butun
 * ish `mehr_approve_activity` funksiyasida, bitta tranzaksiyada
 * ketadi. Bu yerda faqat: ruxsat tekshirilgandan keyin chaqirish,
 * natijani tarjima qilish va auditga yozish.
 *
 * Nega shunday: ball, sertifikat va xabarnoma bir-biridan
 * ajralmasligi kerak. JS'da ketma-ket so'rovlar bilan qilinsa,
 * o'rtada uzilish yarim holat qoldirardi.
 */

export interface ApproveResult {
  ok: boolean;
  reason:
    | "approved"
    | "already_approved"
    | "wrong_state"
    | "not_found"
    | "error";
  /** Ball/sertifikat AYNAN shu chaqiruvda yaratildimi. */
  pointsCreated: number;
  certificatesCreated: number;
  frozenParticipants: number;
  slug: string | null;
  status?: string;
}

interface ApproveRpcRow {
  ok?: boolean;
  reason?: string;
  transitioned?: boolean;
  frozen_participants?: number;
  points_created?: number;
  certificates_created?: number;
  slug?: string | null;
  status?: string;
}

/**
 * Tadbirni tasdiqlaydi.
 *
 * IDEMPOTENT: ikki marta chaqirilsa, ikkinchisida ball ham,
 * sertifikat ham, xabarnoma ham qayta yaratilmaydi. Kafolat
 * ilova tomonida emas — bazadagi unikal indekslarda.
 *
 * CHAQIRUVCHI RUXSATNI O'ZI TEKSHIRADI (`mehr.review`). Bu
 * funksiya service role bilan ishlaydi va RLS'ni chetlab o'tadi.
 */
export async function approveMehrActivity(
  activityId: string,
  options: { actorId?: string | null } = {},
): Promise<ApproveResult> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db.rpc("mehr_approve_activity", {
    p_activity_id: activityId,
    p_actor_user_id: options.actorId ?? null,
  });

  if (error) {
    console.error("MEHR_APPROVE_FAILED", {
      code: error.code,
      message: error.message,
      activityId,
    });
    return {
      ok: false,
      reason: "error",
      pointsCreated: 0,
      certificatesCreated: 0,
      frozenParticipants: 0,
      slug: null,
    };
  }

  const row = (data ?? {}) as ApproveRpcRow;

  const result: ApproveResult = {
    ok: row.ok === true,
    reason: (row.reason as ApproveResult["reason"]) ?? "error",
    pointsCreated: row.points_created ?? 0,
    certificatesCreated: row.certificates_created ?? 0,
    frozenParticipants: row.frozen_participants ?? 0,
    slug: row.slug ?? null,
    status: row.status,
  };

  /*
   * AUDIT FAQAT HAQIQIY O'ZGARISHDA.
   *
   * Qayta chaqiruv hech nimani o'zgartirmaydi; uni ham yozsak,
   * audit jurnalida bo'lmagan tasdiqlar ko'rinib, keyinchalik
   * "kim necha marta tasdiqladi" degan savol chalkashardi.
   */
  if (result.ok && result.reason === "approved") {
    await logAudit({
      actorId: options.actorId ?? null,
      action: "mehr.activity.approved",
      entityType: "mehr_activity",
      entityId: activityId,
      severity: "warning",
      newValue: {
        points_created: result.pointsCreated,
        certificates_created: result.certificatesCreated,
        frozen_participants: result.frozenParticipants,
      },
    });
  }

  return result;
}

export type RejectAction = "reject" | "request_changes";

export interface RejectResult {
  ok: boolean;
  reason: "done" | "wrong_state" | "not_found" | "reason_required" | "error";
}

/**
 * Rad etadi yoki tuzatish so'raydi.
 *
 * SABAB MAJBURIY. Baza ham buni cheklov bilan talab qiladi,
 * lekin bu yerda ham tekshiriladi: foydalanuvchi bazaning
 * xato matnini emas, tushunarli javobni ko'rishi kerak.
 */
export async function rejectMehrActivity(
  activityId: string,
  action: RejectAction,
  reason: string,
  options: { actorId?: string | null } = {},
): Promise<RejectResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, reason: "reason_required" };

  const db = createSupabaseAdminClient();
  const nextStatus = action === "reject" ? "rejected" : "changes_requested";

  /*
   * SHARTLI UPDATE — tekshirib-keyin-yozish emas.
   *
   * `.eq("status", "submitted")` ayni shu yerda turgani muhim:
   * ikki admin bir vaqtda bossa, ikkinchisining so'rovi 0 qator
   * o'zgartiradi va biz buni ko'ramiz. Avval o'qib, keyin yozsak,
   * ikkalasiga ham "submitted" ko'rinardi.
   */
  const { data, error } = await db
    .from("mehr_activities")
    .update({
      status: nextStatus,
      review_reason: trimmed,
      reviewed_at: new Date().toISOString(),
      reviewed_by: options.actorId ?? null,
    })
    .eq("id", activityId)
    .eq("status", "submitted")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("MEHR_REJECT_FAILED", { code: error.code, message: error.message, activityId });
    return { ok: false, reason: "error" };
  }

  if (!data) {
    // Qator topilmadi yoki holati boshqa — ikkalasi ham "hozir bo'lmaydi".
    const { data: exists } = await db
      .from("mehr_activities")
      .select("id")
      .eq("id", activityId)
      .maybeSingle();
    return { ok: false, reason: exists ? "wrong_state" : "not_found" };
  }

  await db.from("mehr_reviews").insert({
    activity_id: activityId,
    action: nextStatus === "rejected" ? "rejected" : "changes_requested",
    reason: trimmed,
    actor_user_id: options.actorId ?? null,
  });

  await logAudit({
    actorId: options.actorId ?? null,
    action: `mehr.activity.${nextStatus}`,
    entityType: "mehr_activity",
    entityId: activityId,
    reason: trimmed,
    severity: "info",
  });

  return { ok: true, reason: "done" };
}

export interface RevokeCertificateResult {
  ok: boolean;
  reason: "revoked" | "already_revoked" | "not_found" | "reason_required" | "error";
}

/**
 * Sertifikatni bekor qiladi.
 *
 * O'CHIRMAYDI — bekor qiladi. Ommaviy tekshirish sahifasi
 * "bekor qilingan" deb ko'rsatishi kerak; o'chirilsa, u
 * "topilmadi" deb chiqib, soxta sertifikat bilan bir xil
 * ko'rinardi (§33).
 */
export async function revokeCertificate(
  certificateId: string,
  reason: string,
  options: { actorId?: string | null } = {},
): Promise<RevokeCertificateResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, reason: "reason_required" };

  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("certificates")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
      revoked_by: options.actorId ?? null,
      revoked_reason: trimmed,
    })
    .eq("id", certificateId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("CERTIFICATE_REVOKE_FAILED", { code: error.code, message: error.message });
    return { ok: false, reason: "error" };
  }

  if (!data) {
    const { data: exists } = await db
      .from("certificates")
      .select("id, status")
      .eq("id", certificateId)
      .maybeSingle();
    if (!exists) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "already_revoked" };
  }

  await logAudit({
    actorId: options.actorId ?? null,
    action: "mehr.certificate.revoked",
    entityType: "certificate",
    entityId: certificateId,
    reason: trimmed,
    severity: "warning",
  });

  return { ok: true, reason: "revoked" };
}
