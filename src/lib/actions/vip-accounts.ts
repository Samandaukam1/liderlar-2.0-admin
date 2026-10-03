"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { resolveExtension, resolveGrantWindow } from "@/lib/vip/admin-grant";
import { applyAdminAction, extendVipTo, grantVip } from "@/lib/vip/subscription-service";

/**
 * "Foydalanuvchi akkauntlari" bo'limidagi VIP boshqaruvi.
 *
 * HAR AMAL RUXSATNI SERVERDA TEKSHIRADI (`vip.manage`) — tugmani
 * yashirish himoya emas. Aktyor brauzerdan olinmaydi: `requirePermission`
 * qaytargan seans egasi jurnalga yoziladi.
 *
 * Sana va muddat hisobi `admin-grant.ts` da (testlangan), holat
 * o'tishlari `subscription-rules.ts` da. Bu yerda faqat kiritishni
 * tekshirish va chaqirish.
 */

export type VipAccountResult = { ok: true; message: string } | { ok: false; error: string };

const profileId = z.string().uuid("Profil ID noto'g'ri.");
const reason = z.string().trim().min(3, "Izoh yozing (kamida 3 belgi).").max(500);
const optionalDays = z.number().int().nullable().optional();
const optionalDate = z.string().trim().nullable().optional();

function revalidate() {
  revalidatePath("/foydalanuvchilar");
  revalidatePath("/vip");
}

const grantSchema = z.object({
  profileId,
  startDate: z.string().trim(),
  days: optionalDays,
  endDate: optionalDate,
  reason,
});

/** VIP yoqish: boshlanish sanasi + (N kun | aniq tugash sanasi). */
export async function grantVipAction(input: z.input<typeof grantSchema>): Promise<VipAccountResult> {
  const ctx = await requirePermission("vip.manage");

  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma'lumot noto'g'ri." };
  }

  const window = resolveGrantWindow(parsed.data, new Date());
  if (!window.ok) return { ok: false, error: window.error };

  const result = await grantVip({
    profileId: parsed.data.profileId,
    startedAt: window.startedAt,
    periodEnd: window.periodEnd,
    days: window.days,
    reason: parsed.data.reason,
    actorId: ctx.userId,
  });

  if (!result.ok) return result;
  revalidate();
  return { ok: true, message: `VIP yoqildi (${window.days} kun).` };
}

const extendSchema = z.object({
  profileId,
  days: optionalDays,
  endDate: optionalDate,
  reason,
});

/** Uzaytirish: N kun (joriy tugashdan) yoki aniq sanagacha. */
export async function extendVipAction(input: z.input<typeof extendSchema>): Promise<VipAccountResult> {
  const ctx = await requirePermission("vip.manage");

  const parsed = extendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma'lumot noto'g'ri." };
  }

  const extension = resolveExtension(parsed.data);
  if (!extension.ok) return { ok: false, error: extension.error };

  const result =
    extension.kind === "days"
      ? await applyAdminAction("extend", {
          profileId: parsed.data.profileId,
          actorId: ctx.userId,
          reason: parsed.data.reason,
          days: extension.days,
        })
      : await extendVipTo({
          profileId: parsed.data.profileId,
          newEnd: extension.newEnd,
          reason: parsed.data.reason,
          actorId: ctx.userId,
        });

  if (!result.ok) return result;
  revalidate();
  return { ok: true, message: "VIP muddati uzaytirildi." };
}

const disableSchema = z.object({ profileId, reason });

/**
 * VIPni o'chirish.
 *
 * FAQAT VIP IMKONIYATLARI YOPILADI. Profil, maqolalar, sertifikatlar,
 * ball va tavsiya tarixi, tanlangan dizayn JOYIDA QOLADI va oddiy
 * akkaunt bloklanmaydi — obuna `cancelled` holatiga o'tadi, xolos.
 */
export async function disableVipAction(input: z.input<typeof disableSchema>): Promise<VipAccountResult> {
  const ctx = await requirePermission("vip.manage");

  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma'lumot noto'g'ri." };
  }

  const result = await applyAdminAction("cancel", {
    profileId: parsed.data.profileId,
    actorId: ctx.userId,
    reason: parsed.data.reason,
  });

  if (!result.ok) return result;
  revalidate();
  return { ok: true, message: "VIP o'chirildi. Profil va ma'lumotlar saqlanib qoldi." };
}
