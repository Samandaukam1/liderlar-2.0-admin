/**
 * ODAM TOPSHIRIG'INING TURI — SOF QOIDALAR (13-band).
 *
 * Alohida modul, chunki bazaga tegadigan xizmat testdan
 * import qilinmaydi (`@/` taxallusi `node --test` da
 * yechilmaydi). Qoida shu yerda, I/O qo'shni faylda.
 */

import type { ReferencedObject } from "./message-intent.ts";

export const ESCALATION_CATEGORIES = [
  "payment_check",
  "article_status",
  "application_status",
  "account_problem",
  "technical_problem",
  "content_correction",
  "unknown_business_fact",
  "other",
] as const;
export type EscalationCategory = (typeof ESCALATION_CATEGORIES)[number];

export const ESCALATION_CATEGORY_LABELS: Record<EscalationCategory, string> = {
  payment_check: "To‘lovni tekshirish",
  article_status: "Maqola holati",
  application_status: "Ariza holati",
  account_problem: "Akkaunt muammosi",
  technical_problem: "Texnik nosozlik",
  content_correction: "Matnni tuzatish",
  unknown_business_fact: "Noma’lum biznes fakti",
  other: "Boshqa",
};

/** Savol qaysi obyekt haqida bo'lsa — shu turdagi topshiriq. */
export function categoryForObject(object: ReferencedObject): EscalationCategory {
  switch (object) {
    case "payment":
      return "payment_check";
    case "article":
      return "article_status";
    case "intake":
    case "identity":
      return "application_status";
    case "certificate":
      return "unknown_business_fact";
    default:
      return "other";
  }
}

/**
 * Topshiriq YARATILGANDAN KEYIN aytiladigan matn (12-band).
 *
 * "Tekshirib xabar beraman" degan va'da faqat shu yerda,
 * ya'ni topshiriq HAQIQATAN yozilgandan keyin beriladi.
 */
export function escalationAcknowledgement(category: EscalationCategory): string {
  switch (category) {
    case "payment_check":
      return "To‘lovingiz holatini men bu yerdan ko‘ra olmayman — so‘rovingizni mas’ul hamkasbimga yo‘naltirdim, u tekshirib javob beradi.";
    case "article_status":
      return "Maqolangiz holatini mas’ul hamkasbim tekshiradi — so‘rovingizni unga yo‘naltirdim.";
    case "application_status":
      return "Anketangiz holatini mas’ul hamkasbim tekshiradi — so‘rovingizni unga yo‘naltirdim.";
    default:
      return "So‘rovingizni mas’ul hamkasbimga yo‘naltirdim, u javob beradi.";
  }
}

/**
 * Topshiriq YARATILMAGANDA aytiladigan matn.
 *
 * VA'DA YO'Q. Ilgari bot har holatda "tekshirib xabar beraman"
 * derdi, lekin orqada hech qanday topshiriq yaratilmasdi —
 * ya'ni bu va'da bajarilmasdi (12-band).
 */
export const NO_ESCALATION_REPLY =
  "Bu ma’lumotni shu yerdagi ma’lumotlardan aniq ayta olmayman. " +
  "Administrator tekshiruvi kerak — iltimos, shu yerda yozib qoldiring, javobsiz qolmaydi.";
