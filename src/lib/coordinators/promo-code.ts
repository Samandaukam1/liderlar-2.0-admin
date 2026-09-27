/**
 * PROMO KOD QOIDALARI — SOF MODUL.
 *
 * Koordinator o'z kodini oladi; nomzod arizada shu kodni yozsa,
 * lid AYNAN o'sha koordinatorga boradi.
 *
 * NEGA SOF MODUL: kodni solishtirish nozik ish. Nomzod "ALI-2026"
 * deb yozadi, koordinator "ali 2026" deb kiritadi — ikkovi bitta
 * kod bo'lishi kerak, aks holda lid egasiga yetib bormaydi va
 * buni hech kim sezmaydi. Shuning uchun normallashtirish bitta
 * joyda va test bilan qoplangan.
 */

/** Kodning ruxsat etilgan uzunligi. */
export const PROMO_CODE_MIN_LENGTH = 3;
export const PROMO_CODE_MAX_LENGTH = 24;

/**
 * Solishtirish uchun yagona shakl.
 *
 * Bo'shliq, defis, pastki chiziq va nuqta OLIB TASHLANADI: odamlar
 * ularni ixtiyoriy qo'yadi va ular ma'no tashimaydi. Qolgani bosh
 * harfga o'tadi.
 *
 * Kirill harflari ATAYLAB o'zgartirilmaydi — kod identifikator,
 * matn emas; "ALI" ni "АЛИ" ga tenglashtirsak, ikki boshqa
 * koordinatorning kodi bir-biriga urilib ketishi mumkin.
 */
export function normalizePromoCode(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFKC")
    .replace(/[\s\-_.]+/g, "")
    .toUpperCase();
}

export interface PromoCodeCheck {
  ok: boolean;
  /** Saqlashga tayyor shakl. */
  code: string;
  reason?: string;
}

/**
 * Kiritilgan kodni tekshiradi.
 *
 * Bo'sh qiymat XATO EMAS: promo kod ixtiyoriy va uni o'chirish
 * ham kerak bo'ladi.
 */
export function validatePromoCode(input: string | null | undefined): PromoCodeCheck {
  const raw = (input ?? "").trim();
  if (raw === "") return { ok: true, code: "" };

  const code = normalizePromoCode(raw);

  if (code.length < PROMO_CODE_MIN_LENGTH) {
    return { ok: false, code, reason: `Kod kamida ${PROMO_CODE_MIN_LENGTH} belgidan bo‘lsin.` };
  }
  if (code.length > PROMO_CODE_MAX_LENGTH) {
    return { ok: false, code, reason: `Kod ${PROMO_CODE_MAX_LENGTH} belgidan oshmasin.` };
  }
  /*
   * FAQAT HARF VA RAQAM.
   *
   * Emoji yoki tinish belgisi bo'lgan kodni nomzod hech qachon
   * xatosiz ko'chirib yoza olmaydi.
   */
  if (!/^[\p{L}\p{N}]+$/u.test(code)) {
    return { ok: false, code, reason: "Kodda faqat harf va raqam bo‘lsin." };
  }

  return { ok: true, code };
}

/** Ikki kod bir xilmi (registr va ajratgichlarga qaramasdan). */
export function promoCodesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizePromoCode(a);
  const right = normalizePromoCode(b);
  return left !== "" && left === right;
}

/* ========================================================================= *
 * MARSHRUTLASH QARORI
 * ========================================================================= */

export interface PromoRoutingDecision {
  /** Lid biriktiriladigan koordinator. null — oddiy marshrutlash. */
  coordinatorId: string | null;
  /**
   * Muddat tugaganda boshqa koordinatorga o'tadimi.
   *
   * Promo lidda HAR DOIM false: nomzod tekinga chiqariladi, ya'ni
   * bu lid boshqa koordinatorning ishi emas va uning hisobiga
   * yozilmasligi kerak.
   */
  reassignOnExpiry: boolean;
  reason: "promo_match" | "promo_unknown" | "no_promo";
}

export interface PromoOwner {
  id: string;
  promoCode: string | null;
  isActive: boolean;
}

/**
 * Arizadagi kod bo'yicha egasini topadi.
 *
 * KOD TOPILMASA LID YO'QOLMAYDI: qaror `promo_unknown` bo'ladi va
 * lid oddiy hududiy marshrutlashga tushadi. Noto'g'ri yozilgan kod
 * uchun nomzodni javobsiz qoldirish eng yomon natija bo'lardi.
 */
export function resolvePromoRouting(
  applicationPromoCode: string | null | undefined,
  owners: readonly PromoOwner[],
): PromoRoutingDecision {
  const code = normalizePromoCode(applicationPromoCode);
  if (code === "") {
    return { coordinatorId: null, reassignOnExpiry: true, reason: "no_promo" };
  }

  const owner = owners.find(
    (candidate) => candidate.isActive && promoCodesMatch(candidate.promoCode, code),
  );

  if (!owner) {
    return { coordinatorId: null, reassignOnExpiry: true, reason: "promo_unknown" };
  }

  return { coordinatorId: owner.id, reassignOnExpiry: false, reason: "promo_match" };
}
