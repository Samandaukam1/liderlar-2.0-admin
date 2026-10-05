"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { cleanPermissions, parseTelegramId, TELEGRAM_ID_PROBLEM_TEXT } from "@/lib/bot-access/catalog";

/**
 * BOTLAR BOSHQARUVI — server amallari.
 *
 * Faqat `settings.manage` (super admin): bu yerda berilgan ruxsat to'lovni
 * tasdiqlash, qora ro'yxat va sotuv operatori kabi muhim amallarni ochadi.
 * Har o'zgarish audit jurnaliga eski va yangi qiymat bilan yoziladi.
 */

export interface BotAccessActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export interface BotAccessInput {
  id?: string | null;
  telegramId: string;
  displayName: string;
  note: string;
  permissions: string[];
  isActive: boolean;
  /** "Faqat o'z nomzodlari" rejimi. */
  ownOnly: boolean;
}

const PATH = "/botlar";

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Bu Telegram ID allaqachon ro‘yxatda — o‘sha qatorni tahrirlang.";
  return error.message;
}

export async function saveBotAccessAction(input: BotAccessInput): Promise<BotAccessActionResult> {
  const ctx = await requirePermission("settings.manage");

  const parsed = parseTelegramId(input.telegramId);
  if (!parsed.ok) return { ok: false, error: TELEGRAM_ID_PROBLEM_TEXT[parsed.problem] };
  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: "Ism yoki izoh nomini kiriting — ro‘yxatda kimligi ko‘rinsin." };
  if (displayName.length > 120) return { ok: false, error: "Ism 120 belgidan oshmasin." };
  const note = input.note.trim();
  if (note.length > 500) return { ok: false, error: "Izoh 500 belgidan oshmasin." };
  const permissions = cleanPermissions(input.permissions);

  const row = {
    telegram_id: parsed.id,
    display_name: displayName,
    note: note || null,
    permissions,
    is_active: input.isActive,
    own_only: input.ownOnly,
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  };

  const db = createSupabaseAdminClient();

  if (input.id) {
    const { data: before } = await db.from("bot_access").select("*").eq("id", input.id).maybeSingle();
    if (!before) return { ok: false, error: "Yozuv topilmadi — sahifani yangilang." };
    const { error } = await db.from("bot_access").update(row).eq("id", input.id);
    if (error) return { ok: false, error: friendly(error) };
    await logAudit({
      actorId: ctx.userId,
      action: "bot_access.update",
      entityType: "bot_access",
      entityId: input.id,
      oldValue: before,
      newValue: row,
      severity: "warning",
    });
    revalidatePath(PATH);
    return { ok: true, message: `${displayName} saqlandi.` };
  }

  const { data, error } = await db
    .from("bot_access")
    .insert({ ...row, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error) };
  await logAudit({
    actorId: ctx.userId,
    action: "bot_access.create",
    entityType: "bot_access",
    entityId: (data?.id as string | undefined) ?? null,
    newValue: row,
    severity: "warning",
  });
  revalidatePath(PATH);
  return { ok: true, message: `${displayName} qo‘shildi.` };
}

export async function setBotAccessActiveAction(id: string, isActive: boolean): Promise<BotAccessActionResult> {
  const ctx = await requirePermission("settings.manage");
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("bot_access")
    .update({ is_active: isActive, updated_by: ctx.userId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error) };
  await logAudit({
    actorId: ctx.userId,
    action: isActive ? "bot_access.enable" : "bot_access.disable",
    entityType: "bot_access",
    entityId: id,
    newValue: { is_active: isActive },
    severity: "warning",
  });
  revalidatePath(PATH);
  return { ok: true, message: isActive ? "Faollashtirildi." : "To‘xtatildi — bot bu odamga endi hech narsa ruxsat bermaydi." };
}

export async function deleteBotAccessAction(id: string): Promise<BotAccessActionResult> {
  const ctx = await requirePermission("settings.manage");
  const db = createSupabaseAdminClient();
  const { data: before } = await db.from("bot_access").select("*").eq("id", id).maybeSingle();
  if (!before) return { ok: false, error: "Yozuv topilmadi — sahifani yangilang." };
  const { error } = await db.from("bot_access").delete().eq("id", id);
  if (error) return { ok: false, error: friendly(error) };
  await logAudit({
    actorId: ctx.userId,
    action: "bot_access.delete",
    entityType: "bot_access",
    entityId: id,
    oldValue: before,
    severity: "warning",
  });
  revalidatePath(PATH);
  return { ok: true, message: "O‘chirildi." };
}
