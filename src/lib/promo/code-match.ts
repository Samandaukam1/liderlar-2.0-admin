/**
 * PROMO KODNI MOSLASHTIRISH — SOF MODUL.
 *
 * Bu modul FAQAT BIR ISH uchun: muddati tugagan kodni TO'SISH.
 *
 * SHUNING UCHUN U ATAYLAB SAXIY. Nomzod kodni eshitib yozadi
 * yoki ko'chirib oladi, shuning uchun bitta kod o'nlab ko'rinishda
 * keladi:
 *
 *   TSULTAVSIYA · tsul-tavsiya · TSUL TAVSIYA
 *   TSULTAVSIYASIYA (bo'g'in takrorlangan)
 *   ЦУЛТАВСИЯ (kirillcha)
 *   TSULTAVS1YA (I o'rniga 1)
 *
 * Bularning hammasi bitta kod deb qaraladi.
 *
 * SAXIYLIK BU YERDA XAVFSIZ, chunki natija — RAD ETISH. Noto'g'ri
 * moslashtirsak, nomzod kodni o'chirib arizani yuboradi. Teskarisi
 * — muddati tugagan kodni o'tkazib yuborish — tekin maqola degani.
 *
 * DIQQAT: lid marshruti uchun bu modul ISHLATILMAYDI. U yerda
 * qat'iy solishtirish kerak (`coordinators/promo-code.ts`): saxiy
 * moslashtirish bir koordinatorning nomzodini boshqasiga berib
 * yuborardi.
 */

/** Nomzodga ko'rsatiladigan matn. */
export const EXPIRED_PROMO_MESSAGE = "Bu promo kod amal qilish muddati tugagan.";

/**
 * KIRILLDAN LOTINGA.
 *
 * Kod lotinda e'lon qilinadi, lekin klaviaturasi kirillda bo'lgan
 * odam uni kirillda yozadi. Ikkovini bir shaklga keltirmasak,
 * muddati tugagan kod kirillcha yozilib bemalol o'tib ketardi.
 */
const CYRILLIC: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts",
  ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu",
  я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

function transliterate(text: string): string {
  let out = "";
  for (const char of text) {
    const mapped = CYRILLIC[char.toLowerCase()];
    out += mapped === undefined ? char : mapped;
  }
  return out;
}

/**
 * CHALKASHADIGAN BELGILAR.
 *
 * Kod ko'z bilan ko'chiriladi: 0 va O, 1 va I, 5 va S ajratib
 * bo'lmaydi. Ro'yxat qisqa va ataylab — har qo'shimcha juft
 * noto'g'ri moslashtirish ehtimolini oshiradi.
 */
const CONFUSABLES: ReadonlyArray<readonly [RegExp, string]> = [
  [/[0O]/g, "0"],
  [/[1IL]/g, "1"],
  [/[5S]/g, "5"],
  [/[8B]/g, "8"],
  [/[2Z]/g, "2"],
  [/[6G]/g, "6"],
];

/**
 * Solishtirish uchun yagona shakl.
 *
 * SAQLASH uchun EMAS: bazada kod o'z ko'rinishida turadi, bu
 * faqat taqqoslash paytidagi ichki shakl.
 */
export function foldPromoCode(input: string | null | undefined): string {
  let out = transliterate((input ?? "").normalize("NFKC"))
    // Ajratgichlar ma'no tashimaydi: odamlar ularni ixtiyoriy qo'yadi.
    .replace(/[\s\-_.]+/g, "")
    .toUpperCase();
  for (const [pattern, replacement] of CONFUSABLES) out = out.replace(pattern, replacement);
  return out;
}

/** Damerau–Levenshtein: o'rin almashish ham BITTA xato. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    rows.push(new Array<number>(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + cost);
      }
    }
  }
  return rows[a.length][b.length];
}

/** Qisqa kodda bitta xato ham uni BOSHQA kodga aylantiradi. */
export function toleranceFor(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return 2;
}

/**
 * Kamida shuncha belgi bo'lsa, bo'lakni "qism" deb hisoblaymiz.
 *
 * Aks holda "AB" bilan boshlanadigan HAR QANDAY kod bir-biriga
 * mos kelib ketardi.
 */
const MIN_CONTAINMENT_LENGTH = 5;

/**
 * Ikki kod bir xil kodning ko'rinishlarimi.
 *
 * Uch qoida, tartib bilan:
 *   1. bir xil shakl;
 *   2. biri ikkinchisining boshi — "TSULTAVSIYASIYA" ichida
 *      "TSULTAVSIYA" bor, ya'ni bo'g'in takrorlangan;
 *   3. yozuvdagi bir-ikkita xato.
 */
export function looksLikeSameCode(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = foldPromoCode(a);
  const right = foldPromoCode(b);
  if (left === "" || right === "") return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;

  /*
   * FAQAT BOSHIDAN, ICHIDAN EMAS.
   *
   * "ichida bor" qoidasi juda keng edi: "TAVSIYA" kodi
   * "TSULTAVSIYA" ichida uchraydi va ikkovi bir kod deb
   * hisoblanardi — holbuki ular butunlay boshqa kampaniya
   * bo'lishi mumkin. Bo'g'in takrorlanishi esa doim OXIRIGA
   * qo'shiladi ("TSULTAVSIYA" -> "TSULTAVSIYASIYA"), ya'ni
   * boshidan tekshirish yetarli.
   */
  if (shorter.length >= MIN_CONTAINMENT_LENGTH && longer.startsWith(shorter)) return true;

  const tolerance = toleranceFor(shorter.length);
  if (tolerance === 0) return false;
  if (longer.length - shorter.length > tolerance) return false;

  return editDistance(left, right) <= tolerance;
}

/* ========================================================================= *
 * MUDDATI TUGAGAN KODNI TOPISH
 * ========================================================================= */

export interface ExpiredPromoCode {
  /** Bazadagi normallashtirilgan kod. */
  code: string;
  /** Admin yozgan ko'rinish — xabarda shu ko'rsatiladi. */
  rawCode: string;
  expiresAt: string | null;
}

export interface ExpiredPromoMatch {
  code: ExpiredPromoCode;
  /** Nomzod yozgan shakl kodning O'ZIMI yoki unga o'xshashmi. */
  exact: boolean;
}

/**
 * Nomzod yozgan kod muddati tugaganlar orasidamikin.
 *
 * Topilmasa `null` — ariza odatdagidek davom etadi. Reyestrda
 * bo'lmagan kod TO'SILMAYDI: har kodni oldindan ro'yxatga olish
 * shart emas va noma'lum kod uchun arizani rad etish nomzodni
 * yo'qotardi.
 */
export function findExpiredPromo(
  input: string | null | undefined,
  expired: readonly ExpiredPromoCode[],
): ExpiredPromoMatch | null {
  const folded = foldPromoCode(input);
  if (folded === "") return null;

  // Avval AYNAN mosini qidiramiz: xabar aniqroq bo'ladi.
  const exact = expired.find((candidate) => foldPromoCode(candidate.code) === folded);
  if (exact) return { code: exact, exact: true };

  const similar = expired.find((candidate) => looksLikeSameCode(candidate.code, folded));
  return similar ? { code: similar, exact: false } : null;
}
