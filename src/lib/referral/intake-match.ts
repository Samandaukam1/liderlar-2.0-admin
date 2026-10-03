/**
 * TAVSIYA: ARIZA -> ANKETA BOG'LANISHI (SOF MODUL).
 *
 * Promo kod ARIZAda yoziladi, to'lov esa ANKETAda belgilanadi va ular
 * bazada bir-biriga bog'lanmagan: anketani operator yoki bot faqat ism
 * bilan yaratadi. Egasining qarori (2026-10-03): ikkalasi TELEFON raqami
 * bo'yicha bog'lanadi.
 *
 * Bu modul hech narsa import qilmaydi — testlar `@/` taxallusini
 * ko'rmaydi va qaror mantig'i bazasiz tekshiriladi.
 */

/** Telefon kaliti uzunligi — O'zbekiston mobil raqamining o'zi. */
export const PHONE_KEY_LENGTH = 9;

/**
 * Telefonni solishtirish kaliti: oxirgi 9 raqam.
 *
 * NEGA TO'LIQ RAQAM EMAS: arizada raqam "+998 90 123-45-67" yoki
 * "901234567" ko'rinishida kelishi mumkin, anketada esa `+998901234567`.
 * Mamlakat kodi va bezaklar tashlanadi — aks holda bir odamning ikki
 * yozuvi "boshqa-boshqa" bo'lib chiqardi.
 *
 * 9 tadan kam raqam — kalit yo'q: qisqa qoldiq begona raqamlarga ham
 * mos kelib, ballni noto'g'ri odamga berardi.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < PHONE_KEY_LENGTH) return null;
  return digits.slice(-PHONE_KEY_LENGTH);
}

export interface PaidIntake {
  intakeId: string;
  /** Anketadan yaratilgan nomzod; `null` — hali yaratilmagan. */
  candidateId: string | null;
  paymentConfirmedAt: string | null;
}

export type IntakeMatch =
  | { kind: "match"; intakeId: string; candidateId: string }
  /** To'langan anketa yo'q yoki nomzod hali yaratilmagan — keyingi yurishda. */
  | { kind: "waiting" }
  /** Bitta raqamda bir nechta to'langan anketa — avtomatik tanlanmaydi. */
  | { kind: "ambiguous" }
  /** Nomzod allaqachon boshqa atributsiyaga bog'langan. */
  | { kind: "claimed" }
  /** To'lov arizadan OLDIN tasdiqlangan — bu ariza sabab bo'lmagan. */
  | { kind: "paid_before_application" };

/**
 * Arizaga mos TO'LANGAN anketani tanlaydi.
 *
 * `intakes` — shu telefon kalitiga mos FAQAT to'langan anketalar.
 */
export function pickIntakeForApplication(input: {
  applicationCreatedAt: string;
  intakes: readonly PaidIntake[];
  claimedCandidateIds: ReadonlySet<string>;
}): IntakeMatch {
  if (input.intakes.length === 0) return { kind: "waiting" };

  /*
   * BIR NECHTA TO'LANGAN ANKETA — TAXMIN QILINMAYDI.
   *
   * Bitta raqam (masalan, ota-ona telefoni) bir necha nomzodda turishi
   * mumkin. Qaysi biri shu ariza egasi ekanini bilmaymiz; noto'g'ri
   * tanlov ballni boshqa nomzod hisobidan berardi.
   */
  if (input.intakes.length > 1) return { kind: "ambiguous" };

  const intake = input.intakes[0];

  /*
   * TO'LOV ARIZADAN OLDIN — BOG'LANMAYDI.
   *
   * Aks holda allaqachon to'lagan nomzodning raqami bilan keyinroq kod
   * yozilgan ariza topshirib, uning to'lovini o'z tavsiyasi qilib olish
   * mumkin bo'lardi.
   */
  if (
    intake.paymentConfirmedAt !== null &&
    Date.parse(intake.paymentConfirmedAt) < Date.parse(input.applicationCreatedAt)
  ) {
    return { kind: "paid_before_application" };
  }

  // Nomzod nashrda yaratiladi — u bo'lmaguncha bog'lanadigan narsa yo'q.
  if (intake.candidateId === null) return { kind: "waiting" };

  /*
   * BIR NOMZOD — BIR TAVSIYACHI.
   *
   * Bazadagi unikal indeks faqat `referred_profile_id` da, akkauntsiz
   * nomzodda esa u bo'sh. Shu sababli tekshiruv shu yerda ham bor.
   */
  if (input.claimedCandidateIds.has(intake.candidateId)) return { kind: "claimed" };

  return { kind: "match", intakeId: intake.intakeId, candidateId: intake.candidateId };
}
