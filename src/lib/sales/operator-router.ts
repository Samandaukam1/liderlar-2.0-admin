import "server-only";
import { createIntakeLinkFromBot, handleIntakeNameStep } from "@/lib/intake/intake-link-bot";
import {
  INTAKE_LINK_BUTTON_LABEL,
  INTAKE_LINK_COMMAND,
  INTAKE_LINK_NAME_PROMPT,
  isIntakeLinkNamePrompt,
  parseIntakeGenderCallback,
  parseNameFromGenderPrompt,
} from "@/lib/intake/intake-link-messages";
import {
  answerSalesCallback,
  editSalesOperatorMessage,
  sendSalesOperatorMessage,
} from "./telegram-sales-api.ts";

/**
 * SOTUV BOTINING OPERATOR YO'LI.
 *
 * Sotuv boti ikki xil suhbat ko'radi:
 *   · MIJOZ bilan — Telegram Business orqali (`business_message`).
 *     U `flow/engine.ts` da ishlanadi va qat'iy himoyalangan.
 *   · MODERATOR bilan — botga to'g'ridan-to'g'ri yozilgan oddiy
 *     xabar. Shu modul aynan shuni ishlaydi.
 *
 * IKKISI BIR-BIRIGA TEGMAYDI. Bu modul `sendSalesMessage` ni
 * chaqirmaydi, ya'ni bu yerdan mijozga yozib bo'lmaydi; u
 * `sendSalesOperatorMessage` dan foydalanadi va u `chat_id` ni
 * tahririyat ro'yxatidan tekshiradi hamda `business_connection_id`
 * ni umuman qabul qilmaydi.
 */

export interface OperatorMessage {
  chatId: number;
  text: string | null;
  replyToText: string | null;
}

export interface OperatorCallback {
  id: string;
  chatId: number | null;
  messageId: number | null;
  messageText: string | null;
  data: string | null;
}

/** Moderator xabari ishlandimi. `false` — bu bizning ishimiz emas. */
export async function handleOperatorMessage(input: OperatorMessage): Promise<boolean> {
  const text = (input.text ?? "").trim();

  /*
   * ANKETA HAVOLASI — birinchi qadam.
   *
   * Post botidagi bilan AYNAN bir xil oqim va bir xil kod
   * (`intake-link-bot.ts`). Ikki nusxa yozilsa, ular vaqt o'tib
   * ajralib ketardi va ikkalasi ham bitta anketa tizimiga yozadi.
   */
  if (text === INTAKE_LINK_COMMAND || text === INTAKE_LINK_BUTTON_LABEL) {
    await sendSalesOperatorMessage(input.chatId, INTAKE_LINK_NAME_PROMPT, { forceReply: true });
    return true;
  }

  if (isIntakeLinkNamePrompt(input.replyToText)) {
    const step = handleIntakeNameStep(text);
    await sendSalesOperatorMessage(input.chatId, step.text, {
      ...(step.keyboard ? { inlineKeyboard: step.keyboard } : {}),
      ...(step.askAgain ? { forceReply: true } : {}),
    });
    return true;
  }

  if (text === "/start") {
    await sendSalesOperatorMessage(input.chatId, OPERATOR_START_REPLY, {
      inlineKeyboard: [[{ text: INTAKE_LINK_BUTTON_LABEL, callback_data: "op:intake" }]],
    });
    return true;
  }

  return false;
}

/** Moderator tugmani bosdi. `false` — bu bizning callback emas. */
export async function handleOperatorCallback(input: OperatorCallback): Promise<boolean> {
  if (input.chatId == null) return false;

  // Boshlash tugmasi — savolni ochadi.
  if (input.data === "op:intake") {
    await answerSalesCallback(input.id);
    await sendSalesOperatorMessage(input.chatId, INTAKE_LINK_NAME_PROMPT, { forceReply: true });
    return true;
  }

  const gender = parseIntakeGenderCallback(input.data);
  if (!gender) return false;

  /*
   * Ism BOT XABARINING MATNIDAN o'qiladi. Havola yaratilgach xabar
   * tahrirlanadi va ism belgisi undan yo'qoladi — ikkinchi bosishda
   * ism topilmaydi va IKKINCHI ANKETA YARATILMAYDI.
   */
  const fullName = parseNameFromGenderPrompt(input.messageText);
  if (!fullName) {
    await answerSalesCallback(input.id, "Havola allaqachon yaratilgan");
    return true;
  }

  await answerSalesCallback(input.id, "Yaratilmoqda…");
  const outcome = await createIntakeLinkFromBot({
    fullName,
    gender,
    origin: "sales_bot",
  });

  if (input.messageId != null) {
    await editSalesOperatorMessage(input.chatId, input.messageId, outcome.text);
  } else {
    await sendSalesOperatorMessage(input.chatId, outcome.text);
  }
  return true;
}

const OPERATOR_START_REPLY = [
  "Sotuv boti — moderator paneli.",
  "",
  "Bu yerda nomzod uchun anketa havolasi yaratishingiz mumkin.",
  "",
  `${INTAKE_LINK_COMMAND} — havola yaratish`,
].join("\n");
