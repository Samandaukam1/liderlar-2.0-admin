import "server-only";
import { createIntakeWithLink } from "./intake-link-service";
import { buildIntakeBaseUrl } from "./intake-base-url";
import { validateFullName } from "@/lib/sales/flow/full-name";
import {
  buildGenderKeyboard,
  buildGenderPrompt,
  buildIntakeLinkResult,
  buildNameRetryPrompt,
  cleanNameInput,
  type IntakeGender,
  type IntakeInlineButton,
} from "./intake-link-messages";

/**
 * Botdan anketa havolasi — umumiy mantiq.
 *
 * IKKALA BOT SHU YERDAN FOYDALANADI: tahririyat post boti ham,
 * sotuv boti ham. Ikki nusxa yozilsa, ular vaqt o'tib ajralib
 * ketardi — bittasida tuzatilgan xato ikkinchisida qolaverardi,
 * va ikkalasi bir xil anketa tizimiga yozadi.
 */

export interface NameStepResult {
  ok: boolean;
  /** Yuboriladigan matn. */
  text: string;
  /** Jins tugmalari — faqat ism qabul qilinganda. */
  keyboard: IntakeInlineButton[][] | null;
  /** Ism qabul qilinmasa, qayta so'rash kerak (`force_reply`). */
  askAgain: boolean;
}

/**
 * Birinchi qadam: moderator yozgan ismni tekshiradi.
 *
 * Ism yetarli bo'lmasa OQIM UZILMAYDI — sabab aytiladi va qayta
 * so'raladi. Jimgina to'xtash moderatorni "bot ishlamayapti" degan
 * xulosaga olib kelardi.
 */
export function handleIntakeNameStep(rawText: string | null | undefined): NameStepResult {
  const cleaned = cleanNameInput(rawText);
  const checked = validateFullName(cleaned);

  if (!checked.ok) {
    return {
      ok: false,
      text: buildNameRetryPrompt(checked.reason ?? "noto‘g‘ri format"),
      keyboard: null,
      askAgain: true,
    };
  }

  return {
    ok: true,
    // Jins TANLANADI, taxmin qilinmaydi: noto'g'ri jins anketa
    // mavzusini va rasm promtini buzadi.
    text: buildGenderPrompt(checked.fullName, checked.gender),
    keyboard: buildGenderKeyboard(),
    askAgain: false,
  };
}

export interface IntakeLinkOutcome {
  ok: boolean;
  text: string;
  intakeId: string | null;
  /**
   * Tayyor havola HTML bilan ketadi (`<pre>` — bitta bosishda
   * nusxalanadi). Xato matni esa ODDIY: unda Telegram'ning o'zi
   * qaytargan tavsif bo'lishi mumkin va undagi `<` butun yuborishni
   * yiqitardi.
   */
  parseMode: "HTML" | null;
}

/**
 * Ikkinchi qadam: jins tanlandi — havola yaratiladi.
 *
 * `origin` chaqiruvchi botga qarab beriladi, shunda keyin qaysi
 * kanaldan nechta anketa kelgani ko'rinadi.
 */
export async function createIntakeLinkFromBot(input: {
  fullName: string;
  gender: IntakeGender;
  origin: string;
}): Promise<IntakeLinkOutcome> {
  const checked = validateFullName(input.fullName);
  if (!checked.ok) {
    return {
      ok: false,
      text: buildNameRetryPrompt(checked.reason ?? "noto‘g‘ri format"),
      intakeId: null,
      parseMode: null,
    };
  }

  const created = await createIntakeWithLink({
    fullName: checked.fullName,
    gender: input.gender,
    // Bot sessiyasi yo'q — anketa kim yaratgani `origin` bilan
    // va audit yozuvi bilan ajratiladi.
    actorId: null,
    baseUrl: await buildIntakeBaseUrl(),
    origin: input.origin,
  });

  if (!created.ok || !created.link) {
    return {
      ok: false,
      text: `❌ Havola yaratilmadi: ${created.error ?? "noma’lum xato"}`,
      intakeId: null,
      parseMode: null,
    };
  }

  return {
    ok: true,
    text: buildIntakeLinkResult({
      fullName: checked.fullName,
      gender: input.gender,
      link: created.link,
      expiresAt: created.expiresAt ?? null,
    }),
    intakeId: created.intakeId ?? null,
    parseMode: "HTML",
  };
}
