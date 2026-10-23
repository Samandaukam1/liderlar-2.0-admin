import "server-only";
import {
  answerCallbackQuery,
  answerInlineQuery,
  editTelegramMessageText,
  sendTelegramMessage,
} from "@/lib/post-studio/telegram-api";
import { getLinkOwner } from "@/lib/bot-access/service";
import {
  buildCandidateInvitation,
  buildGrantDoneText,
  buildLinkCreatedText,
  buildVipCardKeyboard,
  buildVipCardText,
  inlineDescription,
  inlineMessageText,
  VIP_CARD_USED_REPLY,
  VIP_NOT_FOUND_REPLY,
  VIP_NOT_OWN_REPLY,
  VIP_PROMPT,
  VIP_SEARCH_BUTTON_LABEL,
  type CandidateRef,
  type VipCallback,
} from "./bot-messages";
import {
  claimCard,
  createVipLink,
  grantVipNow,
  isOwnCandidate,
  loadCards,
  loadVipCard,
  releaseCard,
  searchVipCards,
  type BotEditor,
  type LoadedCard,
} from "./bot-service";

/**
 * POST BOT: VIP BERISH — TELEGRAM QISMI.
 *
 * Ruxsat (`studio.vip`) va "faqat o'z nomzodlari" rejimi chaqiruvchida —
 * `bot-router.ts` da — tekshiriladi; bu yerga faqat ruxsati bor so'rov keladi.
 */

/** "👑 VIP berish" — yo'riqnoma va inline qidiruvni ochadigan tugma. */
export async function sendVipPrompt(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, VIP_PROMPT, {
    parseMode: "HTML",
    inlineKeyboard: [[{ text: VIP_SEARCH_BUTTON_LABEL, switch_inline_query_current_chat: "" }]],
  });
}

async function sendCard(chatId: number, loaded: LoadedCard): Promise<void> {
  const keyboard = buildVipCardKeyboard(loaded.card);
  await sendTelegramMessage(chatId, buildVipCardText(loaded.card), {
    parseMode: "HTML",
    disableWebPagePreview: true,
    ...(keyboard.length > 0 ? { inlineKeyboard: keyboard } : {}),
  });
}

/** Biografiya havolasi yoki inline natijadan kelgan xabar → nomzod kartasi. */
export async function sendVipCard(chatId: number, ref: CandidateRef, ownOnly: boolean): Promise<void> {
  const lookup = await loadVipCard(ref, ownOnly ? chatId : null);
  if (!lookup.ok) {
    await sendTelegramMessage(chatId, lookup.reason === "not_own" ? VIP_NOT_OWN_REPLY : VIP_NOT_FOUND_REPLY);
    return;
  }
  await sendCard(chatId, lookup.loaded);
  console.log(`[vip-bot] karta candidate=${lookup.loaded.card.candidateId}`);
}

/** Faqat JPEG: Telegram natija rasmini shu formatda ishonchli ko'rsatadi. */
function thumbnail(url: string | null): string | undefined {
  return url && /\.jpe?g(\?|$)/i.test(url) ? url : undefined;
}

/**
 * Harf-harf qidiruv. Ruxsati yo'q odamga BO'SH javob: nomzodlar ro'yxati
 * botni topib olgan istalgan Telegram foydalanuvchisiga ochilib qolmasin.
 */
export async function handleVipInlineQuery(
  query: { id: string; query?: string },
  access: { allowed: boolean; ownerChatId: number | null },
): Promise<void> {
  if (!access.allowed) {
    await answerInlineQuery(query.id, [], { cacheTime: 60 });
    return;
  }

  const started = Date.now();
  let found: LoadedCard[] = [];
  try {
    found = await searchVipCards(query.query ?? "", access.ownerChatId);
  } catch (err) {
    console.error("[vip-bot] qidiruv yiqildi:", err instanceof Error ? err.message : err);
  }

  await answerInlineQuery(
    query.id,
    found.map(({ card, avatarUrl }) => ({
      id: card.candidateId,
      title: card.fullName,
      description: inlineDescription(card),
      messageText: inlineMessageText(card),
      thumbnailUrl: thumbnail(avatarUrl),
    })),
  );
  console.log(
    `[vip-bot] inline len=${(query.query ?? "").length} results=${found.length} ms=${Date.now() - started}`,
  );
}

async function safeAnswer(id: string, text?: string): Promise<void> {
  try {
    await answerCallbackQuery(id, text);
  } catch (err) {
    console.error("[vip-bot] answerCallbackQuery failed", err instanceof Error ? err.message : err);
  }
}

async function editorOf(chatId: number, fallbackName: string | null): Promise<BotEditor> {
  const owner = await getLinkOwner(chatId);
  return { telegramId: chatId, name: owner?.name ?? fallbackName };
}

/**
 * Kartadagi tugma.
 *
 * Tartib: spinner darhol tozalanadi → karta "band" qilinadi (ikkinchi bosish
 * shu yerda to'xtaydi) → amal → karta natija bilan almashtiriladi va tugmalar
 * yo'qoladi. Amal bajarilmasa karta bo'shatiladi — qayta bosish mumkin.
 */
export async function handleVipCallback(input: {
  callbackQueryId: string;
  action: VipCallback;
  chatId: number;
  messageId: number | null;
  fromName: string | null;
  ownOnly: boolean;
}): Promise<void> {
  const { action, chatId, messageId } = input;

  if (input.ownOnly && !(await isOwnCandidate(chatId, action.candidateId))) {
    await safeAnswer(input.callbackQueryId, "Bu nomzod sizniki emas");
    return;
  }
  if (messageId == null) {
    await safeAnswer(input.callbackQueryId);
    return;
  }

  const claimed = await claimCard({
    chatId,
    messageId,
    candidateId: action.candidateId,
    action: `${action.kind}${action.months}`,
  });
  if (!claimed) {
    await safeAnswer(input.callbackQueryId, VIP_CARD_USED_REPLY);
    return;
  }
  await safeAnswer(input.callbackQueryId, "Bajarilmoqda…");

  const editor = await editorOf(chatId, input.fromName);
  const done = async (text: string) => {
    await editTelegramMessageText(chatId, messageId, text, { parseMode: "HTML" });
  };

  try {
    if (action.kind === "grant") {
      const result = await grantVipNow({
        candidateId: action.candidateId,
        months: action.months,
        editor,
        // Bir karta — bir VIP: Telegram update'ni qayta yuborsa ham kun ikki marta qo'shilmaydi.
        idempotencyKey: `post-bot:${chatId}:${messageId}`,
      });
      if (!result.ok) {
        await releaseCard(chatId, messageId);
        await sendTelegramMessage(chatId, grantErrorText(result.reason));
        await resendCard(chatId, action.candidateId);
        return;
      }
      await done(buildGrantDoneText({ ...result, months: action.months }));
      console.log(`[vip-bot] VIP berildi candidate=${action.candidateId} months=${action.months}`);
      return;
    }

    const [loaded] = await loadCards([action.candidateId]);
    const result = await createVipLink({ candidateId: action.candidateId, months: action.months, editor });
    if (!result.ok) {
      await releaseCard(chatId, messageId);
      await sendTelegramMessage(chatId, linkErrorText(result.reason));
      if (result.reason === "already_linked") await resendCard(chatId, action.candidateId);
      return;
    }

    const fullName = loaded?.card.fullName ?? "Nomzod";
    await done(
      buildLinkCreatedText({
        fullName,
        vipDays: result.vipDays,
        expiresAt: result.expiresAt,
        replacedPrevious: result.replacedPrevious,
      }),
    );
    // Alohida xabar: muharrir uni nomzodga butunligicha uzatadi yoki nusxalaydi.
    await sendTelegramMessage(
      chatId,
      buildCandidateInvitation({ fullName, link: result.link, vipDays: result.vipDays, expiresAt: result.expiresAt }),
      { disableWebPagePreview: true },
    );
    console.log(`[vip-bot] havola candidate=${action.candidateId} vip_days=${result.vipDays ?? 0}`);
  } catch (err) {
    await releaseCard(chatId, messageId);
    throw err;
  }
}

async function resendCard(chatId: number, candidateId: string): Promise<void> {
  const [loaded] = await loadCards([candidateId]);
  if (loaded) await sendCard(chatId, loaded);
}

function linkErrorText(reason: "disabled" | "already_linked" | "not_found" | "error"): string {
  switch (reason) {
    case "disabled":
      return "Akkaunt faollashtirish sozlamalarda o‘chirilgan (member.account_activation_enabled). Admin yoqishi kerak.";
    case "already_linked":
      return "Nomzod hozirgina akkaunt ochgan — havola kerak emas. Yangilangan karta 👇";
    case "not_found":
      return VIP_NOT_FOUND_REPLY;
    case "error":
      return "Havola yaratilmadi. Birozdan keyin qayta bosing.";
  }
}

function grantErrorText(reason: "not_found" | "not_linked" | "not_allowed" | "error"): string {
  switch (reason) {
    case "not_found":
      return VIP_NOT_FOUND_REPLY;
    case "not_linked":
      return "Nomzodning akkaunti yo‘q — VIP havola orqali beriladi. Yangilangan karta 👇";
    case "not_allowed":
      return "Bu nomzodning VIP holati o‘zgargan. Yangilangan karta 👇";
    case "error":
      return "VIP berilmadi. Birozdan keyin qayta bosing.";
  }
}
