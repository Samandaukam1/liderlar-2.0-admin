/**
 * SHAXSIY TAVSIYA KODI — SOF MODUL.
 *
 * Har bir akkauntda bitta shaxsiy kod bo'ladi va u ommaviy profilning
 * tubida ko'rinadi. Nomzod arizada boshqa nomzodning kodini yozsa,
 * tavsiya shu kod egasiga yoziladi.
 *
 * BU KOORDINATOR PROMO KODI EMAS. Koordinator kodi lidni marshrutlaydi
 * va nomzodni tekinga chiqaradi; shaxsiy kod esa faqat ATRIBUTSIYA
 * beradi. Ikkisi bitta maydonga yozilsa ham, server ularni ajratadi.
 *
 * Hech narsa import qilinmaydi: testlar `@/` taxallusini yecha olmaydi.
 */

/* ========================================================================= *
 * CHALKASHADIGAN BELGILAR — ENG MUHIM QISM
 * ========================================================================= */

/**
 * Kod alifbosi: chalkashadigan belgilar BUTUNLAY chiqarib tashlangan.
 *
 * NEGA: mavjud promo moslashtiruvchisi (`foldPromoCode`) 0/O, 1/I/L,
 * 5/S, 8/B, 2/Z, 6/G ni BITTA belgi deb qaraydi va ustiga yaqin
 * kodlarni ham moslashtiradi. Agar kod ichida shu belgilar bo'lsa,
 * "ASADBEK8X" va "ASADBEKBX" bitta kod bo'lib qolardi — ya'ni tavsiya
 * BOSHQA ODAMGA yozilishi mumkin edi.
 *
 * Buni "unikal indeks ushlaydi" deb o'tkazib yuborish xato: indeks
 * satrlarni solishtiradi, moslashtiruvchi esa shakllarni. Ikkovi
 * boshqa javob beradi.
 *
 * Shuning uchun alifboda har bir chalkash sinfdan BITTA vakil ham
 * qoldirilmagan — hech biri yo'q. Qolgani 20 harf va 4 raqam.
 */
const ALPHABET = "ACDEFHJKMNPQRTUVWXY3479";

/**
 * ISM QISMIDAN CHALKASH BELGILAR OLIB TASHLANMAYDI.
 *
 * Avval shunday qilingan edi va natija yaroqsiz chiqdi: "Dilnoza" dan
 * I, L, O, Z tashlanib "DNA" qolardi — kod egasini ko'rsatmaydi va
 * minimal uzunlikdan ham qisqa. Holbuki §13 kodning O'QILADIGAN
 * bo'lishini talab qiladi.
 *
 * Xavfsizlik boshqa yo'l bilan ta'minlanadi:
 *   1. Tasodifiy qo'shimcha chalkashsiz alifbodan olinadi, ya'ni bitta
 *      ismning ikki kodi fold ostida ham ajralib turadi.
 *   2. Xizmat qatlami yangi kodni mavjud kodlarning FOLD shakllariga
 *      qarshi tekshiradi (`foldCode`), ya'ni turli ismlar tasodifan
 *      bir xil shaklga tushsa ham to'qnashuv o'tmaydi.
 */

/**
 * Solishtirish uchun chalkash sinflarni birlashtiradi.
 *
 * Mavjud `foldPromoCode` bilan BIR XIL sinflar: 0/O, 1/I/L, 5/S, 8/B,
 * 2/Z, 6/G. Bu funksiya yangi kodning mavjudlari bilan to'qnashmasligini
 * tekshirish uchun — SAQLASH uchun emas.
 */
export function foldCode(input: string | null | undefined): string {
  let out = normalizeCode(input);
  const classes: ReadonlyArray<readonly [RegExp, string]> = [
    [/[0O]/g, "0"],
    [/[1IL]/g, "1"],
    [/[5S]/g, "5"],
    [/[8B]/g, "8"],
    [/[2Z]/g, "2"],
    [/[6G]/g, "6"],
  ];
  for (const [pattern, replacement] of classes) out = out.replace(pattern, replacement);
  return out;
}

/* ========================================================================= *
 * KIRILLCHADAN LOTINCHAGA
 * ========================================================================= */

const CYRILLIC: Readonly<Record<string, string>> = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "J",
  З: "Z", И: "I", Й: "Y", К: "K", Л: "L", М: "M", Н: "N", О: "O",
  П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "X", Ц: "TS",
  Ч: "CH", Ш: "SH", Щ: "SH", Ъ: "", Ы: "I", Ь: "", Э: "E", Ю: "YU",
  Я: "YA", Ғ: "G", Қ: "Q", Ҳ: "H", Ў: "O",
};

function transliterate(text: string): string {
  let out = "";
  for (const ch of text.toUpperCase()) out += CYRILLIC[ch] ?? ch;
  return out;
}

/* ========================================================================= *
 * KOD SHAKLI
 * ========================================================================= */

export const CODE_MIN_LENGTH = 6;
export const CODE_MAX_LENGTH = 14;

/** Ism qismining uzunligi: kod qisqa va o'qiladigan bo'lishi kerak (§13). */
const NAME_PART_MAX = 9;
/** Tasodifiy qism: 2 belgi 23² ≈ 529 variant beradi — bitta ism uchun yetarli. */
const SUFFIX_LENGTH = 2;

/**
 * Ismdan kodning o'qiladigan qismini yasaydi.
 *
 * FAMILIYA EMAS, ISM: "Asadbek Azamov" -> "ASADBEK". Kod egasini
 * ko'rsatishi kerak, lekin to'liq shaxsni oshkor qilmasligi ham
 * ma'qul — u ommaviy joyda turadi.
 */
export function nameBase(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return transliterate(first).replace(/[^A-Z]/g, "").slice(0, NAME_PART_MAX);
}

/**
 * Nomdan kod yasaydi.
 *
 * `randomChar` — tashqaridan beriladigan tasodif manbasi. Sof modul
 * `crypto` ni import qila olmaydi va testda tasodif takrorlanadigan
 * bo'lishi kerak.
 *
 * Ism lotin harfsiz chiqsa (masalan faqat belgi yoki bo'sh), zaxira
 * asos ishlatiladi: kod HAR DOIM yasalishi kerak, aks holda akkaunt
 * kodsiz qolardi.
 */
export function buildCode(fullName: string | null | undefined, randomChar: () => string): string {
  const base = nameBase(fullName);
  const stem = base.length >= 3 ? base : "LIDER";

  /*
   * QO'SHIMCHA UZUNLIGI MINIMAL KOD UZUNLIGINI KAFOLATLAYDI.
   *
   * Qisqa ism ("Ali") uchun 2 belgi yetmaydi va kod o'z shakl
   * tekshiruvidan o'tmay qolardi — ya'ni generator yaroqsiz kod
   * ishlab chiqarardi.
   */
  const suffixLength = Math.max(SUFFIX_LENGTH, CODE_MIN_LENGTH - stem.length);

  let suffix = "";
  for (let i = 0; i < suffixLength; i += 1) suffix += randomChar();

  return (stem + suffix).slice(0, CODE_MAX_LENGTH);
}

/**
 * Alifbodan tasodifiy belgi tanlaydigan funksiya yasaydi.
 *
 * `randomInt` — 0..max-1 oralig'ida son qaytaradigan manba.
 */
export function charPicker(randomInt: (max: number) => number): () => string {
  return () => ALPHABET[randomInt(ALPHABET.length)]!;
}

/* ========================================================================= *
 * SOLISHTIRISH
 * ========================================================================= */

/**
 * Kodni solishtirish shakliga keltiradi.
 *
 * Saqlash uchun EMAS — faqat "bu ikkovi bitta kodmi" savoliga javob
 * berish uchun. Bizning kodlarda chalkash belgi yo'q, lekin
 * FOYDALANUVCHI yozgan matnda bo'lishi mumkin: u "ASADBEKO" deb
 * yozishi, kod esa "ASADBEK0" bo'lishi mumkin emas (0 alifboda yo'q),
 * ammo teskarisi — u "0" yozib, kodda "O" bo'lishi ham mumkin emas.
 *
 * Shu sababli bu funksiya faqat bo'shliq/tire/registrni tozalaydi va
 * chalkash belgilarni BIRLASHTIRMAYDI: birlashtirish ikki haqiqiy
 * kodni bitta qilib qo'yish xavfini qaytarardi.
 */
export function normalizeCode(input: string | null | undefined): string {
  return transliterate((input ?? "").normalize("NFKC"))
    .replace(/[\s\-_.]+/g, "")
    .toUpperCase();
}

export type CodeProblem = "empty" | "too_short" | "too_long" | "shape";

export const CODE_PROBLEM_TEXT: Record<CodeProblem, string> = {
  empty: "Promo kodni kiriting.",
  too_short: "Promo kod juda qisqa.",
  too_long: "Promo kod juda uzun.",
  shape: "Promo kodda faqat harf va raqam bo'ladi.",
};

/**
 * Kiritilgan matn shaxsiy tavsiya kodi SHAKLIGA to'g'ri keladimi.
 *
 * Bu "kod mavjudmi" degani EMAS. Mavjudligi bazada tekshiriladi.
 * Shakl tekshiruvi bazaga bormasdan ochiq-oydin xato matnlarni
 * rad etish uchun.
 */
export function checkCodeShape(input: string | null | undefined): {
  ok: boolean;
  code: string;
  problem?: CodeProblem;
} {
  const code = normalizeCode(input);

  if (code === "") return { ok: false, code, problem: "empty" };
  if (!/^[A-Z0-9]+$/.test(code)) return { ok: false, code, problem: "shape" };
  if (code.length < CODE_MIN_LENGTH) return { ok: false, code, problem: "too_short" };
  if (code.length > CODE_MAX_LENGTH) return { ok: false, code, problem: "too_long" };

  return { ok: true, code };
}

/* ========================================================================= *
 * TAVSIYA BOSQICHLARI
 * ========================================================================= */

export const REFERRAL_STAGES = [
  "visited",
  "application",
  "registered",
  "activated",
  "payment_confirmed",
] as const;

export type ReferralStage = (typeof REFERRAL_STAGES)[number];

/**
 * BALL BERADIGAN YAGONA SHART.
 *
 * Egasining qarori (2026-10-01): ball faqat tavsiya qilingan nomzod
 * TO'LOV QILGAN **va** profili CHOP ETILGAN bo'lsa beriladi.
 *
 * Ya'ni `payment_confirmed` bosqichi O'ZI YETARLI EMAS. Ariza
 * topshirish va tekin qabul ball bermaydi: ball sotib olinadigan
 * narsa emas, tasdiqlangan hissa bo'lishi kerak.
 *
 * Spec'dagi "registered +10 / approved +20" bu loyihada ATAYLAB
 * qo'llanmaydi.
 */
export function qualifiesForPoints(input: {
  stage: ReferralStage;
  /** Tavsiya qilingan nomzodning profili ommaviy chop etilganmi. */
  referredPublished: boolean;
  /** O'ziga o'zi tavsiya bo'lmasligi. */
  selfReferral: boolean;
}): boolean {
  if (input.selfReferral) return false;
  if (input.stage !== "payment_confirmed") return false;
  return input.referredPublished;
}

/**
 * Ball yozuvi uchun takrorlanmaslik kaliti.
 *
 * `point_ledger.idempotency_key` unikal — ya'ni bir xil kalit bilan
 * ikkinchi yozuv BAZADA yiqiladi. Ball ikki marta tushishi ilova
 * mantig'i bilan emas, shu indeks bilan to'siladi.
 */
export function pointKey(attributionId: string, stage: ReferralStage): string {
  return `referral:${attributionId}:${stage}`;
}

export function milestoneKey(profileId: string, milestone: number): string {
  return `referral:${profileId}:milestone:${milestone}`;
}

/* ========================================================================= *
 * BOSQICHLAR TARTIBI
 * ========================================================================= */

const STAGE_ORDER: Readonly<Record<ReferralStage, number>> = {
  visited: 0,
  application: 1,
  registered: 2,
  activated: 3,
  payment_confirmed: 4,
};

/**
 * Bosqich oldinga siljiydimi.
 *
 * ORQAGA SILJISH RAD ETILADI: to'lov tasdiqlangandan keyin bosqich
 * "ariza"ga qaytsa, ball berilgan atributsiya ball bermaydigan holatga
 * tushib qolardi va hisobot o'zini-o'ziga zid ko'rsatardi.
 *
 * To'lov qaytarilgan holat alohida ish: u teskari ball yozuvi bilan
 * hal qilinadi (§45), bosqichni qaytarish bilan emas.
 */
export function advancesStage(current: ReferralStage, next: ReferralStage): boolean {
  return STAGE_ORDER[next] > STAGE_ORDER[current];
}
