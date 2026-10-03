import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isStale,
  isStep,
  type ConversationDraft,
  type ConversationStep,
} from "./conversation";

/**
 * SUHBAT HOLATI — BAZAGA TEGADIGAN QISM.
 *
 * Qoidalar `conversation.ts` da. Bu yerda faqat o'qish va yozish.
 *
 * JADVALGA FAQAT SHU MODUL TEGADI: holat bir necha joydan
 * o'zgartirilsa, bot nima kutayotgani aniqligini yo'qotardi.
 */

export interface Conversation {
  telegramUserId: number;
  profileId: string | null;
  step: ConversationStep;
  draft: ConversationDraft;
  lastMessageId: number | null;
}

/**
 * Faol suhbatni o'qiydi.
 *
 * ESKIRGAN SUHBAT YO'Q DEB QARALADI va o'chiriladi: odam yarim
 * qolgan oqimga bugun tasodifiy xabar yozsa, u javob deb qabul
 * qilinmasligi kerak.
 */
export async function loadConversation(
  telegramUserId: number,
): Promise<Conversation | null> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("bot_conversations")
    .select("telegram_user_id, profile_id, step, draft, last_message_id, updated_at")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (error) {
    console.error("[bot] suhbat o'qilmadi:", error.message);
    return null;
  }
  if (!data) return null;

  if (isStale(new Date(data.updated_at as string), new Date())) {
    await clearConversation(telegramUserId);
    return null;
  }

  const step = data.step as string;
  if (!isStep(step)) {
    /*
     * NOMA'LUM QADAM — SUHBAT TASHLANADI.
     *
     * Kod o'zgarib qadam olib tashlangan bo'lishi mumkin. Bunda
     * eski holatni davom ettirishga urinish bot nima so'rashini
     * bilmay qolishiga olib kelardi.
     */
    console.warn("[bot] noma'lum qadam, suhbat tashlandi:", { step });
    await clearConversation(telegramUserId);
    return null;
  }

  return {
    telegramUserId,
    profileId: (data.profile_id as string | null) ?? null,
    step,
    draft: (data.draft as ConversationDraft) ?? {},
    lastMessageId: (data.last_message_id as number | null) ?? null,
  };
}

/** Suhbatni boshlaydi yoki qadamini yangilaydi. */
export async function setConversation(input: {
  telegramUserId: number;
  profileId: string;
  step: ConversationStep;
  draft: ConversationDraft;
  lastMessageId?: number | null;
}): Promise<boolean> {
  const db = createSupabaseAdminClient();

  const { error } = await db.from("bot_conversations").upsert(
    {
      telegram_user_id: input.telegramUserId,
      profile_id: input.profileId,
      step: input.step,
      draft: input.draft,
      last_message_id: input.lastMessageId ?? null,
      /*
       * `updated_at` ANIQ YOZILADI.
       *
       * Trigger faqat `update` da ishlaydi; `upsert` yangi qator
       * yaratganda esa default qiymat qo'yiladi. Ikkisini bir xil
       * qilish uchun qo'lda yozamiz — aks holda eskirish hisobi
       * ikki xil ishlardi.
       */
      updated_at: new Date().toISOString(),
    },
    { onConflict: "telegram_user_id" },
  );

  if (error) {
    console.error("[bot] suhbat saqlanmadi:", error.message);
    return false;
  }
  return true;
}

export async function clearConversation(telegramUserId: number): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("bot_conversations")
    .delete()
    .eq("telegram_user_id", telegramUserId);

  if (error) {
    /*
     * TOZALASH XATOSI JIMGINA O'TMAYDI, lekin oqimni ham
     * to'xtatmaydi: eskirish muddati baribir uni yopadi.
     */
    console.error("[bot] suhbat tozalanmadi:", error.message);
  }
}
