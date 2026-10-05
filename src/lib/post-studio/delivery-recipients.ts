/**
 * Tahririyat manzillari — ESKI KALIT.
 *
 * Ilgari tayyor postlar va to'lov savollari shu `site_settings` kalitidagi
 * JSON ro'yxatga ketardi. Endi har bildirishnoma panelning "Botlar
 * boshqaruvi" bo'limidan (`bot_access`) o'z ruxsati bilan o'qiladi —
 * src/lib/bot-access/service.ts. Kalit faqat bir martalik ko'chirish
 * migratsiyasi (20261005120000_bot_access.sql) va sozlamalar ro'yxati
 * uchun qoldi.
 */
export const POST_DELIVERY_CHAT_IDS_KEY = "telegram_bot.post_delivery_chat_ids";
