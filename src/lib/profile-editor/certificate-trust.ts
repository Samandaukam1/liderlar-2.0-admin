/**
 * SERTIFIKAT ISHONCH DARAJALARI — SOF MODUL.
 *
 * `server-only` YO'Q va bo'lmasligi KERAK: bu qiymatlarni mijoz
 * komponenti ham ishlatadi (ko'rik tugmalari).
 *
 * Avval ular `certificate-review-service.ts` da edi va mijoz
 * komponenti ulardan import qilgandi — natijada `server-only`
 * chegarasi buzilib, build yiqildi. `tsc` va `eslint` bu xatoni
 * TUTMAYDI, faqat `npm run build` tutadi.
 */

export const TRUST_CHOICES = ["verified", "user_entered", "rejected"] as const;

export type TrustChoice = (typeof TRUST_CHOICES)[number];

export function isTrustChoice(value: unknown): value is TrustChoice {
  return typeof value === "string" && (TRUST_CHOICES as readonly string[]).includes(value);
}

/**
 * Tugma matnlari.
 *
 * O'rtadagi daraja uzun yozilgan — "Foydalanuvchi kiritgan sifatida
 * ochish". Qisqartirish ("Ochish") adminni nima bo'layotganini
 * noto'g'ri tushunishga olib kelardi: bu tasdiqlash EMAS.
 */
export const TRUST_LABEL: Record<TrustChoice, string> = {
  verified: "Tasdiqlash",
  user_entered: "Foydalanuvchi kiritgan sifatida ochish",
  rejected: "Qaytarish",
};
