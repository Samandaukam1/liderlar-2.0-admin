"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import {
  applyAdminAction,
  createSubscription,
  type ActionResult,
} from "@/lib/vip/subscription-service";
import type { AdminAction } from "@/lib/vip/subscription-rules";
import { recordAudit } from "@/lib/vip/audit-log";

/**
 * VIP OBUNA AMALLARI.
 *
 * Har bir amal `vip.manage` ruxsatini TALAB qiladi va u SERVERDA
 * tekshiriladi. Panelda tugmani yashirish avtorizatsiya emas: server
 * amali to'g'ridan-to'g'ri chaqirilishi mumkin.
 *
 * AKTYOR BRAUZERDAN OLINMAYDI. `requirePermission` qaytargan
 * kontekstdagi foydalanuvchi ishlatiladi — aks holda admin boshqa
 * odamning nomidan amal yozib qo'yardi (§44).
 */

export type VipActionResult = ActionResult | { ok: false; error: string };

/**
 * Obuna yaratadi — `pending` holatda.
 *
 * Darhol faollashtirmaydi: to'lov tasdiqlanmaguncha huquq
 * berilmasligi kerak, lekin obuna allaqachon ko'rinib turadi va
 * admin uni kuzatishi mumkin.
 */
export async function createVipSubscription(
  profileId: string,
  planCode: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requirePermission("vip.manage");

  if (!isUuid(profileId)) return { ok: false, error: "Foydalanuvchi tanlanmagan." };
  if (!planCode.trim()) return { ok: false, error: "Tarif tanlanmagan." };

  const result = await createSubscription(profileId, planCode.trim(), ctx.userId);
  if (result.ok) revalidatePath("/vip");
  return result;
}

/**
 * Faollashtirish / uzaytirish / to'xtatish / bekor qilish / tiklash.
 *
 * BITTA kirish nuqtasi: har amal uchun alohida action bo'lsa, ruxsat
 * tekshiruvi yoki sabab talabi biror joyda esdan chiqib ketardi.
 */
export async function runVipAction(input: {
  action: AdminAction;
  profileId: string;
  reason: string;
  days?: number;
}): Promise<VipActionResult> {
  const ctx = await requirePermission("vip.manage");

  if (!isUuid(input.profileId)) {
    return { ok: false, error: "Foydalanuvchi tanlanmagan." };
  }

  /*
   * KUNLAR SONINI SHU YERDA ham tekshiramiz.
   *
   * Qoida modulida ham tekshiriladi, lekin u `number` kutadi —
   * brauzerdan esa matn kelishi mumkin va `NaN` jimgina o'tib
   * ketardi.
   */
  let days: number | undefined;
  if (input.action === "extend") {
    days = Number(input.days);
    if (!Number.isFinite(days)) {
      return { ok: false, error: "Uzaytirish kunlarini raqam bilan kiriting." };
    }
  }

  const result = await applyAdminAction(input.action, {
    profileId: input.profileId,
    actorId: ctx.userId,
    reason: input.reason,
    days,
  });

  if (result.ok) revalidatePath("/vip");
  return result;
}

/**
 * Feature flagni yoqadi/o'chiradi.
 *
 * `vip.manage` emas, `settings.manage` TALAB QILINADI: flag butun
 * tizimning chiqarish holatini o'zgartiradi va bu bitta odamning
 * obunasini boshqarishdan boshqa mas'uliyat.
 */
export async function setFeatureFlag(
  key: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermission("settings.manage");

  if (typeof key !== "string" || typeof enabled !== "boolean") {
    return { ok: false, error: "So'rov noto'g'ri." };
  }

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const db = createSupabaseAdminClient();

  /*
   * OLDINGI QIYMAT O'QILADI — jurnal uchun.
   *
   * Flag butun tizimning chiqarish holatini o'zgartiradi (§41, §67):
   * "kim, qachon, nimadan nimaga" degan savolga javob bo'lishi shart.
   */
  const { data: before, error: readError } = await db
    .from("feature_flags")
    .select("key, is_enabled")
    .eq("key", key)
    .maybeSingle();

  if (readError) {
    console.error("[vip] flag o'qilmadi:", readError.message);
    return { ok: false, error: "Flagni o'qib bo'lmadi." };
  }
  if (!before) return { ok: false, error: "Bunday flag yo'q." };

  /*
   * `update`, `upsert` EMAS.
   *
   * Upsert noma'lum kalitni yaratib qo'yardi — ya'ni xato yozilgan
   * flag jimgina paydo bo'lib, hech narsani boshqarmay turardi.
   * Mavjud flaglar migratsiyada seed qilingan.
   */
  const { data, error } = await db
    .from("feature_flags")
    .update({ is_enabled: enabled, updated_by: ctx.userId })
    .eq("key", key)
    .select("key")
    .maybeSingle();

  if (error) {
    console.error("[vip] flag yozilmadi:", error.message);
    return { ok: false, error: "Flagni saqlab bo'lmadi." };
  }
  if (!data) return { ok: false, error: "Bunday flag yo'q." };

  // Qiymat o'zgarmagan bo'lsa (takroriy bosish), jurnal to'ldirilmaydi.
  if (before.is_enabled !== enabled) {
    await recordAudit("feature_flag.updated", {
      actorId: ctx.userId,
      entityId: key,
      before: { enabled: before.is_enabled === true },
      after: { enabled },
    });
  }

  revalidatePath("/vip");
  return { ok: true };
}

/** Brauzerdan kelgan id shaklini tekshiradi. */
function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
