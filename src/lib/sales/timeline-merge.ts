/**
 * Timeline birlashtirish qoidalari — SOF MODUL.
 *
 * Bazaga bormaydi, shuning uchun dedupe va tartib qoidalari haqiqiy
 * testlar bilan qoplanadi. Bu muhim: dedupe xatosi mijozga ikki
 * marta bir xil javob yuborilishiga yoki aksincha, javobning
 * umuman ketmasligiga olib keladi.
 */

export type TimelineActor = "customer" | "human" | "ai" | "system";

export interface TimelineEvent {
  id: string;
  actor: TimelineActor;
  text: string;
  /** ISO vaqt. */
  at: string;
  /** Telegram xabar identifikatori — echo'ni topish uchun. */
  telegramMessageId: number | null;
  /** Mijoz haqiqatan olganmi. Simulated/xatolik — yo'q. */
  delivered: boolean;
  messageType: string;
  /** Shablon kaliti (faqat AI eventlarida). */
  templateKey: string | null;
}

/**
 * Ikki manbani bitta vaqt o'qiga qo'yadi.
 *
 * ECHO DEDUPE: bot yuborgan xabar Telegram orqali qaytib kelishi va
 * `sales_messages` ga chiquvchi bo'lib yozilishi mumkin. U holda
 * bitta haqiqiy xabar ikkita event bo'lib ko'rinadi.
 *
 * DEDUPE FAQAT `telegram_message_id` BO'YICHA, matn bo'yicha EMAS.
 * Sababi: inson bir xil qisqa javobni ("xo'p", "kutamiz") haqiqatan
 * ikki marta yozishi mumkin va ularni birlashtirish tarixni
 * buzardi. Identifikator esa yagona.
 *
 * Moslik topilganda AI yozuvi ustun turadi: u kelib chiqishni aniq
 * biladi, `sales_messages` esa faqat "chiquvchi" deydi.
 */
export function mergeTimeline(
  messageEvents: readonly TimelineEvent[],
  outboundEvents: readonly TimelineEvent[],
  limit: number,
): TimelineEvent[] {
  const aiByTelegramId = new Map<number, TimelineEvent>();
  for (const event of outboundEvents) {
    if (event.telegramMessageId != null) aiByTelegramId.set(event.telegramMessageId, event);
  }

  const kept: TimelineEvent[] = [];
  for (const event of messageEvents) {
    // Bu chiquvchi yozuv aslida bot xabarining echo'si bo'lsa,
    // uni tashlaymiz — AI varianti allaqachon ro'yxatda.
    if (
      event.actor === "human" &&
      event.telegramMessageId != null &&
      aiByTelegramId.has(event.telegramMessageId)
    ) {
      continue;
    }
    kept.push(event);
  }

  const all = [...kept, ...outboundEvents]
    .filter((event) => event.text.trim() !== "")
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return all.slice(-Math.max(1, limit));
}

/**
 * Model uchun navbatlar.
 *
 * YETKAZILMAGAN AI xabari CHIQARIB TASHLANADI: mijoz uni ko'rmagan,
 * shuning uchun "men buni aytdim" deb hisoblash yolg'on kontekst
 * bo'lardi va model kerakli gapni takrorlamay qo'yardi.
 *
 * Inson va AI ikkalasi ham `assistant` bo'ladi — mijoz uchun ular
 * bitta tomon. Farq faqat O'RGANISHDA muhim, generatsiyada emas.
 */
export function toModelTurns(
  events: readonly TimelineEvent[],
): Array<{ role: "customer" | "assistant"; text: string }> {
  return events
    .filter((event) => event.actor !== "ai" || event.delivered)
    .filter((event) => event.actor !== "system")
    .map((event) => ({
      role: event.actor === "customer" ? ("customer" as const) : ("assistant" as const),
      text: event.text,
    }));
}

/**
 * AI qaysi shablonlarni allaqachon yuborgan.
 *
 * Faqat YETKAZILGANLARI: yuborilmagan kanonik matn "yuborilgan"
 * deb belgilansa, mijoz uni umuman olmay qolardi.
 */
export function listExplainedTemplateKeys(events: readonly TimelineEvent[]): string[] {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.actor !== "ai" || !event.delivered) continue;
    if (event.templateKey && !event.templateKey.startsWith("fallback:")) {
      keys.add(event.templateKey);
    }
  }
  return [...keys];
}

/** Faqat AI yozgan va yetkazilgan matnlar — takror tekshiruvi uchun. */
export function assistantTexts(events: readonly TimelineEvent[]): string[] {
  return events
    .filter((event) => (event.actor === "ai" && event.delivered) || event.actor === "human")
    .map((event) => event.text);
}
