"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { COORDINATOR_SETTING_KEYS } from "@/lib/coordinators/settings";
import { ensureLeadIntakeSince } from "@/lib/coordinators/lead-intake";

/**
 * KOORDINATOR BOSHQARUVI.
 *
 * TELEGRAM RAQAMLI ID — asosiy identifikator. Username o'zgaradi va
 * bo'shagan nomni boshqa odam egallashi mumkin; raqamli id esa
 * akkauntning o'zgarmas belgisi. Shuning uchun unikallik AYNAN
 * shu ustunda tekshiriladi.
 */

export type CoordinatorActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function revalidate() {
  revalidatePath("/koordinatorlar");
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v !== "" ? v : null));

const coordinatorSchema = z.object({
  fullName: z.string().trim().min(3, "F.I.Sh. juda qisqa").max(160),
  photoUrl: optionalText(500),
  regionId: z.string().uuid("Hududni tanlang"),
  phone: optionalText(32),
  publicPhone: optionalText(32),
  showPhonePublicly: z.boolean(),
  publicEmail: optionalText(160),
  bio: optionalText(600),
  /**
   * Telegram raqamli id. Ixtiyoriy: koordinatorni avval kiritib,
   * botga keyin ulash mumkin. Lekin usiz u lid OLMAYDI va panel
   * buni ochiq ko'rsatadi.
   */
  telegramUserId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v !== "" ? v : null))
    .refine((v) => v === null || /^\d{5,15}$/.test(v), "Telegram ID faqat raqamlardan iborat"),
  telegramUsername: optionalText(64),
  status: z.enum(["active", "paused", "offline", "suspended"]),
  backupPriority: z.coerce.number().int().min(0).max(9999),
  dailyLeadLimit: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v !== "" ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0 && v <= 1000), "Chegara 1–1000"),
  notes: optionalText(1000),
});

function parseForm(formData: FormData) {
  return coordinatorSchema.safeParse({
    fullName: formData.get("fullName") ?? "",
    photoUrl: formData.get("photoUrl") ?? "",
    regionId: formData.get("regionId") ?? "",
    phone: formData.get("phone") ?? "",
    publicPhone: formData.get("publicPhone") ?? "",
    showPhonePublicly: formData.get("showPhonePublicly") === "on",
    publicEmail: formData.get("publicEmail") ?? "",
    bio: formData.get("bio") ?? "",
    telegramUserId: formData.get("telegramUserId") ?? "",
    telegramUsername: formData.get("telegramUsername") ?? "",
    status: formData.get("status") ?? "active",
    backupPriority: formData.get("backupPriority") ?? 100,
    dailyLeadLimit: formData.get("dailyLeadLimit") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

/** Telegram id boshqa FAOL koordinatorda bandmi. */
async function telegramIdTaken(
  telegramUserId: string,
  excludeId: string | null,
): Promise<boolean> {
  const db = createSupabaseAdminClient();
  let query = db
    .from("coordinators")
    .select("id")
    .eq("telegram_user_id", Number(telegramUserId))
    .eq("is_active", true);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.limit(1);
  return (data?.length ?? 0) > 0;
}

function toRow(data: z.infer<typeof coordinatorSchema>) {
  return {
    full_name: data.fullName,
    photo_url: data.photoUrl,
    region_id: data.regionId,
    phone: data.phone,
    public_phone: data.publicPhone,
    show_phone_publicly: data.showPhonePublicly,
    public_email: data.publicEmail,
    bio: data.bio,
    telegram_user_id: data.telegramUserId ? Number(data.telegramUserId) : null,
    telegram_username: data.telegramUsername,
    status: data.status,
    backup_priority: data.backupPriority,
    daily_lead_limit: data.dailyLeadLimit,
    notes: data.notes,
  };
}

export async function createCoordinatorAction(
  formData: FormData,
): Promise<CoordinatorActionResult> {
  const ctx = await requirePermission("coordinators.manage");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }

  if (parsed.data.telegramUserId && (await telegramIdTaken(parsed.data.telegramUserId, null))) {
    // Aks holda bot bir odamni ikki koordinator deb bilib, lidni
    // ikki marta taklif qilardi.
    return { ok: false, error: "Bu Telegram ID boshqa faol koordinatorga biriktirilgan." };
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("coordinators")
    .insert({ ...toRow(parsed.data), is_active: true })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "coordinator.created",
    entityType: "coordinator",
    entityId: data?.id ?? null,
    newValue: { fullName: parsed.data.fullName, regionId: parsed.data.regionId },
  });

  revalidate();
  return { ok: true, message: "Koordinator qo‘shildi." };
}

export async function updateCoordinatorAction(
  formData: FormData,
): Promise<CoordinatorActionResult> {
  const ctx = await requirePermission("coordinators.manage");
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Noto‘g‘ri identifikator" };
  }

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Forma xatosi" };
  }
  if (parsed.data.telegramUserId && (await telegramIdTaken(parsed.data.telegramUserId, id))) {
    return { ok: false, error: "Bu Telegram ID boshqa faol koordinatorga biriktirilgan." };
  }

  const db = createSupabaseAdminClient();
  const { data: before } = await db
    .from("coordinators")
    .select("region_id, telegram_user_id, status")
    .eq("id", id)
    .maybeSingle();

  const { error } = await db.from("coordinators").update(toRow(parsed.data)).eq("id", id);
  if (error) return { ok: false, error: error.message };

  /*
   * HUDUD VA TELEGRAM ID O'ZGARISHI ALOHIDA YOZILADI.
   *
   * Ikkalasi ham kimga lid ketishini o'zgartiradi. Keyin "nega bu
   * lid bu odamga ketdi?" degan savol tug'ilsa, javob audit
   * jurnalida bo'lishi kerak.
   */
  await logAudit({
    actorId: ctx.userId,
    action:
      before?.region_id !== parsed.data.regionId
        ? "coordinator.region_changed"
        : String(before?.telegram_user_id ?? "") !== String(parsed.data.telegramUserId ?? "")
          ? "coordinator.telegram_changed"
          : "coordinator.updated",
    entityType: "coordinator",
    entityId: id,
    oldValue: before ?? undefined,
    newValue: {
      regionId: parsed.data.regionId,
      status: parsed.data.status,
      hasTelegram: Boolean(parsed.data.telegramUserId),
    },
  });

  revalidate();
  return { ok: true, message: "Saqlandi." };
}

const STATUS_LABELS: Record<string, string> = {
  active: "faol",
  paused: "pauzada",
  offline: "oflayn",
  suspended: "to‘xtatilgan",
};

/** Holatni o'zgartirish — pauza, davom ettirish, to'xtatish. */
export async function setCoordinatorStatusAction(
  formData: FormData,
): Promise<CoordinatorActionResult> {
  const ctx = await requirePermission("coordinators.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Noto‘g‘ri identifikator" };
  }
  if (!["active", "paused", "offline", "suspended"].includes(status)) {
    return { ok: false, error: "Noto‘g‘ri holat" };
  }

  const db = createSupabaseAdminClient();
  const { error } = await db.from("coordinators").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: status === "active" ? "coordinator.activated" : "coordinator.paused",
    entityType: "coordinator",
    entityId: id,
    newValue: { status },
  });

  revalidate();
  return { ok: true, message: `Holat: ${STATUS_LABELS[status]}.` };
}

/**
 * Deaktivatsiya — O'CHIRISH EMAS.
 *
 * Koordinator yozuvi sotuvlar va komissiyalar bilan bog'langan.
 * Uni o'chirish tarixni buzardi: kim sotgani noma'lum bo'lib
 * qolardi va to'langan komissiyalar egasiz qolardi.
 */
export async function deactivateCoordinatorAction(
  formData: FormData,
): Promise<CoordinatorActionResult> {
  const ctx = await requirePermission("coordinators.manage");
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Noto‘g‘ri identifikator" };
  }

  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("coordinators")
    .update({
      is_active: false,
      status: "suspended",
      deactivated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: ctx.userId,
    action: "coordinator.deactivated",
    entityType: "coordinator",
    entityId: id,
  });

  revalidate();
  return { ok: true, message: "Koordinator deaktivatsiya qilindi (yozuv saqlandi)." };
}

/* ------------------------- marshrutlashni yoqish ------------------------- */

/**
 * MARSHRUTLASHNI YOQISH — FAQAT ANIQ HARAKAT BILAN.
 *
 * Deploy uni yoqmaydi va yoqa olmaydi ham: qiymat bazada turadi.
 * Yoqishdan oldin tayyorlik tekshiriladi — koordinatorsiz yoqilgan
 * marshrutlash lidlarni hech kimga bormaydigan navbatga qo'yardi.
 */
export async function setRoutingEnabledAction(
  formData: FormData,
): Promise<CoordinatorActionResult> {
  const ctx = await requirePermission("coordinators.manage");
  const enabled = String(formData.get("enabled") ?? "") === "true";

  if (enabled) {
    const db = createSupabaseAdminClient();
    const { data } = await db
      .from("coordinators")
      .select("id")
      .eq("is_active", true)
      .eq("status", "active")
      .not("telegram_user_id", "is", null)
      .not("region_id", "is", null)
      .limit(1);

    if ((data?.length ?? 0) === 0) {
      return {
        ok: false,
        error:
          "Yoqib bo‘lmaydi: hududi va Telegram ID’si bor kamida bitta faol koordinator kerak.",
      };
    }
  }

  const db = createSupabaseAdminClient();
  const { error } = await db.from("site_settings").upsert(
    { key: COORDINATOR_SETTING_KEYS.routingEnabled, value: enabled ? "true" : "false" },
    { onConflict: "key" },
  );
  if (error) return { ok: false, error: error.message };

  /*
   * BIRINCHI YOQISHDA boshlanish nuqtasi yoziladi.
   *
   * Usiz cron bazadagi minglab eski arizani navbatga qo'yardi va
   * koordinatorlarga yillar oldingi murojaatlar yog'ilardi. Bu
   * qiymat bir marta yoziladi va keyin o'zgarmaydi — o'chirib
   * qayta yoqish tarixni qaytadan ochib yubormaydi.
   */
  if (enabled) await ensureLeadIntakeSince();

  await logAudit({
    actorId: ctx.userId,
    action: enabled ? "coordinator.routing_enabled" : "coordinator.routing_disabled",
    entityType: "site_settings",
    entityId: COORDINATOR_SETTING_KEYS.routingEnabled,
    newValue: { enabled },
    severity: enabled ? "warning" : "info",
  });

  revalidate();
  return {
    ok: true,
    message: enabled
      ? "Marshrutlash yoqildi — yangi lidlar koordinatorlarga yuboriladi."
      : "Marshrutlash o‘chirildi.",
  };
}

/** Kunlik talabni belgilash. */
export async function setDailyTargetAction(
  formData: FormData,
): Promise<CoordinatorActionResult> {
  const ctx = await requirePermission("coordinators.manage");
  const target = Number(formData.get("target") ?? NaN);
  const date = String(formData.get("date") ?? "").trim();

  if (!Number.isInteger(target) || target < 0 || target > 10_000) {
    return { ok: false, error: "Talab 0–10000 oralig‘ida butun son bo‘lsin" };
  }
  if (date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Sana YYYY-MM-DD shaklida" };
  }

  const db = createSupabaseAdminClient();

  /*
   * Sana berilmasa — STANDART qiymat (barcha kunlar). Berilsa —
   * faqat o'sha kun. Kechagi natija kechagi talab bilan
   * baholanishi uchun tarix qayta yozilmaydi.
   *
   * UPSERT ISHLATILMAYDI: unikal indeks `coalesce(...)` ifodasi
   * ustida qurilgan (NULL sana va NULL hudud ham yagona bo'lishi
   * kerak), PostgREST'ning `onConflict` esa faqat oddiy ustunlar
   * bilan ishlaydi. Shuning uchun avval yangilash, keyin qo'shish.
   */
  const targetDate = date === "" ? null : date;
  let query = db
    .from("coordinator_daily_targets")
    .update({ target_sales: target, created_by: ctx.userId })
    .is("region_id", null);
  query = targetDate === null ? query.is("target_date", null) : query.eq("target_date", targetDate);

  const { data: updated, error: updateError } = await query.select("id");
  if (updateError) return { ok: false, error: updateError.message };

  if ((updated?.length ?? 0) === 0) {
    const { error } = await db.from("coordinator_daily_targets").insert({
      target_date: targetDate,
      region_id: null,
      target_sales: target,
      created_by: ctx.userId,
    });
    if (error) return { ok: false, error: error.message };
  }

  await logAudit({
    actorId: ctx.userId,
    action: "coordinator.target_changed",
    entityType: "coordinator_daily_targets",
    newValue: { date: date || "standart", target },
  });

  revalidate();
  return { ok: true, message: `Kunlik talab: ${target}.` };
}
