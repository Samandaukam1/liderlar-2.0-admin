"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import {
  approveMehrActivity,
  rejectMehrActivity,
  revokeCertificate,
} from "@/lib/mehr/approval-service";
import { setMemberWebhook } from "@/lib/member-bot/bot-api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * MEHR moderatsiyasi — server action'lar.
 *
 * Har biri RUXSATNI O'ZI TEKSHIRADI. Xizmat qatlami service role
 * bilan ishlaydi va RLS'ni chetlab o'tadi, shuning uchun tekshiruv
 * aynan shu yerda — chaqiruvchining xohishiga qoldirilmaydi.
 */

export type MehrActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const uuid = z.string().uuid();

function revalidate() {
  revalidatePath("/mehr");
}

export async function approveMehrActivityAction(
  activityId: string,
): Promise<MehrActionResult> {
  const ctx = await requirePermission("mehr.review");

  if (!uuid.safeParse(activityId).success) {
    return { ok: false, error: "Tadbir ID noto'g'ri." };
  }

  const result = await approveMehrActivity(activityId, { actorId: ctx.userId });
  revalidate();

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return { ok: false, error: "Tadbir topilmadi." };
      case "wrong_state":
        return {
          ok: false,
          error: `Bu tadbirni hozir tasdiqlab bo'lmaydi — holati: ${result.status ?? "noma'lum"}.`,
        };
      case "points_disabled":
        return {
          ok: false,
          error:
            "Ball berish o'chiq (mehr.points_enabled). Tasdiqlash ball va sertifikatni birga " +
            "yaratadi, shuning uchun avval o'sha bayroqni yoqing.",
        };
      default:
        return { ok: false, error: "Tasdiqlashda xato. Qaytadan urinib ko'ring." };
    }
  }

  /*
   * QAYTA TASDIQLASH — XATO EMAS.
   *
   * Ikki admin bir vaqtda bosgan bo'lishi mumkin. Ikkinchisiga
   * "xato" deb ko'rsatish uni chalg'itardi: ish aslida bajarilgan.
   */
  if (result.reason === "already_approved") {
    return { ok: true, message: "Bu tadbir allaqachon tasdiqlangan — ball va sertifikat o'z joyida." };
  }

  const parts = [`${result.frozenParticipants} ishtirokchi qayd etildi`];
  if (result.pointsCreated > 0) parts.push(`${result.pointsCreated} ta ball yozuvi`);
  if (result.certificatesCreated > 0) parts.push(`${result.certificatesCreated} ta sertifikat`);

  return { ok: true, message: `Tasdiqlandi: ${parts.join(", ")}.` };
}

const reviewSchema = z.object({
  activityId: uuid,
  action: z.enum(["reject", "request_changes"]),
  // Sabab majburiy: baza ham talab qiladi, lekin foydalanuvchi
  // bazaning xato matnini emas, tushunarli javobni ko'rishi kerak.
  reason: z.string().trim().min(5, "Sababni yozing — kamida 5 belgi."),
});

export async function reviewMehrActivityAction(
  input: z.input<typeof reviewSchema>,
): Promise<MehrActionResult> {
  const ctx = await requirePermission("mehr.review");

  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma'lumot noto'g'ri." };
  }

  const { activityId, action, reason } = parsed.data;
  const result = await rejectMehrActivity(activityId, action, reason, { actorId: ctx.userId });
  revalidate();

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return { ok: false, error: "Tadbir topilmadi." };
      case "wrong_state":
        return { ok: false, error: "Bu tadbir allaqachon ko'rib chiqilgan." };
      case "reason_required":
        return { ok: false, error: "Sababni yozing." };
      default:
        return { ok: false, error: "Saqlashda xato." };
    }
  }

  return {
    ok: true,
    message: action === "reject" ? "Rad etildi." : "Tuzatish so'raldi — tashkilotchiga yuborildi.",
  };
}

const revokeSchema = z.object({
  certificateId: uuid,
  reason: z.string().trim().min(5, "Bekor qilish sababini yozing — kamida 5 belgi."),
});

export async function revokeCertificateAction(
  input: z.input<typeof revokeSchema>,
): Promise<MehrActionResult> {
  const ctx = await requirePermission("certificates.manage");

  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma'lumot noto'g'ri." };
  }

  const result = await revokeCertificate(parsed.data.certificateId, parsed.data.reason, {
    actorId: ctx.userId,
  });
  revalidate();

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return { ok: false, error: "Sertifikat topilmadi." };
      case "already_revoked":
        return { ok: false, error: "Bu sertifikat allaqachon bekor qilingan." };
      case "reason_required":
        return { ok: false, error: "Sababni yozing." };
      default:
        return { ok: false, error: "Bekor qilishda xato." };
    }
  }

  return { ok: true, message: "Sertifikat bekor qilindi." };
}

/* ------------------------------------------------------------------
 * SOZLAMALAR: bot va bayroqlar
 * ------------------------------------------------------------------ */

/**
 * Webhook'ni ro'yxatdan o'tkazadi.
 *
 * MANZIL SO'ROVDAN OLINMAYDI. Uni mijoz yuborsa, kimdir
 * botning barcha xabarlarini o'z serveriga yo'naltirib
 * olardi — ya'ni a'zolarning yozishmalarini o'qiy olardi.
 * Shuning uchun manzil serverdagi sozlamadan quriladi.
 */
export async function registerMemberWebhookAction(): Promise<MehrActionResult> {
  await requirePermission("settings.manage");

  const base = process.env.MEMBER_WEBHOOK_BASE_URL?.trim() || process.env.NEXT_PUBLIC_ADMIN_URL?.trim();
  if (!base) {
    return {
      ok: false,
      error:
        "MEMBER_WEBHOOK_BASE_URL sozlanmagan — admin panelning manzilini environment'ga qo'shing.",
    };
  }

  let url: string;
  try {
    url = new URL("/api/telegram-member/webhook", base).toString();
  } catch {
    return { ok: false, error: "MEMBER_WEBHOOK_BASE_URL noto'g'ri formatda." };
  }

  const result = await setMemberWebhook(url);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Webhook o'rnatilmadi." };
  }

  await logAudit({
    actorId: null,
    action: "mehr.bot.webhook_set",
    entityType: "member_bot",
    // Manzil maxfiy emas, lekin token hech qachon bu yerga tushmaydi.
    newValue: { url },
    severity: "warning",
  });

  revalidate();
  return { ok: true, message: `Webhook o'rnatildi: ${url}` };
}

const flagSchema = z.object({
  key: z.enum([
    "mehr.public_enabled",
    "mehr.activity_creation_enabled",
    "mehr.qr_checkin_enabled",
    "mehr.points_enabled",
    "mehr.certificates_enabled",
    "member.auth_enabled",
    "member.bot_enabled",
    "referral.points_enabled",
  ]),
  enabled: z.boolean(),
});

/**
 * Bitta bayroqni yoqadi yoki o'chiradi.
 *
 * KALIT RO'YXATDAN — ixtiyoriy satr emas. Aks holda bu action
 * `site_settings` dagi ISTALGAN sozlamani o'zgartiradigan
 * umumiy yozish yo'liga aylanardi.
 *
 * Har bayroq mustaqil: "hammasini yoq" tugmasi ataylab yo'q —
 * nazorat ostidagi bosqichma-bosqich yoqish shuning uchun.
 */
export async function setMehrFlagAction(
  input: z.input<typeof flagSchema>,
): Promise<MehrActionResult> {
  const ctx = await requirePermission("settings.manage");

  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Noma'lum sozlama." };

  const { key, enabled } = parsed.data;
  const db = createSupabaseAdminClient();

  const { error } = await db
    .from("site_settings")
    .upsert(
      { key, value: enabled ? "true" : "false", updated_by: ctx.userId, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  if (error) {
    console.error("MEHR_FLAG_SET_FAILED", { code: error.code, message: error.message });
    return { ok: false, error: "Sozlamani saqlab bo'lmadi." };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "mehr.flag.changed",
    entityType: "site_setting",
    entityId: key,
    newValue: { enabled },
    // Xususiyat yoqilishi productionda ko'rinadigan o'zgarish.
    severity: "warning",
  });

  revalidate();
  return { ok: true, message: `${key} — ${enabled ? "yoqildi" : "o'chirildi"}.` };
}
