import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mergeTimeline, type TimelineEvent } from "./timeline-merge.ts";

/**
 * YAGONA SUHBAT TARIXI (master spec 1-band).
 *
 * MUAMMO — VA U PHASE 1 NI ISHLAMAS QILIB QO'YGAN EDI:
 *
 * Bot yuborgan javoblar `sales_outbound_log` ga yoziladi.
 * Mijoz va inson xabarlari `sales_messages` da.
 * Kontekst esa FAQAT `sales_messages` dan o'qilardi.
 *
 * Ya'ni AI o'zining oldingi javoblarini KO'RMASDI. Oqibatlari:
 *   · takror tekshiruvi bo'sh ro'yxat olardi va hech qachon
 *     ishlamasdi — Phase 1 ning asosiy yangiligi amalda o'lik edi;
 *   · "allaqachon aytilgan" bloki bo'sh ketardi;
 *   · model oldin nima va'da qilganini bilmasdi;
 *   · auditda ko'rilgan suhbatda asosiy tarix "9 kiruvchi, 0
 *     chiquvchi" ko'rinardi, jurnalda esa 7 ta javob bor edi.
 *
 * Endi ikkala manba bitta vaqt o'qiga qo'yiladi va HAR EVENT o'z
 * kelib chiqishini olib yuradi: mijoznikimi, insonnikimi, AI nikimi.
 * Bu farq uslub o'rganish uchun hal qiluvchi — AI o'z xatosini
 * qayta o'rganmasligi kerak.
 */

/** Bitta so'rovda olinadigan eng ko'p yozuv (har manbadan). */
const FETCH_LIMIT = 40;

export interface LoadTimelineOptions {
  /** Nechta oxirgi event qaytariladi. */
  limit?: number;
  /**
   * Shu identifikatorli xabar CHIQARIB TASHLANADI.
   *
   * Kerak, chunki kiruvchi xabar avval bazaga yoziladi, keyin tarix
   * o'qiladi va o'sha xabar generatorga YANA `message` sifatida
   * qo'shiladi. Natijada joriy savol modelga ikki marta borardi.
   */
  excludeMessageId?: string | null;
}

export async function loadConversationTimeline(
  conversationId: string,
  options: LoadTimelineOptions = {},
): Promise<TimelineEvent[]> {
  const admin = createSupabaseAdminClient();

  const [messages, outbound] = await Promise.all([
    admin
      .from("sales_messages")
      .select("id, direction, text, sent_at, telegram_message_id, message_type")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("sent_at", { ascending: false })
      .limit(FETCH_LIMIT),
    admin
      .from("sales_outbound_log")
      .select("id, body, created_at, telegram_message_id, simulated, error, template_key")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT),
  ]);

  const messageEvents: TimelineEvent[] = (messages.data ?? [])
    .filter((row) => (options.excludeMessageId ? row.id !== options.excludeMessageId : true))
    .map((row) => ({
      id: row.id as string,
      /*
       * CHIQUVCHI XABAR — INSONNIKI deb olinadi.
       *
       * Telegram Business'da sotuvchi o'z telefonidan yozganda xabar
       * shu jadvalga tushadi. Bot yuborgani esa `sales_outbound_log`
       * dan keladi va quyida `ai` deb belgilanadi. Echo (bot xabari
       * Telegram orqali qaytib kelishi) `mergeTimeline` da
       * birlashtiriladi.
       */
      actor: row.direction === "incoming" ? "customer" : "human",
      text: (row.text as string | null) ?? "",
      at: (row.sent_at as string) ?? "",
      telegramMessageId: (row.telegram_message_id as number | null) ?? null,
      delivered: true,
      messageType: (row.message_type as string | null) ?? "text",
      templateKey: null,
    }));

  const outboundEvents: TimelineEvent[] = (outbound.data ?? []).map((row) => ({
    id: row.id as string,
    actor: "ai",
    text: (row.body as string | null) ?? "",
    at: (row.created_at as string) ?? "",
    telegramMessageId: (row.telegram_message_id as number | null) ?? null,
    /*
     * YETKAZILGANMI. Simulated va xatolik bilan tugagan urinish
     * mijoz OLGAN javob emas — uni tarixga "aytilgan" deb qo'yish
     * modelga yolg'on kontekst berardi ("men buni aytdim" deb
     * o'ylab, takrorlamay qo'yardi).
     */
    delivered: row.simulated !== true && row.error == null,
    messageType: "text",
    templateKey: (row.template_key as string | null) ?? null,
  }));

  return mergeTimeline(messageEvents, outboundEvents, options.limit ?? 12);
}

export type { TimelineEvent } from "./timeline-merge.ts";
export { toModelTurns, listExplainedTemplateKeys } from "./timeline-merge.ts";
