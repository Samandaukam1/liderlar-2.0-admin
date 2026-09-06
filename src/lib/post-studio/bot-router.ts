import "server-only";
import {
  answerCallbackQuery,
  editTelegramMessageText,
  sendTelegramMessage,
  type InlineButton,
} from "./telegram-api.ts";
import { getPostDeliveryChatIds } from "./delivery-recipients.ts";
import {
  deactivateSubscriber,
  upsertSubscriber,
  type TelegramFrom,
} from "./telegram.ts";
import { parseTelegramCommand } from "./telegram-command.ts";
import {
  BATCH_BUTTON_LABEL,
  buildBotStatusReport,
  buildPaymentUndoPayload,
  handleBlacklistCallback,
  handlePaymentCallback,
  parseBlacklistCallback,
  parsePaymentCallback,
  parsePaymentUndoCallback,
  REPORT_BUTTON_LABEL,
  UNDO_BUTTON_LABEL,
  undoPaymentConfirmation,
} from "@/lib/intake/payment.ts";
import { runBotBatchButton } from "@/lib/intake/publish-batch.ts";
import {
  buildCrmListPage,
  CRM_LIST_BY_BUTTON,
  CRM_LIST_BY_COMMAND,
  FILLING_BUTTON_LABEL,
  parseCrmListCallback,
  PUBLISHED_BUTTON_LABEL,
  WAITING_BUTTON_LABEL,
  type CrmListKind,
} from "@/lib/intake/crm-lists.ts";

/**
 * Botning KIRUVCHI qatlami — suhbat, tugmalar, callbacklar.
 *
 * telegram.ts chiquvchi tomon bilan shug'ullanadi (obunachilar, post
 * yetkazish). Dispatch shu yerda alohida turadi, chunki u batch va to'lov
 * modullariga murojaat qiladi, ular esa o'z navbatida pipeline orqali
 * telegram.ts ga qaytadi — bir modulda bo'lsa aylanma import chiqardi.
 */

export const START_REPLY = [
  "Assalomu alaykum! 👋",
  "",
  "Siz O‘zbekiston Lider Yoshlari post yetkazib beruvchi botiga muvaffaqiyatli ulandingiz.",
  "",
  "Endi LIDERLAR.UZ ensiklopediyasida yangi lider maqolasi va posti e’lon qilinganda, tayyor postlarni shu yerda qabul qilishingiz mumkin.",
  "",
  "Obunani to‘xtatish: /stop",
].join("\n");

export const STOP_REPLY =
  "Post xabarnomalari to‘xtatildi. Qayta ulanish uchun /start yuboring.";

/** Anything that is not a known command still gets an answer. */
export const HELP_REPLY = [
  "Botdan foydalanish uchun:",
  "/start — postlarni olish",
  "/stop — postlarni to‘xtatish",
].join("\n");

/**
 * The same help plus the editorial actions.
 *
 * An ordinary subscriber must not even learn that the CRM lists exist, so the
 * two texts are separate rather than one text with a conditional tail.
 */
export const EDITORIAL_HELP_REPLY = [
  HELP_REPLY,
  "",
  "Tahririyat uchun:",
  "/hisobot — hozirgi hisobot",
  "/chop — chop etishga tayyorlarni ishga tushirish",
  "/chopetilganlar — chop etilganlar ro‘yxati",
  "/kutayotganlar — kutayotganlar ro‘yxati",
  "/toldirayotganlar — to‘ldirayotganlar ro‘yxati",
].join("\n");

export const NOT_AUTHORIZED_REPLY =
  "Bu amal faqat tahririyat uchun. Siz postlarni qabul qilishda davom etasiz.";

export interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    from?: TelegramFrom;
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: TelegramFrom;
    data?: string;
    message?: { chat?: { id?: number }; message_id?: number };
  };
}

/**
 * Who may run editorial actions.
 *
 * The keyboard is only half the guard — a chat id can be spoofed by nobody, but
 * a button label can be typed by anyone, so every privileged branch re-checks
 * membership rather than trusting that the keyboard was never shown.
 */
async function isEditorialChat(chatId: number): Promise<boolean> {
  const configured = await getPostDeliveryChatIds();
  return configured.includes(chatId);
}

/** Editors get the working keyboard; ordinary subscribers just receive posts. */
function keyboardFor(editorial: boolean): string[][] | undefined {
  if (!editorial) return undefined;
  return [
    [REPORT_BUTTON_LABEL],
    [BATCH_BUTTON_LABEL],
    [UNDO_BUTTON_LABEL],
    // The three CRM lists read candidate data, so they are shown — and, below,
    // re-checked — only for editorial chats.
    [PUBLISHED_BUTTON_LABEL],
    [WAITING_BUTTON_LABEL, FILLING_BUTTON_LABEL],
  ];
}

/** Sends page 1 of a list; later pages replace this message in place. */
async function sendCrmList(chatId: number, kind: CrmListKind): Promise<void> {
  const page = await buildCrmListPage(kind, 1);
  await sendTelegramMessage(chatId, page.text, {
    inlineKeyboard: page.keyboard.length > 0 ? page.keyboard : undefined,
  });
  console.log(`[telegram-webhook] sendMessage success command=crm:${kind} total=${page.total}`);
}

/**
 * Handles one webhook update.
 *
 * The subscriber write is deliberately non-fatal. It used to run as
 * `await upsertSubscriber(...)` directly in front of the reply, so any database
 * problem — a missing migration, an RLS change, a transient PostgREST error —
 * threw before sendMessage was ever reached and the user got total silence
 * while Telegram still saw a 200. The reply now goes out regardless, and the
 * database failure is logged loudly instead of swallowing the conversation.
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  // A tapped inline button arrives as a callback_query, not a message. This is
  // how the payment question is answered, so it is checked first.
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const from = message?.from;

  if (!chatId || !from?.id) {
    console.log("[telegram-webhook] update ignored: no chat or sender");
    return;
  }

  const command = parseTelegramCommand(message?.text);
  const text = (message?.text ?? "").trim();
  const editorial = await isEditorialChat(chatId);
  const keyboard = keyboardFor(editorial);
  console.log(`[telegram-webhook] command=${command || "(none)"} editorial=${editorial}`);

  if (command === "/start") {
    try {
      await upsertSubscriber(from, chatId);
      console.log("[telegram-webhook] subscriber upserted");
    } catch (err) {
      console.error(
        "[telegram-webhook] subscriber upsert failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
    await sendTelegramMessage(chatId, START_REPLY, { replyKeyboard: keyboard });
    console.log("[telegram-webhook] sendMessage success command=/start");
    return;
  }

  if (command === "/stop") {
    try {
      await deactivateSubscriber(from.id);
      console.log("[telegram-webhook] subscriber deactivated");
    } catch (err) {
      console.error(
        "[telegram-webhook] subscriber deactivate failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
    await sendTelegramMessage(chatId, STOP_REPLY);
    console.log("[telegram-webhook] sendMessage success command=/stop");
    return;
  }

  // Each editorial action is reachable both as its keyboard button and as a
  // typed command, because a button press arrives as an ordinary message
  // carrying its label — there is no way to tell the two apart.
  if (command === "/hisobot" || text === REPORT_BUTTON_LABEL) {
    if (!editorial) return deny(chatId, keyboard);
    await sendTelegramMessage(chatId, await buildBotStatusReport(), { replyKeyboard: keyboard });
    console.log("[telegram-webhook] sendMessage success command=report");
    return;
  }

  if (command === "/chop" || text === BATCH_BUTTON_LABEL) {
    if (!editorial) return deny(chatId, keyboard);
    // Same queue the panel drives: this starts it if idle, and reports on it
    // if it is already running.
    await sendTelegramMessage(chatId, await runBotBatchButton(), { replyKeyboard: keyboard });
    console.log("[telegram-webhook] sendMessage success command=batch");
    return;
  }

  if (command === "/bekor" || text === UNDO_BUTTON_LABEL) {
    if (!editorial) return deny(chatId, keyboard);
    const payload = await buildPaymentUndoPayload();
    await sendTelegramMessage(chatId, payload.text, {
      inlineKeyboard: payload.keyboard.length > 0 ? payload.keyboard : undefined,
    });
    console.log("[telegram-webhook] sendMessage success command=undo");
    return;
  }

  // The CRM lists: one entry per list, reachable as a keyboard button or as a
  // typed command. Both are re-checked against the editorial chat list — a
  // label is just text, and anyone can type it.
  const listKind = CRM_LIST_BY_BUTTON[text] ?? CRM_LIST_BY_COMMAND[command];
  if (listKind) {
    if (!editorial) return deny(chatId, keyboard);
    await sendCrmList(chatId, listKind);
    return;
  }

  // Never leave a message unanswered.
  await sendTelegramMessage(chatId, editorial ? EDITORIAL_HELP_REPLY : HELP_REPLY, {
    replyKeyboard: keyboard,
  });
  console.log("[telegram-webhook] sendMessage success command=help");
}

async function deny(chatId: number, keyboard: string[][] | undefined): Promise<void> {
  await sendTelegramMessage(chatId, NOT_AUTHORIZED_REPLY, { replyKeyboard: keyboard });
  console.log("[telegram-webhook] editorial action refused for non-editor chat");
}

/**
 * One tapped inline button.
 *
 * The spinner is cleared first and the slow work runs after: Telegram keeps the
 * button spinning for a few seconds and shows the tapper an error if nothing
 * answers, regardless of what the handler is still doing.
 */
async function handleCallbackQuery(
  query: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const chatId = query.message?.chat?.id ?? null;

  const listPage = parseCrmListCallback(query.data);
  if (listPage) {
    if (chatId == null || !(await isEditorialChat(chatId))) {
      await safeAnswerCallback(query.id, "Ruxsat yo‘q");
      return;
    }
    await safeAnswerCallback(query.id);
    const messageId = query.message?.message_id ?? null;
    // Live data on every tap: the page is re-queried, never paged from a cached
    // snapshot, so a candidate published a minute ago is already in the list.
    const page = await buildCrmListPage(listPage.kind, listPage.page);
    if (messageId == null) {
      await sendTelegramMessage(chatId, page.text, {
        inlineKeyboard: page.keyboard.length > 0 ? page.keyboard : undefined,
      });
    } else {
      // Editing keeps one message per list instead of a new one per tap.
      await editTelegramMessageText(chatId, messageId, page.text, {
        inlineKeyboard: page.keyboard,
      });
    }
    console.log(`[telegram-webhook] crm list ${listPage.kind} page=${page.page}/${page.pageCount}`);
    return;
  }

  const blacklistId = parseBlacklistCallback(query.data);
  if (blacklistId) {
    if (chatId == null || !(await isEditorialChat(chatId))) {
      await safeAnswerCallback(query.id, "Ruxsat yo‘q");
      return;
    }
    const outcome = await handleBlacklistCallback({
      intakeId: blacklistId,
      chatId,
      messageId: query.message?.message_id ?? null,
      fromUserId: query.from?.id ?? null,
      callbackQueryId: query.id,
    });
    console.log(`[telegram-webhook] blacklist → ${outcome}`);
    return;
  }

  const undoId = parsePaymentUndoCallback(query.data);
  if (undoId) {
    // Reverting a confirmation is an editorial action like any other, and the
    // inline keyboard it came from could have been forwarded anywhere.
    if (chatId == null || !(await isEditorialChat(chatId))) {
      await safeAnswerCallback(query.id, "Ruxsat yo‘q");
      return;
    }
    await safeAnswerCallback(query.id, "Bekor qilinmoqda…");
    const outcome = await undoPaymentConfirmation(undoId);
    await sendTelegramMessage(chatId, outcome.text);
    console.log(`[telegram-webhook] payment undo → ${outcome.ok ? "ok" : "refused"}`);
    return;
  }

  const payment = parsePaymentCallback(query.data);
  if (!payment) {
    await safeAnswerCallback(query.id);
    console.log("[telegram-webhook] callback ignored: unknown data");
    return;
  }

  if (chatId == null || !(await isEditorialChat(chatId))) {
    await safeAnswerCallback(query.id, "Ruxsat yo‘q");
    return;
  }

  const outcome = await handlePaymentCallback({
    intakeId: payment.intakeId,
    paid: payment.paid,
    chatId,
    messageId: query.message?.message_id ?? null,
    fromUserId: query.from?.id ?? null,
    callbackQueryId: query.id,
  });
  console.log(`[telegram-webhook] payment callback ${payment.paid ? "yes" : "no"} → ${outcome}`);
}

async function safeAnswerCallback(id: string, text?: string): Promise<void> {
  try {
    await answerCallbackQuery(id, text);
  } catch (err) {
    console.error("[telegram-webhook] answerCallbackQuery failed", err instanceof Error ? err.message : err);
  }
}

export { editTelegramMessageText };
export type { InlineButton };
