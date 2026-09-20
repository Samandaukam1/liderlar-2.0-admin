"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import {
  approveMehrActivity,
  rejectMehrActivity,
  revokeCertificate,
} from "@/lib/mehr/approval-service";

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
