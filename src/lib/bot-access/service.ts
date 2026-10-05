import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { audienceFor, chatIdsWith, permissionsOf, type BotAccessRow, type BotPermission } from "./catalog";
import type { LinkOwner } from "./owner-note";

/**
 * BOTLAR BOSHQARUVI — bazadan o'qish.
 *
 * Har chaqiruv yangi o'qiydi (kesh yo'q): panelda ruxsat olib tashlansa,
 * keyingi tugma bosishdayoq kuchga kirishi kerak. Jadval kichik (o'nlab
 * qator), so'rov arzon.
 */

const COLUMNS = "telegram_id, permissions, is_active, own_only";

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
 * Bitta chatning ruxsatlari va rejimi.
 *
 * Xatoda BO'SH to'plam: bot tugmasi bosilganda baza javob bermasa,
 * ruxsat berib yuborishdan ko'ra rad etish xavfsiz.
 */
export async function getChatAccess(chatId: number): Promise<{ permissions: Set<BotPermission>; ownOnly: boolean }> {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("bot_access")
      .select(COLUMNS)
      .eq("telegram_id", chatId)
      .eq("is_active", true)
      .limit(1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as BotAccessRow[];
    return { permissions: permissionsOf(rows, chatId), ownOnly: Boolean(rows[0]?.own_only) };
  } catch (err) {
    console.error("[bot-access] ruxsatlar o‘qilmadi — rad etildi", err instanceof Error ? err.message : err);
    return { permissions: new Set(), ownOnly: false };
  }
}

/* ========================================================================= *
 * NOMZODGA BOG'LIQ XABARLAR — kimga
 * ========================================================================= */

export interface Audience {
  /** Shu ruxsat kamida bitta faol odamga berilganmi. */
  configured: boolean;
  /** Anketa havolasini yaratgan chatga qarab qabul qiluvchilar. */
  forCreator(creator: number | null): number[];
}

/**
 * Bitta o'qish — butun sweep uchun. Xatoda XATO tashlaydi (yuqoridagi
 * sabab bilan: bo'sh ro'yxat post yetkazishda "hammaga" degani).
 */
export async function getAudience(permission: BotPermission): Promise<Audience> {
  const { data, error } = await createSupabaseAdminClient()
    .from("bot_access")
    .select(COLUMNS)
    .eq("is_active", true)
    .contains("permissions", [permission]);
  if (error) throw new Error(`bot_access o‘qilmadi: ${error.message}`);
  const rows = (data ?? []) as BotAccessRow[];
  return {
    configured: rows.length > 0,
    forCreator: (creator) => audienceFor(rows, permission, creator),
  };
}

/** Anketa havolasini bot orqali yaratgan chat; panelda yaratilgan bo'lsa `null`. */
export async function getIntakeCreator(intakeId: string): Promise<number | null> {
  const { data } = await createSupabaseAdminClient()
    .from("candidate_intakes")
    .select("created_by_telegram_id")
    .eq("id", intakeId)
    .maybeSingle();
  const value = data?.created_by_telegram_id;
  return value == null ? null : Number(value);
}

/** Nomzodning anketasini yaratgan chat (eng yangi anketa bo'yicha). */
export async function getCandidateCreator(candidateId: string): Promise<number | null> {
  const { data } = await createSupabaseAdminClient()
    .from("candidate_intakes")
    .select("created_by_telegram_id")
    .eq("candidate_id", candidateId)
    .not("created_by_telegram_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const value = data?.[0]?.created_by_telegram_id;
  return value == null ? null : Number(value);
}

/**
 * Havolani yaratgan odam — "Botlar boshqaruvi"dagi nomi bilan.
 *
 * To'xtatilgan yozuv ham olinadi: bu ruxsat emas, tarix. Yozuv o'chirilgan
 * yoki baza javob bermasa — nomsiz (izoh Telegram ID bilan chiqadi), xabar
 * esa baribir ketadi.
 */
export async function getLinkOwner(creator: number | null): Promise<LinkOwner | null> {
  if (creator == null) return null;
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("bot_access")
      .select("display_name")
      .eq("telegram_id", creator)
      .limit(1);
    if (error) throw new Error(error.message);
    return { telegramId: creator, name: (data?.[0]?.display_name as string | undefined) ?? null };
  } catch (err) {
    console.error("[bot-access] havola egasi o‘qilmadi", err instanceof Error ? err.message : err);
    return { telegramId: creator, name: null };
  }
}

/** Shu chat bot orqali yaratgan anketalar — "faqat o'zinikilar" ro'yxatlari uchun. */
export async function getOwnIntakeIds(chatId: number): Promise<string[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("candidate_intakes")
    .select("id")
    .eq("created_by_telegram_id", chatId)
    .is("deleted_at", null);
  if (error) throw new Error(`anketalar o‘qilmadi: ${error.message}`);
  return (data ?? []).map((row) => row.id as string);
}
