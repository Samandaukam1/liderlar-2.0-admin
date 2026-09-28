"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { foldPromoCode } from "@/lib/promo/code-match";
import { normalizePromoCode } from "@/lib/coordinators/promo-code";
import { parseTashkentDateTime } from "@/lib/tashkent-day";

export type PromoActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function revalidate() {
  revalidatePath("/promo-kodlar");
}

const createSchema = z.object({
  rawCode: z.string().trim().min(1, "Kodni yozing").max(64, "Kod juda uzun"),
  label: z.string().trim().max(160).optional().transform((v) => (v ? v : null)),
  /** Bo'sh — muddatsiz. */
  expiresAt: z.string().trim().optional().transform((v) => (v ? v : "")),
  notes: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
});

export async function createPromoCodeAction(formData: FormData): Promise<PromoActionResult> {
  const ctx = await requirePermission("coordinators.manage");

  const parsed = createSchema.safeParse({
    rawCode: formData.get("rawCode") ?? "",
    label: formData.get("label") ?? "",
    expiresAt: formData.get("expiresAt") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  /*
   * IKKI SHAKL SAQLANADI.
   *
   * `code` — solishtirish uchun normallashtirilgan; `raw_code` —
   * admin yozgan ko'rinish. Faqat normallashtirilganini saqlasak,
   * panelda kod tanib bo'lmas holga kelardi ("TSUL-TAVSIYA"
   * o'rniga "TSULTAVSIYA").
   */
  const code = normalizePromoCode(parsed.data.rawCode);
  if (code === "") return { ok: false, error: "Kod bo‘sh bo‘lib qoldi." };

  /*
   * MUDDAT TOSHKENT VAQTIDA KIRITILADI.
   *
   * Bazada UTC saqlanadi. To'g'ridan-to'g'ri yozsak, admin
   * "bugun 18:00 da tugasin" deb belgilaganda kod besh soat
   * oldin tugab qolardi.
   */
  const expiresAt = parsed.data.expiresAt ? parseTashkentDateTime(parsed.data.expiresAt) : null;
  if (parsed.data.expiresAt && !expiresAt) {
    return { ok: false, error: "Muddat sanasi noto‘g‘ri." };
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("promo_codes")
    .insert({
      code,
      raw_code: parsed.data.rawCode,
      label: parsed.data.label,
      notes: parsed.data.notes,
      expires_at: expiresAt,
      created_by: ctx.userId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Unikal indeks — kod allaqachon ro'yxatda.
    if (error.code === "23505") return { ok: false, error: "Bu kod allaqachon ro‘yxatda." };
    return { ok: false, error: error.message };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "promo_code.created",
    entityType: "promo_code",
    entityId: data?.id ?? null,
    newValue: { code, expiresAt },
  });

  revalidate();
  return { ok: true, message: expiresAt ? "Kod qo‘shildi (muddatli)." : "Kod qo‘shildi." };
}

const idSchema = z.string().uuid();

/**
 * Amal qilish muddatini HOZIR tugatadi.
 *
 * Qator o'chirilmaydi: keyin "bu kod qachon va kim tomonidan
 * yopilgan?" degan savolga javob kerak bo'ladi va arizalardagi
 * eski kodlar ham shu qatorga ishora qiladi.
 */
export async function expirePromoCodeAction(formData: FormData): Promise<PromoActionResult> {
  const ctx = await requirePermission("coordinators.manage");
  const id = String(formData.get("id") ?? "");
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Noto‘g‘ri identifikator" };

  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("promo_codes")
    .update({ expires_at: now })
    .eq("id", id)
    .select("code")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "promo_code.expired",
    entityType: "promo_code",
    entityId: id,
    newValue: { expiresAt: now },
    // Kod endi arizalarda rad etiladi — bu diqqat talab qiladigan o'zgarish.
    severity: "warning",
  });

  revalidate();
  return { ok: true, message: `«${data?.code ?? "Kod"}» endi amal qilmaydi.` };
}

/** Muddatni olib tashlaydi — kod yana ishlay boshlaydi. */
export async function reopenPromoCodeAction(formData: FormData): Promise<PromoActionResult> {
  const ctx = await requirePermission("coordinators.manage");
  const id = String(formData.get("id") ?? "");
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Noto‘g‘ri identifikator" };

  const db = createSupabaseAdminClient();
  const { error } = await db.from("promo_codes").update({ expires_at: null }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "promo_code.reopened",
    entityType: "promo_code",
    entityId: id,
    severity: "warning",
  });

  revalidate();
  return { ok: true, message: "Kod yana amal qiladi." };
}

/** Ro'yxatdan olib tashlaydi (qator saqlanadi, faolsiz bo'ladi). */
export async function deactivatePromoCodeAction(formData: FormData): Promise<PromoActionResult> {
  const ctx = await requirePermission("coordinators.manage");
  const id = String(formData.get("id") ?? "");
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Noto‘g‘ri identifikator" };

  const db = createSupabaseAdminClient();
  const { error } = await db.from("promo_codes").update({ is_active: false }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "promo_code.deactivated",
    entityType: "promo_code",
    entityId: id,
    severity: "warning",
  });

  revalidate();
  return { ok: true, message: "Ro‘yxatdan olindi." };
}

/**
 * Kiritilgan matn qaysi kodga mos kelishini KO'RSATADI.
 *
 * Admin "TSULTAVSIYASIYA deb yozsa ham to'siladimi?" degan
 * savolga panelda javob olishi kerak — aks holda saxiy
 * moslashtirishga ishonish qiyin.
 */
export async function previewPromoMatchAction(
  input: string,
): Promise<{ fold: string; matches: Array<{ code: string; expired: boolean }> }> {
  await requirePermission("coordinators.view");

  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("promo_codes")
    .select("code, raw_code, expires_at")
    .eq("is_active", true);

  const { looksLikeSameCode } = await import("@/lib/promo/code-match");
  const now = Date.now();

  const matches = (data ?? [])
    .filter((row) => looksLikeSameCode(row.code as string, input))
    .map((row) => ({
      code: (row.raw_code as string) ?? (row.code as string),
      expired:
        row.expires_at != null && new Date(row.expires_at as string).getTime() <= now,
    }));

  return { fold: foldPromoCode(input), matches };
}
