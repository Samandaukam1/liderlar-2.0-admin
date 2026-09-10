/**
 * "Kanalga qo'yildimi?" eslatmasi — SOF modul (matn, tugma, callback).
 *
 * Xabar ATAYLAB oddiy matn, MarkdownV2 emas: ism erkin matn va undagi
 * bitta nuqta, chiziqcha yoki qavs butun yuborishni 400 bilan yiqitadi.
 * Bu yerda esa aynan ism eng muhim qism.
 */

export const CHANNEL_CONFIRM_LABEL = "✅ QO‘YILDI";

/**
 * Callback payload.
 *
 * Telegram callback_data'ni 64 BAYTDA kesadi. "chn:" + uuid = 40 bayt,
 * ya'ni chegara bilan orada yetarlicha bo'shliq bor.
 */
const CALLBACK_PREFIX = "chn:";

export function channelConfirmCallbackData(postId: string): string {
  return `${CALLBACK_PREFIX}${postId}`;
}

/** Bizniki bo'lmagan yoki buzilgan payload — null, ya'ni e'tiborsiz. */
export function parseChannelConfirmCallback(data: string | null | undefined): string | null {
  if (!data || !data.startsWith(CALLBACK_PREFIX)) return null;
  const id = data.slice(CALLBACK_PREFIX.length).trim();
  // uuid shakli tekshiriladi: aks holda ixtiyoriy matn bazaga so'rov
  // bo'lib ketardi.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/**
 * Ism BOSH HARFLARDA.
 *
 * Locale BERILMAYDI. O'zbek lotin alifbosida "i" ning bosh harfi "I",
 * turkchadagi kabi "İ" emas; locale berilsa muhit sozlamasiga qarab
 * ism buzilib ketishi mumkin edi. Apostrof variantlari (ʻ, ‘, ') katta
 * harfga aylanmaydi va o'z holicha qoladi — bu to'g'ri.
 */
export function upperCaseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

export interface ChannelReminderInput {
  fullName: string;
  /** Saytdagi maqola havolasi; yo'q bo'lsa qator umuman chiqmaydi. */
  articleUrl?: string | null;
  /** Bu nechanchi so'rash — birinchisida ko'rsatilmaydi. */
  attempt: number;
}

/**
 * Telegram foto izohi 1024 BELGIDA kesiladi.
 *
 * Xabar undan ancha qisqa, lekin ism erkin matn va uzunligiga kafolat
 * yo'q — chegara oxirida bir marta qo'llanadi.
 */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/**
 * Eslatma izohi.
 *
 * Savol BOSH HARFLARDA va birinchi qatorda: bu chat ish kunida o'nlab
 * post va to'lov xabari bilan to'ladi, eslatma esa ular orasida
 * ko'rinib turishi kerak.
 */
export function buildChannelReminderCaption(input: ChannelReminderInput): string {
  const lines = [
    "📢 KANALGA QO‘YILDIMI?",
    "",
    `🖼 ${upperCaseName(input.fullName) || "(ISMI YO‘Q)"}`,
  ];

  const url = (input.articleUrl ?? "").trim();
  if (url) lines.push(`🔗 ${url}`);

  lines.push("", "Kanalga qo‘yilgach, quyidagi tugmani bosing.");

  // Takroriylik YASHIRILMAYDI: uchinchi marta so'ralayotgan post
  // birinchisidan farq qilishi kerak, aks holda eslatma fon shovqiniga
  // aylanadi.
  if (input.attempt > 1) {
    lines.push(`⏰ ${input.attempt}-marta so‘ralmoqda.`);
  }

  return clampCaption(lines.join("\n"));
}

/** Tasdiqlangandan keyin xabar o'rniga yoziladigan matn. */
export function buildChannelConfirmedCaption(fullName: string): string {
  return clampCaption(
    ["✅ KANALGA QO‘YILDI", "", `🖼 ${upperCaseName(fullName) || "(ISMI YO‘Q)"}`].join("\n"),
  );
}

function clampCaption(text: string): string {
  return text.length <= TELEGRAM_CAPTION_LIMIT
    ? text
    : `${text.slice(0, TELEGRAM_CAPTION_LIMIT - 1)}…`;
}
