"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getSiteUrl } from "@/lib/site-url";
import { createActivation, revokeActivation } from "@/lib/accounts/activation-service";
import { activationUrl } from "@/lib/accounts/activation-token";

/**
 * Nomzod hisoblarini boshqarish.
 *
 * HAR BIR AMAL RUXSATNI SERVERDA TEKSHIRADI. Tugmani
 * yashirish — himoya emas: action'ni to'g'ridan-to'g'ri
 * chaqirib bo'ladi.
 */

export type AccountActionResult =
  | { ok: true; message: string; link?: string }
  | { ok: false; error: string };

const uuid = z.string().uuid();

function revalidate() {
  revalidatePath("/foydalanuvchilar");
}

/**
 * Faollashtirish havolasini yaratadi.
 *
 * Havola FAQAT SHU JAVOBDA qaytadi va hech qayerda
 * saqlanmaydi. Admin uni nusxalab, nomzodga o'zi yetkazadi —
 * bu parol EMAS, bir martalik va muddatli havola.
 */
export async function createActivationAction(candidateId: string): Promise<AccountActionResult> {
  const ctx = await requirePermission("members.manage");

  if (!uuid.safeParse(candidateId).success) {
    return { ok: false, error: "Nomzod ID noto'g'ri." };
  }

  const result = await createActivation(candidateId, { actorId: ctx.userId });

  if (!result.ok || !result.token) {
    switch (result.reason) {
      case "disabled":
        return {
          ok: false,
          error:
            "Faollashtirish o'chiq (member.account_activation_enabled). Avval sozlamalardan yoqing.",
        };
      case "candidate_not_found":
        return { ok: false, error: "Nomzod topilmadi." };
      case "already_linked":
        return { ok: false, error: "Bu nomzodda allaqachon hisob bor." };
      default:
        return { ok: false, error: "Havola yaratilmadi. Qaytadan urinib ko'ring." };
    }
  }

  revalidate();

  /*
   * Havola OMMAVIY SAYTGA ishora qiladi: nomzod u yerda
   * parolini qo'yadi. Admin panelga emas — oddiy nomzodning
   * admin panelda ishi yo'q.
   */
  return {
    ok: true,
    message: "Bir martalik havola tayyor. Uni nusxalab nomzodga yuboring.",
    link: activationUrl(getSiteUrl(), result.token),
  };
}

const revokeSchema = z.object({
  activationId: uuid,
  reason: z.string().trim().min(3, "Sababni yozing."),
});

export async function revokeActivationAction(
  input: z.input<typeof revokeSchema>,
): Promise<AccountActionResult> {
  const ctx = await requirePermission("members.manage");

  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma'lumot noto'g'ri." };
  }

  const result = await revokeActivation(parsed.data.activationId, parsed.data.reason, {
    actorId: ctx.userId,
  });

  revalidate();

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "not_found"
          ? "Havola topilmadi."
          : result.reason === "already_final"
            ? "Bu havola allaqachon ishlatilgan yoki bekor qilingan."
            : "Bekor qilishda xato.",
    };
  }

  return { ok: true, message: "Havola bekor qilindi." };
}

const blockSchema = z.object({
  profileId: uuid,
  reason: z.string().trim().min(3, "Sababni yozing."),
});

/**
 * Hisobni bloklaydi.
 *
 * BLOKLASH — KIRISHNI CHEKLASH, MA'LUMOTNI O'CHIRISH EMAS.
 * Nomzod sahifasi, maqolasi, MEHR tarixi, ball daftari va
 * sertifikatlari JOYIDA QOLADI. Bu farq muhim: bloklashni
 * o'chirish bilan aralashtirish qaytarib bo'lmas zarar
 * keltirardi.
 */
export async function blockAccountAction(
  input: z.input<typeof blockSchema>,
): Promise<AccountActionResult> {
  const ctx = await requirePermission("members.manage");

  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma'lumot noto'g'ri." };
  }

  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { error } = await db.from("member_accounts").upsert(
    {
      profile_id: parsed.data.profileId,
      status: "disabled",
      disabled_at: now,
      disabled_by: ctx.userId,
      disabled_reason: parsed.data.reason,
      updated_at: now,
    },
    { onConflict: "profile_id" },
  );

  if (error) {
    console.error("ACCOUNT_BLOCK_FAILED", { code: error.code, message: error.message });
    return { ok: false, error: "Bloklashda xato." };
  }

  await db.from("member_security_events").insert({
    profile_id: parsed.data.profileId,
    event_type: "account_disabled",
    actor: "admin",
    actor_user_id: ctx.userId,
    metadata: { reason: parsed.data.reason },
  });

  await logAudit({
    actorId: ctx.userId,
    action: "account.blocked",
    entityType: "profile",
    entityId: parsed.data.profileId,
    reason: parsed.data.reason,
    severity: "critical",
  });

  revalidate();
  return { ok: true, message: "Hisob bloklandi. Ma'lumotlari saqlanib qoldi." };
}

export async function restoreAccountAction(profileId: string): Promise<AccountActionResult> {
  const ctx = await requirePermission("members.manage");

  if (!uuid.safeParse(profileId).success) {
    return { ok: false, error: "Profil ID noto'g'ri." };
  }

  const db = createSupabaseAdminClient();

  /*
   * Shartli UPDATE: faqat bloklangan hisobni tiklaydi.
   * `disabled_reason` TARIXDA QOLADI — kim, qachon va nega
   * bloklagani keyin ham ko'rinib tursin.
   */
  const { data, error } = await db
    .from("member_accounts")
    .update({ status: "active", disabled_at: null, updated_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .eq("status", "disabled")
    .select("profile_id")
    .maybeSingle();

  if (error) {
    console.error("ACCOUNT_RESTORE_FAILED", { code: error.code, message: error.message });
    return { ok: false, error: "Tiklashda xato." };
  }
  if (!data) return { ok: false, error: "Bu hisob bloklanmagan." };

  await db.from("member_security_events").insert({
    profile_id: profileId,
    event_type: "account_restored",
    actor: "admin",
    actor_user_id: ctx.userId,
  });

  await logAudit({
    actorId: ctx.userId,
    action: "account.restored",
    entityType: "profile",
    entityId: profileId,
    severity: "warning",
  });

  revalidate();
  return { ok: true, message: "Hisob tiklandi." };
}

/**
 * Parolni tiklash havolasini yuboradi.
 *
 * ADMIN YANGI PAROLNI KO'RMAYDI va ko'ra olmaydi. Supabase
 * o'zining tiklash oqimini ishlatadi; bu yerda faqat
 * "yuborildi" degan fakt qoladi.
 */
export async function sendPasswordResetAction(profileId: string): Promise<AccountActionResult> {
  const ctx = await requirePermission("members.manage");

  if (!uuid.safeParse(profileId).success) {
    return { ok: false, error: "Profil ID noto'g'ri." };
  }

  const db = createSupabaseAdminClient();

  const { data: user, error: userError } = await db.auth.admin.getUserById(profileId);
  if (userError || !user?.user?.email) {
    return { ok: false, error: "Bu hisobda email topilmadi — tiklash havolasi yuborilmaydi." };
  }

  const { error } = await db.auth.resetPasswordForEmail(user.user.email, {
    redirectTo: `${getSiteUrl()}/kirish`,
  });

  if (error) {
    console.error("PASSWORD_RESET_FAILED", { message: error.message });
    return { ok: false, error: "Tiklash havolasini yuborib bo'lmadi." };
  }

  await db.from("member_security_events").insert({
    profile_id: profileId,
    event_type: "password_reset_requested",
    actor: "admin",
    actor_user_id: ctx.userId,
  });

  await logAudit({
    actorId: ctx.userId,
    action: "account.password_reset_sent",
    entityType: "profile",
    entityId: profileId,
    severity: "warning",
  });

  revalidate();
  return { ok: true, message: "Parolni tiklash havolasi email orqali yuborildi." };
}
