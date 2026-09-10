import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { withinAskingHours } from "@/lib/intake/payment-messages";
import {
  buildChannelReminderCaption,
  channelConfirmCallbackData,
  CHANNEL_CONFIRM_LABEL,
} from "./channel-reminder-message.ts";
import { isTelegramConfigured, sendTelegramPhoto } from "./telegram-api.ts";

/**
 * "Kanalga qo'yildimi?" — tayyor postning OXIRGI, qo'lda bajariladigan qadami.
 *
 * Quvur postni render qiladi va tahririyat chatiga yetkazadi. Kanalga
 * qo'yishni esa odam qiladi va bu qadam hech qayerda yozilmasdi: unutilgan
 * post bilan qo'yilgan post bir xil ko'rinardi.
 *
 * Endi tasdiqlanmagan har post uchun bot davriy so'raydi — rasm bilan,
 * chunki "qaysi post?" degan savolga ism bilan javob berish qiyin, rasm
 * bilan esa bir qarashda ko'rinadi. "QO'YILDI" bosilishi javobni
 * `channel_confirmed_at` ga yozadi va SO'RASH TO'XTAYDI.
 *
 * So'ralmagan javob "qo'yilmagan" DEB HISOBLANMAYDI: u tasdiqlanmagan
 * bo'lib qoladi va so'ralishda davom etadi.
 */

/** Bir postni qayta so'rashgacha o'tadigan vaqt. */
export const CHANNEL_REMINDER_INTERVAL_MS = 3 * 60 * 60 * 1000;

/**
 * Post yetkazilgandan keyin birinchi so'rashgacha kutiladigan vaqt.
 *
 * Post endigina chatga tushgan payt so'rash mantiqsiz: muharrir uni
 * hali ochib ham ulgurmagan. Bir soat — kanalga qo'yish uchun yetarli
 * va unutilganini bilish uchun hali erta emas.
 */
export const CHANNEL_REMINDER_FIRST_DELAY_MS = 60 * 60 * 1000;

/** Bitta yugurishda nechta post so'raladi — chat bir zumda to'lib ketmasin. */
export const CHANNEL_REMINDER_BATCH_SIZE = 5;

/**
 * Bu sanadan OLDIN yetkazilgan postlar haqida so'ralmaydi.
 *
 * BUGUNDAN BOSHLANADI — 2026-yil 10-sentyabr, Toshkent bo'yicha soat
 * 00:00 (UTC+5, ya'ni 2026-09-09T19:00:00Z). Sana UTC yarim tuniga
 * emas, TOSHKENT yarim tuniga bog'langan: tahririyat kuni shu yerda
 * boshlanadi va "bugun chiqqan post" degani ham shu.
 *
 * NEGA CHEGARA BOR: undan oldingi har post "tasdiqlanmagan" bo'lib
 * turibdi, chunki tasdiqlash tushunchasi o'shanda mavjud emas edi — va
 * ularning aksariyati allaqachon kanalda. Chegarasiz birinchi sweep
 * butun tarixni navbatga qo'yardi va tahririyat chatiga yuzlab rasm
 * quyilardi; bunday eslatma birinchi kuni o'chirib qo'yiladi.
 *
 * Eski postlar "tasdiqlangan" DEB BELGILANMADI ham: hech kim ularni
 * tasdiqlamagan va bazaga bo'lmagan qarorni yozish — yolg'on yozish.
 * Tizimning ular haqida fikri yo'q, shunday bo'lib ham qoladi.
 *
 * QOTIB TURADI, "bugun" bo'lib qolmaydi: har yugurishda qayta
 * hisoblansa, ertaga bugungi postlar chegaradan tushib qolardi.
 */
export const CHANNEL_REMINDER_ORIGIN_ISO = "2026-09-09T19:00:00Z";

interface PendingPost {
  id: string;
  candidate_id: string;
  article_url: string | null;
  rendered_image_url: string | null;
  telegram_last_sent_at: string | null;
  channel_reminder_count: number;
  candidates: { full_name: string } | null;
}

/**
 * Tasdiqlanmagan, tahririyatga YETKAZILGAN postlar.
 *
 * `telegram_last_sent_at` shart: yetkazilmagan post haqida "kanalga
 * qo'yildimi?" deb so'rashning ma'nosi yo'q — u hali hech kimda yo'q.
 *
 * Eng uzoq so'ralmaganidan boshlab tartiblanadi, ya'ni o'sib borayotgan
 * navbat aylanma xizmat qiladi va eng eski postlar yangilari ortida
 * ochlikda qolmaydi.
 */
export async function findPostsNeedingChannelReminder(
  limit = CHANNEL_REMINDER_BATCH_SIZE,
  now: Date = new Date(),
): Promise<PendingPost[]> {
  const db = createSupabaseAdminClient();
  const askableBefore = new Date(now.getTime() - CHANNEL_REMINDER_INTERVAL_MS).toISOString();
  const deliveredBefore = new Date(
    now.getTime() - CHANNEL_REMINDER_FIRST_DELAY_MS,
  ).toISOString();

  const { data, error } = await db
    .from("candidate_social_posts")
    .select(
      "id, candidate_id, article_url, rendered_image_url, telegram_last_sent_at, " +
        "channel_reminder_count, candidates(full_name)",
    )
    .is("channel_confirmed_at", null)
    .not("telegram_last_sent_at", "is", null)
    .gte("telegram_last_sent_at", CHANNEL_REMINDER_ORIGIN_ISO)
    .lte("telegram_last_sent_at", deliveredBefore)
    .or(`channel_reminder_last_at.is.null,channel_reminder_last_at.lte.${askableBefore}`)
    .order("channel_reminder_last_at", { ascending: true, nullsFirst: true })
    .order("telegram_last_sent_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[channel-reminder] sweep query failed", error.message);
    return [];
  }
  return (data ?? []) as unknown as PendingPost[];
}

export interface ChannelReminderResult {
  postId: string;
  /** Eslatma yetgan chatlar soni. */
  sent: number;
  attempt: number;
  skipped: "no_image" | "no_chats" | "send_failed" | null;
}

/**
 * Bitta postni so'raydi.
 *
 * Rasm URL sifatida yuboriladi, baytlar sifatida emas: post asseti ochiq
 * bucket'da turadi va Telegram uni o'zi olib keladi — bir postni besh
 * chatga yuborish uchun uni besh marta yuklab olish shart emas.
 */
async function askOne(post: PendingPost, chatIds: number[]): Promise<ChannelReminderResult> {
  const attempt = post.channel_reminder_count + 1;
  const image = (post.rendered_image_url ?? "").trim();

  // Rasmsiz eslatma yuborilmaydi — savolning butun ma'nosi "QAYSI post"
  // degan javobda. Lekin post navbatdan CHIQARILADI ham, aks holda u
  // har yugurishda haqiqiy nomzodlarning o'rnini egallab turardi.
  if (!image) {
    await markAsked(post.id, post.channel_reminder_count);
    console.warn(`[channel-reminder] post=${post.id} rasmi yo‘q — o‘tkazib yuborildi`);
    return { postId: post.id, sent: 0, attempt, skipped: "no_image" };
  }

  const caption = buildChannelReminderCaption({
    fullName: post.candidates?.full_name ?? "",
    articleUrl: post.article_url,
    attempt,
  });
  const keyboard = [[
    { text: CHANNEL_CONFIRM_LABEL, callback_data: channelConfirmCallbackData(post.id) },
  ]];

  let sent = 0;
  for (const chatId of chatIds) {
    try {
      await sendTelegramPhoto(chatId, image, caption, {
        // Izohda ism bor — erkin matn. MarkdownV2 bo'lsa ismdagi bitta
        // nuqta yoki chiziqcha butun yuborishni 400 bilan yiqitardi.
        parseMode: null,
        inlineKeyboard: keyboard,
      });
      sent += 1;
    } catch (err) {
      console.error(
        `[channel-reminder] send failed post=${post.id} chat=${chatId}`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Hech qayerga yetmadi: bu uzilish, so'rash emas. Hisoblagich
  // oshirilmaydi, aks holda "5-marta so'ralmoqda" deb yozilgan post
  // aslida bir marta ham ko'rsatilmagan bo'lishi mumkin edi.
  if (sent === 0) {
    await markAsked(post.id, post.channel_reminder_count);
    return { postId: post.id, sent: 0, attempt, skipped: "send_failed" };
  }

  await markAsked(post.id, attempt);
  return { postId: post.id, sent, attempt, skipped: null };
}

/** Vaqt muhrini yangilaydi — yuborilmagan holatda ham, navbat qotib qolmasin. */
async function markAsked(postId: string, count: number): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("candidate_social_posts")
    .update({
      channel_reminder_last_at: new Date().toISOString(),
      channel_reminder_count: count,
    })
    .eq("id", postId);
}

/**
 * Davriy so'rash.
 *
 * To'lov so'rovi bilan bir xil sokin soatlar ichida ishlaydi: eslatma
 * javob berilmaguncha takrorlanadi, ya'ni tungi soatlarda u muharrirlarni
 * uyg'otib turardi.
 */
export async function runChannelReminderSweep(
  chatIds: number[],
  limit = CHANNEL_REMINDER_BATCH_SIZE,
  now: Date = new Date(),
): Promise<ChannelReminderResult[]> {
  if (!isTelegramConfigured() || chatIds.length === 0) return [];
  if (!withinAskingHours(now)) return [];

  const due = await findPostsNeedingChannelReminder(limit, now);
  const results: ChannelReminderResult[] = [];
  for (const post of due) results.push(await askOne(post, chatIds));
  return results;
}

export interface ChannelConfirmOutcome {
  ok: boolean;
  /** Chatda ko'rsatiladigan qisqa javob. */
  text: string;
  fullName: string;
}

/**
 * "QO'YILDI" bosilganda.
 *
 * Yozuv `is null` shartli update bilan olinadi, `select` + `update` bilan
 * emas: bir xil savol bir nechta chatga ketadi va ikki muharrir bir vaqtda
 * bosishi mumkin. Faqat qatorni haqiqatan o'zgartirgan urinish "birinchi"
 * hisoblanadi; qolganlariga allaqachon tasdiqlangani aytiladi.
 */
export async function confirmChannelPost(
  postId: string,
  byUserId: number | null,
): Promise<ChannelConfirmOutcome> {
  const db = createSupabaseAdminClient();

  const { data: post } = await db
    .from("candidate_social_posts")
    .select("id, candidate_id, candidates(full_name)")
    .eq("id", postId)
    .maybeSingle();

  if (!post) return { ok: false, text: "Post topilmadi.", fullName: "" };

  const fullName =
    ((post as { candidates?: { full_name?: string } | null }).candidates?.full_name ?? "").trim();

  const { data: claimed } = await db
    .from("candidate_social_posts")
    .update({
      channel_confirmed_at: new Date().toISOString(),
      channel_confirmed_by: byUserId,
    })
    .eq("id", postId)
    .is("channel_confirmed_at", null)
    .select("id");

  if ((claimed?.length ?? 0) === 0) {
    return { ok: false, text: "Bu post allaqachon tasdiqlangan.", fullName };
  }

  await logAudit({
    actorId: null,
    action: "post.channel_confirmed",
    entityType: "candidate_social_posts",
    entityId: postId,
    metadata: { candidateId: post.candidate_id, telegramUserId: byUserId },
  });

  return { ok: true, text: "Tasdiqlandi ✅", fullName };
}

export {
  buildChannelConfirmedCaption,
  buildChannelReminderCaption,
  channelConfirmCallbackData,
  CHANNEL_CONFIRM_LABEL,
} from "./channel-reminder-message.ts";
export { parseChannelConfirmCallback } from "./channel-reminder-message.ts";
