/**
 * HUDUD SO'ROVNOMASI — sof modul.
 *
 * Kanalga tashlash uchun tayyor Telegram so'rovnomasi: obunachilar
 * qaysi hududdan ekanini o'zi aytadi. Natija keyinchalik hududiy
 * koordinatorlar tizimiga asos bo'ladi.
 *
 * SOF MODUL — ro'yxat va chegaralar testda tekshiriladi.
 */

/**
 * O'ZBEKISTONNING BARCHA HUDUDLARI — 14 TA.
 *
 * 12 viloyat + Qoraqalpog'iston Respublikasi + Toshkent shahri.
 *
 * TOSHKENT IKKI MARTA UCHRAYDI VA BU XATO EMAS: "Toshkent
 * viloyati" va "Toshkent shahri" — alohida ma'muriy birliklar.
 * Ularni birlashtirish poytaxt va uning atrofidagi tumanlarni bir
 * xil deb ko'rsatardi, holbuki bu ikki butunlay boshqa auditoriya.
 *
 * Tartib ALIFBO bo'yicha, Qoraqalpog'iston birinchi: u respublika
 * va rasmiy ro'yxatlarda odatda boshida turadi. Toshkent shahri
 * oxirida — u viloyat emas.
 */
export const UZBEKISTAN_REGIONS: readonly string[] = [
  "Qoraqalpog‘iston Respublikasi",
  "Andijon viloyati",
  "Buxoro viloyati",
  "Farg‘ona viloyati",
  "Jizzax viloyati",
  "Namangan viloyati",
  "Navoiy viloyati",
  "Qashqadaryo viloyati",
  "Samarqand viloyati",
  "Sirdaryo viloyati",
  "Surxondaryo viloyati",
  "Toshkent viloyati",
  "Xorazm viloyati",
  "Toshkent shahri",
];

/** So'rovnoma savoli. */
export const REGION_POLL_QUESTION = "Qaysi viloyatdan bizni kuzatyapsiz siz?";

/* ------------------------- Telegram chegaralari -------------------------- */

/** `sendPoll`: savol 1–300 belgi. */
export const POLL_QUESTION_MAX = 300;
/** `sendPoll`: har variant 1–100 belgi. */
export const POLL_OPTION_MAX = 100;
/** `sendPoll`: 1–30 variant. */
export const POLL_OPTIONS_MAX = 30;

export interface RegionPoll {
  question: string;
  options: readonly string[];
  /**
   * KANALGA TASHLASH UCHUN ANONIM BO'LISHI SHART.
   *
   * Telegram kanallarda faqat anonim so'rovnomaga ruxsat beradi, va
   * anonim bo'lmagan so'rovnomani kanalga uzatib ham bo'lmaydi.
   * Moderator uni o'z chatidan kanalga forward qiladi, shuning
   * uchun bu qiymat qat'iy.
   */
  isAnonymous: true;
  /** Bitta odam bitta hududdan. */
  allowsMultipleAnswers: false;
}

export function buildRegionPoll(): RegionPoll {
  return {
    question: REGION_POLL_QUESTION,
    options: UZBEKISTAN_REGIONS,
    isAnonymous: true,
    allowsMultipleAnswers: false,
  };
}

/**
 * So'rovnoma Telegram chegaralariga sig'adimi.
 *
 * Chaqiruvdan OLDIN tekshiriladi: Telegram chegaradan oshgan
 * so'rovnomani 400 bilan rad etadi va moderator "nega ishlamadi"
 * degan savol bilan qoladi.
 */
export function validateRegionPoll(poll: RegionPoll): { ok: boolean; error: string | null } {
  if (poll.question.trim() === "" || poll.question.length > POLL_QUESTION_MAX) {
    return { ok: false, error: `Savol 1–${POLL_QUESTION_MAX} belgi bo‘lishi kerak` };
  }
  if (poll.options.length < 1 || poll.options.length > POLL_OPTIONS_MAX) {
    return { ok: false, error: `Variantlar soni 1–${POLL_OPTIONS_MAX} bo‘lishi kerak` };
  }
  for (const option of poll.options) {
    if (option.trim() === "" || option.length > POLL_OPTION_MAX) {
      return { ok: false, error: `Variant 1–${POLL_OPTION_MAX} belgi: “${option}”` };
    }
  }
  const unique = new Set(poll.options);
  if (unique.size !== poll.options.length) {
    // Takroriy variant natijani ma'nosiz qiladi: ovozlar ikkiga
    // bo'linib ketadi.
    return { ok: false, error: "Variantlar takrorlanmasligi kerak" };
  }
  return { ok: true, error: null };
}

/** Moderatorga so'rovnoma bilan birga yuboriladigan qisqa izoh. */
export const REGION_POLL_HINT =
  "So‘rovnoma tayyor. Uni shu yerdan kanalga uzating (forward).";

export const REGION_POLL_BUTTON_LABEL = "📊 Hudud so‘rovnomasi";
export const REGION_POLL_COMMAND = "/sorovnoma";
