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
  "Andijon viloyati",
  "Buxoro viloyati",
  "Farg‘ona viloyati",
  "Jizzax viloyati",
  "Namangan viloyati",
  "Navoiy viloyati",
  "Qashqadaryo viloyati",
  "Qoraqalpog‘iston Respublikasi",
  "Samarqand viloyati",
  "Sirdaryo viloyati",
  "Surxondaryo viloyati",
  "Toshkent shahri",
  "Toshkent viloyati",
  "Xorazm viloyati",
];

/** So'rovnoma savoli. */
export const REGION_POLL_QUESTION = "Qaysi viloyatdan bizni kuzatyapsiz siz?";

/* ------------------------- Telegram chegaralari -------------------------- */

/** `sendPoll`: savol 1–300 belgi. */
export const POLL_QUESTION_MAX = 300;
/** `sendPoll`: har variant 1–100 belgi. */
export const POLL_OPTION_MAX = 100;
/**
 * `sendPoll`: 1–12 variant.
 *
 * QIYMAT HUJJATDAN OLINGAN va Telegram'ning o'z xatosi bilan
 * tasdiqlangan: "Bad Request: poll can't have more than 12 options".
 *
 * Bu yerda avval 30 turgan edi. Men uni hujjat sahifasini o'qigan
 * yordamchi xulosasidan olganman va tekshirmaganman; test esa xatoni
 * ushlamagan, chunki u shu konstantani o'ziga solishtirardi —
 * haqiqatga emas. Endi chegara so'rovnoma qurilishini BOSHQARADI
 * (pastdagi bo'lish), ya'ni noto'g'ri qiymat darhol ko'rinadi.
 */
export const POLL_OPTIONS_MAX = 12;

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

/**
 * So'rovnomalar RO'YXATI.
 *
 * NEGA BITTA EMAS: hududlar 14 ta, Telegram esa bitta so'rovnomaga
 * 12 tadan ko'p variant qo'ymaydi. Ro'yxat chegaraga qarab
 * bo'linadi, ya'ni kelajakda hudud qo'shilsa yoki chegara o'zgarsa
 * kod o'zi moslashadi — qo'lda qayta bo'lish kerak bo'lmaydi.
 *
 * BO'LISH STATISTIKANI BUZMAYDI: har odam o'z hududi turgan
 * so'rovnomada BIR MARTA ovoz beradi, ikkinchisida uning hududi
 * yo'q. Yakuniy taqsimot — ikkala so'rovnoma natijasining yig'indisi.
 *
 * Bo'laklar TENG: 12+2 bo'lganda ikkinchisi "qo'shimcha" bo'lib
 * ko'rinadi va e'tibordan qoladi. Alifbo tartibi saqlanadi va
 * savolda oralig'i aytiladi, shunda odam qaysi ro'yxatga qarashni
 * darhol biladi.
 */
export function buildRegionPolls(regions: readonly string[] = UZBEKISTAN_REGIONS): RegionPoll[] {
  const chunks = splitEvenly(regions, POLL_OPTIONS_MAX);

  return chunks.map((options, index) => ({
    question:
      chunks.length === 1
        ? REGION_POLL_QUESTION
        : `${REGION_POLL_QUESTION} (${index + 1}/${chunks.length} — ` +
          `${firstWord(options[0])}dan ${firstWord(options[options.length - 1])}gacha)`,
    options,
    isAnonymous: true,
    allowsMultipleAnswers: false,
  }));
}

/**
 * Ro'yxatni imkon qadar TENG bo'laklarga bo'ladi.
 *
 * `Math.ceil(n / max)` bo'lak soni, keyin har bo'lak shu songa
 * qarab teng taqsimlanadi. 14 va 12 uchun: 2 bo'lak, 7+7.
 */
function splitEvenly(items: readonly string[], max: number): string[][] {
  if (items.length === 0) return [];
  const count = Math.ceil(items.length / max);
  const size = Math.ceil(items.length / count);

  const chunks: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** "Toshkent shahri" -> "Toshkent" — savol sarlavhasi qisqa bo'lsin. */
function firstWord(region: string): string {
  return region.split(" ")[0];
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

/** Moderatorga so'rovnomalar bilan birga yuboriladigan qisqa izoh. */
export function buildRegionPollHint(pollCount: number): string {
  if (pollCount === 1) {
    return "So‘rovnoma tayyor. Uni shu yerdan kanalga uzating (forward).";
  }
  return [
    `So‘rovnoma tayyor — ${pollCount} qism.`,
    "",
    `Telegram bitta so‘rovnomaga ${POLL_OPTIONS_MAX} tadan ko‘p variant qo‘ymaydi,`,
    `hudud esa ${UZBEKISTAN_REGIONS.length} ta. Ikkalasini ham kanalga uzating.`,
    "Har kim o‘z hududi turgan qismda bir marta ovoz beradi;",
    "yakuniy natija ikkovining yig‘indisi.",
  ].join("\n");
}

export const REGION_POLL_BUTTON_LABEL = "📊 Hudud so‘rovnomasi";
export const REGION_POLL_COMMAND = "/sorovnoma";
