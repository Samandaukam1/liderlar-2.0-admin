import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildVoteAck,
  buildVoteKeyboard,
  buildVoteText,
  tallyVotes,
  type VoteOption,
} from "./region-vote.ts";
import { editTelegramMessageText, sendTelegramMessage } from "./telegram-api.ts";

/**
 * Kanaldagi hudud ovozi — baza va Telegram.
 *
 * Qoidalar SOF modulda (`region-vote.ts`); bu yerda faqat I/O.
 */

export const CHANNEL_ID_SETTING_KEY = "telegram_bot.channel_id";
const POLL_KEY = "region";

/* ----------------------------- kanal id ---------------------------------- */

/**
 * Kanal identifikatori.
 *
 * Moderator kanaldan bitta postni botga forward qilganda yoziladi —
 * id'ni qo'lda topish kerak emas (u manfiy 13 xonali son va uni
 * Telegram interfeysida ko'rsatmaydi).
 */
export async function getChannelId(): Promise<number | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("site_settings")
    .select("value")
    .eq("key", CHANNEL_ID_SETTING_KEY)
    .maybeSingle();

  const raw = (data?.value as string | null)?.trim();
  if (!raw) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id !== 0 ? id : null;
}

export async function saveChannelId(chatId: number, title: string | null): Promise<void> {
  const db = createSupabaseAdminClient();
  await db.from("site_settings").upsert(
    { key: CHANNEL_ID_SETTING_KEY, value: String(chatId) },
    { onConflict: "key" },
  );
  console.log(`[region-vote] kanal saqlandi: ${title ?? "(nomsiz)"} (${chatId})`);
}

/* ------------------------------ hududlar --------------------------------- */

/**
 * Hududlar BAZADAN — ariza formasi bilan bir xil manbadan.
 *
 * Kodga yozib qo'yilsa ikkita ro'yxat paydo bo'lardi: admin panelda
 * hudud nomi o'zgarganda forma bir nomni, kanal so'rovi boshqasini
 * ko'rsatardi.
 */
export async function loadVoteOptions(): Promise<VoteOption[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("regions")
    .select("slug, name")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[region-vote] hududlar o‘qilmadi", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    key: row.slug as string,
    name: row.name as string,
  }));
}

/* ------------------------------- sanoq ----------------------------------- */

async function loadCounts(
  chatId: number,
  messageId: number,
): Promise<Record<string, number>> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("channel_poll_votes")
    .select("option_key")
    .eq("chat_id", chatId)
    .eq("message_id", messageId);

  return tallyVotes((data ?? []) as { option_key: string }[]);
}

/* ---------------------------- so'rovni joylash --------------------------- */

export interface PublishResult {
  ok: boolean;
  error: string | null;
  messageId: number | null;
}

/**
 * So'rovni KANALGA joylaydi.
 *
 * Tugmali xabar FORWARD qilinganda tugmalarini yo'qotadi, shuning
 * uchun uni moderator chatiga yuborib, keyin uzatish mumkin emas —
 * bot to'g'ridan-to'g'ri kanalga yozishi shart va u yerda admin
 * bo'lishi kerak.
 */
export async function publishRegionVote(): Promise<PublishResult> {
  const channelId = await getChannelId();
  if (channelId == null) {
    return { ok: false, error: "Kanal ro‘yxatga olinmagan", messageId: null };
  }

  const options = await loadVoteOptions();
  if (options.length === 0) {
    return { ok: false, error: "Hududlar ro‘yxati bo‘sh", messageId: null };
  }

  try {
    const sent = await sendTelegramMessage(channelId, buildVoteText(0), {
      inlineKeyboard: buildVoteKeyboard(options),
    });
    return { ok: true, error: null, messageId: sent.messageId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      messageId: null,
    };
  }
}

/* ------------------------------ ovoz berish ------------------------------ */

export interface VoteResult {
  /** Bosgan odamga darhol ko'rsatiladigan javob. */
  ack: string;
  ok: boolean;
}

/**
 * Bitta ovozni yozadi va tugmalarni yangilaydi.
 *
 * BIR ODAM — BIR OVOZ: unikal indeks tufayli takroriy bosish yangi
 * qator qo'shmaydi, balki mavjudini ko'chiradi.
 */
export async function recordRegionVote(input: {
  chatId: number;
  messageId: number;
  telegramUserId: number;
  optionKey: string;
}): Promise<VoteResult> {
  const options = await loadVoteOptions();
  const chosen = options.find((option) => option.key === input.optionKey);
  if (!chosen) {
    return { ok: false, ack: "Bu variant endi mavjud emas." };
  }

  const db = createSupabaseAdminClient();

  // Oldingi ovoz — "o'zgartirildi" deb aytish uchun.
  const { data: previous } = await db
    .from("channel_poll_votes")
    .select("option_key")
    .eq("chat_id", input.chatId)
    .eq("message_id", input.messageId)
    .eq("telegram_user_id", input.telegramUserId)
    .maybeSingle();

  const previousKey = (previous?.option_key as string | null) ?? null;

  // Xuddi o'sha tugma qayta bosilgan — hech narsa o'zgarmaydi.
  if (previousKey === input.optionKey) {
    const counts = await loadCounts(input.chatId, input.messageId);
    return {
      ok: true,
      ack: `✅ Ovozingiz allaqachon hisobga olingan: ${chosen.name} — ${counts[chosen.key] ?? 0} ta ovoz`,
    };
  }

  const { error } = await db.from("channel_poll_votes").upsert(
    {
      poll_key: POLL_KEY,
      chat_id: input.chatId,
      message_id: input.messageId,
      telegram_user_id: input.telegramUserId,
      option_key: input.optionKey,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chat_id,message_id,telegram_user_id" },
  );

  if (error) {
    console.error("[region-vote] ovoz yozilmadi", error.message);
    return { ok: false, ack: "Ovoz saqlanmadi — birozdan so‘ng qayta urinib ko‘ring." };
  }

  const counts = await loadCounts(input.chatId, input.messageId);

  /*
   * TUGMALARNI YANGILASH — ovoz YOZILGANDAN KEYIN va alohida.
   *
   * Telegram xabar tahririni cheklaydi: ko'p odam bir vaqtda
   * bosganda ayrim tahrirlar 429 bilan qaytadi. Bu ovozning
   * yo'qolishi EMAS — ovoz allaqachon bazada. Shuning uchun xato
   * yutiladi va keyingi bosish sanoqni baribir yangilaydi.
   *
   * Bosgan odam esa sonni DARHOL ko'radi: u callback javobidan
   * keladi va unga tezlik chegarasi tegishli emas.
   */
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  try {
    await editTelegramMessageText(input.chatId, input.messageId, buildVoteText(total), {
      inlineKeyboard: buildVoteKeyboard(options, counts),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // "message is not modified" — normal holat, ikki odam bir xil
    // sanoqni ko'rgan. Log'ga yozamiz, lekin xato deb hisoblamaymiz.
    console.warn(`[region-vote] tugmalar yangilanmadi: ${message}`);
  }

  return {
    ok: true,
    ack: buildVoteAck({
      name: chosen.name,
      count: counts[chosen.key] ?? 0,
      changed: previousKey != null,
    }),
  };
}
