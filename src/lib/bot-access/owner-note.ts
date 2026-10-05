/**
 * "KIMNING NOMZODI" IZOHI (sof modul).
 *
 * Umumiy rejimdagi odamlar hamma nomzodni oladi, shuning uchun har to'lov
 * xabarida nomzod kimning havolasidan kelgani kursivda, qavs ichida
 * yoziladi. Nom "Botlar boshqaruvi"dagi yozuvdan olinadi:
 *
 *   "Buxoro bo‘linmasi" → (Ushbu nomzodga link Buxoro bo‘linmasi
 *                          koordinatori tomonidan berilgan)
 *
 * Havolani yaratgan odamning o'ziga izoh qo'shilmaydi — u buni biladi.
 *
 * Hech narsa import qilinmaydi: testlar `@/` taxallusini yecha olmaydi.
 */

export interface LinkOwner {
  telegramId: number;
  /** "Botlar boshqaruvi"dagi nom; yozuv o'chirilgan bo'lsa `null`. */
  name: string | null;
}

/** Izoh matni (qavssiz). Havola panelda yoki kuzatuvdan oldin yaratilgan bo'lsa — `null`. */
export function linkOwnerNote(owner: LinkOwner | null): string | null {
  if (!owner) return null;
  const name = owner.name?.trim();
  if (!name) return `Ushbu nomzodga link Telegram ID ${owner.telegramId} egasi tomonidan berilgan`;
  // Nomning o'zida "koordinator" bo'lsa takrorlanmaydi.
  const who = /koordinator/i.test(name) ? name : `${name} koordinatori`;
  return `Ushbu nomzodga link ${who} tomonidan berilgan`;
}

/** Shu qabul qiluvchiga izoh kerakmi: havola egasining o'ziga — yo'q. */
export function needsOwnerNote(chatId: number, owner: LinkOwner | null): boolean {
  return owner != null && chatId !== owner.telegramId;
}

/** Telegram HTML rejimida faqat shu uchtasi qochiriladi. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Oddiy matnli xabar + kursiv izoh — `parse_mode: "HTML"` bilan yuboriladi.
 * Asosiy matn ham qochiriladi: ismda `<` yoki `&` bo'lsa Telegram xabarni
 * rad etmasin.
 */
export function withOwnerNote(text: string, note: string): string {
  return `${escapeHtml(text)}\n\n<i>(${escapeHtml(note)})</i>`;
}
