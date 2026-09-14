/**
 * BOTDAN ANKETA HAVOLASI — sof modul (matn, tugma, callback).
 *
 * IKKI QADAM, LEKIN HOLATSIZ.
 *
 * Chat holati bazada saqlanmaydi. Sabab tajribadan: saqlansa, yarim
 * tashlab ketilgan suhbat keyingi har qanday xabarni "ism" deb o'qib
 * yuboradi — moderator boshqa ish qilayotganida tasodifan anketa
 * yaratilib qoladi.
 *
 * Buning o'rniga holat SUHBATNING O'ZIDA yashaydi:
 *   1. Tugma bosiladi → savol `force_reply` bilan ketadi;
 *   2. Javob `reply_to_message` bilan qaytadi — bot shundan "bu
 *      anketa uchun ism" ekanini biladi;
 *   3. Ism BOT XABARINING MATNIGA yoziladi va jins tugmalari
 *      qo'yiladi; callback kelganda ism o'sha matndan o'qiladi.
 *
 * Uchinchi qadam IKKI MARTA BOSISHDAN ham himoya qiladi: havola
 * yaratilgach xabar tahrirlanadi va ism belgisi undan yo'qoladi,
 * ya'ni ikkinchi bosishda ism topilmaydi va yangi anketa
 * yaratilmaydi.
 *
 * SOF MODUL — hamma qoida testda tekshiriladi.
 */

import { normalizeApostrophes } from "../sales/text-normalize.ts";

export const INTAKE_LINK_BUTTON_LABEL = "🔗 Anketa havolasi";
export const INTAKE_LINK_COMMAND = "/anketa";

/** Ism so'raladigan savol. `force_reply` bilan yuboriladi. */
export const INTAKE_LINK_NAME_PROMPT = [
  "🔗 ANKETA HAVOLASI",
  "",
  "Nomzodning to‘liq F.I.Sh.ini yozib yuboring.",
  "Masalan: Karimov Aziz Abdullayevich",
].join("\n");

/**
 * Javob shu savolgami.
 *
 * Sarlavha bo'yicha tekshiriladi: savol boshqa chatga uzatilishi va
 * u yerdan javob berilishi mumkin, lekin matn o'zgarmaydi.
 */
export function isIntakeLinkNamePrompt(text: string | null | undefined): boolean {
  return (text ?? "").includes("🔗 ANKETA HAVOLASI");
}

/* --------------------------- jins so'rash -------------------------------- */

/**
 * Ism belgisi.
 *
 * Havola yaratilgandan keyingi xabarda bu belgi BO'LMAYDI — aynan
 * shu narsa takroriy bosishni to'xtatadi.
 */
const NAME_MARKER = "👤 ";

export function buildGenderPrompt(fullName: string, hint: "male" | "female" | null): string {
  const lines = ["🔗 ANKETA HAVOLASI", "", `${NAME_MARKER}${fullName}`, ""];
  if (hint) {
    // Taxmin KO'RSATILADI, lekin tanlanmaydi: ism bo'yicha jinsni
    // aniqlash ko'p hollarda xato bo'ladi va noto'g'ri jins anketa
    // mavzusini ham, rasm promtini ham buzadi.
    lines.push(`Taxmin: ${hint === "male" ? "erkak" : "ayol"}. Tasdiqlang yoki o‘zgartiring.`);
  }
  lines.push("Jinsini tanlang:");
  return lines.join("\n");
}

/** Jins savolidagi ismni qaytaradi. Topilmasa null. */
export function parseNameFromGenderPrompt(text: string | null | undefined): string | null {
  const value = text ?? "";
  if (!value.includes("🔗 ANKETA HAVOLASI")) return null;

  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(NAME_MARKER)) {
      const name = trimmed.slice(NAME_MARKER.length).trim();
      return name === "" ? null : name;
    }
  }
  return null;
}

/* ------------------------------ callback --------------------------------- */

const CALLBACK_PREFIX = "ilg:";

export type IntakeGender = "male" | "female";

export function intakeGenderCallbackData(gender: IntakeGender): string {
  return `${CALLBACK_PREFIX}${gender === "male" ? "m" : "f"}`;
}

export function parseIntakeGenderCallback(
  data: string | null | undefined,
): IntakeGender | null {
  if (!data || !data.startsWith(CALLBACK_PREFIX)) return null;
  const code = data.slice(CALLBACK_PREFIX.length);
  if (code === "m") return "male";
  if (code === "f") return "female";
  return null;
}

export interface IntakeInlineButton {
  text: string;
  callback_data: string;
}

export function buildGenderKeyboard(): IntakeInlineButton[][] {
  return [
    [
      { text: "👨 Erkak", callback_data: intakeGenderCallbackData("male") },
      { text: "👩 Ayol", callback_data: intakeGenderCallbackData("female") },
    ],
  ];
}

/* ------------------------------- natija ---------------------------------- */

export const GENDER_LABELS: Record<IntakeGender, string> = {
  male: "erkak",
  female: "ayol",
};

/**
 * Nomzodga yuboriladigan ko'rsatma.
 *
 * MATN `sales/flow/templates.ts` DAGI `intake_instructions` BILAN
 * AYNAN BIR XIL. U yerda `isExact: true` deb belgilangan — ya'ni
 * tahririyat yozgan va o'zgartirilmaydigan matn. Ikki nusxa
 * yozilsa, ular vaqt o'tib ajralib ketardi va bir xil nomzod
 * kanalga qarab boshqa-boshqa ko'rsatma olardi.
 *
 * Bu yerda nusxa turibdi, chunki modul SOF: u sotuv oqimining
 * server kodini import qila olmaydi. Testda ikkalasi
 * solishtiriladi.
 */
export const INTAKE_INSTRUCTIONS = `LINKni imkon qadar tezroq toldiirb javoblarni yuboring u vaqtinchalik link va tahiman bir necha soatda yaroqsiz boladi

Rasm AYNAN linkdagi birinchi sahifadagi promt bilan yaratilishi shart

promtni nusxalang va rasmingiz bilan birga ChatGPT yoki Gemini’ga bering. Tayyor natijani yuqoridagi «Rasm yuklash» tugmasi orqali joylang.

Boshqa usulda tayyorlangan yoki oddiy rasm qabul qilinmaydi — bunday holatda maqola chiqarilmaydi.`;

/** Telegram HTML rejimida faqat shu uchtasi qochiriladi. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Tayyor xabar — BITTA BOSISHDA NUSXALANADI.
 *
 * Butun matn `<pre>` blokida: Telegram'da bunday blok ustiga bir
 * marta bosilsa, uning HAMMA mazmuni nusxalanadi. Moderator
 * havolani va ko'rsatmani alohida-alohida belgilab o'tirmaydi —
 * bir bosish, keyin nomzodga qo'yish.
 *
 * ORTIQCHA SO'Z YO'Q. Sarlavha, ism, jins va muddat qatorlari
 * ATAYLAB olib tashlandi: bu matn nomzodga ketadi, moderatorga
 * emas, va undagi har ortiqcha qator nusxalashda ham ko'chib
 * o'tardi.
 */
export function buildIntakeLinkResult(input: {
  fullName: string;
  gender: IntakeGender;
  link: string;
  expiresAt: string | null;
}): string {
  return `<pre>${escapeHtml(`${input.link}\n${INTAKE_INSTRUCTIONS}`)}</pre>`;
}

/** Ism yetarli bo'lmaganda qaytariladigan savol — oqim uzilmasin. */
export function buildNameRetryPrompt(reason: string): string {
  return [
    "🔗 ANKETA HAVOLASI",
    "",
    `Ism qabul qilinmadi: ${reason}.`,
    "Kamida familiya va ismni yozing.",
    "Masalan: Karimov Aziz",
  ].join("\n");
}

/**
 * Moderator yozgan matnni tozalaydi.
 *
 * Apostrof variantlari bir xillashtiriladi — "O‘ktam" va "O'ktam"
 * bir xil nomzod bo'lishi kerak.
 */
export function cleanNameInput(text: string | null | undefined): string {
  return normalizeApostrophes(text ?? "").trim().slice(0, 200);
}
