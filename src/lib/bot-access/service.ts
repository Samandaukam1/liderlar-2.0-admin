import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chatIdsWith, permissionsOf, type BotAccessRow, type BotPermission } from "./catalog";

/**
 * BOTLAR BOSHQARUVI — bazadan o'qish.
 *
 * Har chaqiruv yangi o'qiydi (kesh yo'q): panelda ruxsat olib tashlansa,
 * keyingi tugma bosishdayoq kuchga kirishi kerak. Jadval kichik (o'nlab
 * qator), so'rov arzon.
 */

const COLUMNS = "telegram_id, permissions, is_active";

/**
 * Shu ruxsatga ega faol chatlar.
 *
 * Baza o'qilmasa XATO tashlaydi, bo'sh ro'yxat qaytarmaydi: post
 * yetkazishda bo'sh ro'yxat "barcha obunachilarga" degani, ya'ni jim
 * qaytarilgan bo'sh ro'yxat tahririyat postini minglab odamga yuborardi.
 */
export async function getChatIdsWithPermission(permission: BotPermission): Promise<number[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("bot_access")
    .select(COLUMNS)
    .eq("is_active", true)
    .contains("permissions", [permission]);
  if (error) throw new Error(`bot_access o‘qilmadi: ${error.message}`);
  return chatIdsWith((data ?? []) as BotAccessRow[], permission);
}

/**
 * Bitta chatning ruxsatlari.
 *
 * Xatoda BO'SH to'plam: bot tugmasi bosilganda baza javob bermasa,
 * ruxsat berib yuborishdan ko'ra rad etish xavfsiz.
 */
export async function getChatPermissions(chatId: number): Promise<Set<BotPermission>> {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("bot_access")
      .select(COLUMNS)
      .eq("telegram_id", chatId)
      .eq("is_active", true)
      .limit(1);
    if (error) throw new Error(error.message);
    return permissionsOf((data ?? []) as BotAccessRow[], chatId);
  } catch (err) {
    console.error("[bot-access] ruxsatlar o‘qilmadi — rad etildi", err instanceof Error ? err.message : err);
    return new Set();
  }
}
