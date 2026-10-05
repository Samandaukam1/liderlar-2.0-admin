import "server-only";
import { getChatIdsWithPermission } from "@/lib/bot-access/service";

/**
 * Tahririyat manzillari.
 *
 * Har bildirishnoma o'z ruxsatiga ega (postlar, to'lovlar, kanal, avto-tuzatish)
 * va panelda alohida beriladi. Bu modul faqat post yetkazish ro'yxatini beradi;
 * qolganlari `getChatIdsWithPermission` bilan to'g'ridan-to'g'ri o'qiydi.
 */

/** Eski kalit — endi o'qilmaydi, faqat ko'chirish migratsiyasi uchun. */
export const POST_DELIVERY_CHAT_IDS_KEY = "telegram_bot.post_delivery_chat_ids";

/**
 * Chats that automated posts go to.
 *
 * Endi panelning "Botlar boshqaruvi" bo'limidan (`bot_access`, ruxsat
 * `studio.posts`) o'qiladi — yangi muharrir migratsiyasiz qo'shiladi.
 * `site_settings` dagi eski kalit faqat bir martalik ko'chirish uchun
 * qoldi (20261005120000_bot_access.sql).
 *
 * An empty list still means "every active subscriber" for post delivery — the
 * original behaviour. A database error THROWS instead of returning an empty
 * list, so a failed read can never turn into a broadcast.
 */
export async function getPostDeliveryChatIds(): Promise<number[]> {
  return getChatIdsWithPermission("studio.posts");
}
