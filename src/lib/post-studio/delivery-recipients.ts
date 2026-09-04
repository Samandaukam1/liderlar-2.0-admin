import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Tahririyat manzillari — bitta sozlama, ikkita foydalanuvchi.
 *
 * Tayyor postlar ham, to'lov savollari ham shu ro'yxatga ketadi, shuning uchun
 * u alohida modulda turadi: telegram.ts (yetkazish) va intake/payment.ts
 * (to'lov) ikkalasi ham shu yerdan o'qiydi va bir-birini import qilmaydi.
 */

export const POST_DELIVERY_CHAT_IDS_KEY = "telegram_bot.post_delivery_chat_ids";

/**
 * Chats that automated posts and payment questions go to.
 *
 * Configured in site_settings as a JSON array of chat ids, so the editorial
 * recipients can be changed without a deploy and without touching code. An
 * empty list means "every active subscriber" for post delivery — the original
 * behaviour, kept so clearing the setting is a safe way back rather than a
 * silent blackout.
 */
export async function getPostDeliveryChatIds(): Promise<number[]> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("site_settings")
    .select("value")
    .eq("key", POST_DELIVERY_CHAT_IDS_KEY)
    .maybeSingle();

  const raw = (data?.value as string | undefined)?.trim();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[telegram] post_delivery_chat_ids JSON emas — barcha obunachilarga qaytildi");
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // Ids are stored as strings so a 64-bit chat id survives JSON without
  // precision loss; anything unparseable is dropped rather than sent to chat 0.
  return parsed
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isSafeInteger(n) && n !== 0);
}
