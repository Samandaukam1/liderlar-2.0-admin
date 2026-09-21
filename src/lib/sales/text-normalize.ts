/**
 * O'zbek matnini moslashtirish uchun normallashtirish.
 *
 * NEGA ALOHIDA MODUL: o'zbek yozuvida "o'" va "g'" harflari amalda YETTI
 * xil belgi bilan yoziladi — ASCII apostrof ('), o'ng va chap tirnoq
 * ('' — U+2018/U+2019), modifikator harflar (ʻ ʼ — U+02BB/U+02BC),
 * gravis (`) va akut (´). Telegram klaviaturasi, iPhone avtomatik
 * tuzatishi va veb forma uchtasini uch xil beradi.
 *
 * Bu bitta joyda hal qilinmasa, "to‘lovni amalga oshiring" iborasini
 * qidiruvchi qoida "to'lovni amalga oshiring" ni ko'rmay o'tib ketadi va
 * butun sotuv statistikasi jimgina noto'g'ri bo'ladi. Aynan shu xato
 * testda tutildi.
 */

const APOSTROPHES = /[‘’ʻʼ`´′]/g;

/** Barcha apostrof variantini ASCII ' ga keltiradi. */
export function normalizeApostrophes(text: string): string {
  return text.replace(APOSTROPHES, "'");
}

/**
 * KIRILLDAN LOTINGA — FAQAT MOSLASHTIRISH UCHUN.
 *
 * Mijozlarning bir qismi kirillda yozadi: "хоп", "рахмат",
 * "танишиб чикдим", "Юбордим". Lotin ro'yxatlari bilan
 * taqqoslaganda bular HECH QACHON topilmasdi va har biri
 * "javobsiz savol" bo'lib yozilib ketardi.
 *
 * XOM MATN O'ZGARMAYDI. Bu almashtirish faqat xotirada,
 * niyat aniqlash bosqichida bajariladi — ism va identifikator
 * bazada asl holida qoladi (17-band).
 */
const CYRILLIC_MAP: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts",
  ч: "ch", ш: "sh", щ: "sh", ъ: "'", ы: "i", ь: "", э: "e", ю: "yu",
  я: "ya",
  // O'zbek kirillining o'ziga xos harflari.
  ў: "o'", қ: "q", ғ: "g'", ҳ: "h",
};

/** Kirill harflarni lotinga o'giradi. Lotin matn o'zgarmaydi. */
export function transliterateCyrillic(text: string): string {
  let out = "";
  for (const char of text) {
    const lower = char.toLowerCase();
    const mapped = CYRILLIC_MAP[lower];
    out += mapped === undefined ? char : mapped;
  }
  return out;
}

/** Moslashtirish uchun tayyor shakl: kichik harf + yagona apostrof. */
export function normalizeForMatch(text: string): string {
  return normalizeApostrophes(text).toLowerCase();
}

/**
 * IBORA HAM MATN BILAN BIR XIL YO'LDAN O'TADI.
 *
 * Qidiriladigan ibora kirillda yozilgan bo'lsa ("жалоба",
 * "оператор"), normallashtirilgan matn esa lotinga o'girilgan
 * bo'lsa — ular HECH QACHON uchrashmasdi va qoida jimgina
 * ishlamay qolardi. Ikki tomon bitta funksiyadan o'tishi shart.
 */
export function normalizePhrase(phrase: string): string {
  return transliterateCyrillic(normalizeForMatch(phrase));
}

/**
 * Yozishmadagi imlo va yozuv variantlari.
 *
 * FAQAT NIYAT ANIQLASH UCHUN. Xom xabar bazada o'zgarmasdan qoladi —
 * bu yerdagi almashtirish tasnif bosqichida, xotirada bajariladi.
 *
 * "хуш" alohida holat: u BILIM EMAS, yozishmadagi xato. Ma'nosi "xo'p".
 * Uni bilim bazasiga xizmat fakti sifatida kiritish model "хуш degan
 * xizmat bor" deb o'ylashiga olib kelardi, shuning uchun u shu yerda,
 * variant sifatida hal qilinadi.
 */
export const SALES_WORD_VARIANTS: Readonly<Record<string, string>> = {
  // tasdiq
  "хуш": "xo'p",
  "хўп": "xo'p",
  "хоп": "xo'p",
  "xop": "xo'p",
  "xup": "xo'p",
  "xa": "ha",
  "ха": "ha",
  "хa": "ha",
  "да": "ha",
  "ok": "ok",
  "ок": "ok",
  "okey": "ok",
  "хорошо": "ok",
  // inkor
  "юк": "yo'q",
  "йўқ": "yo'q",
  "йук": "yo'q",
  "yoq": "yo'q",
  "yuq": "yo'q",
  "нет": "yo'q",
};

/**
 * Niyat aniqlash uchun tayyor matn: apostrof + kichik harf + variantlar.
 * So'z bo'yicha almashtiriladi, shuning uchun "ha shunaqa" ham,
 * "юк" ham to'g'ri tushuniladi.
 */
export function normalizeForIntent(text: string): string {
  const withVariants = normalizeForMatch(text)
    .split(/(\s+)/)
    .map((chunk) => {
      if (/^\s+$/.test(chunk)) return chunk;
      const bare = chunk.replace(/[^\p{L}\p{N}']/gu, "");
      const replacement = SALES_WORD_VARIANTS[bare];
      return replacement ? chunk.replace(bare, replacement) : chunk;
    })
    .join("");

  /*
   * TRANSLITERATSIYA ENG OXIRIDA.
   *
   * `SALES_WORD_VARIANTS` kalitlarining bir qismi kirillda
   * ("хуш", "юк", "да"). Agar transliteratsiya oldin
   * bajarilsa, bu kalitlar hech qachon topilmasdi va
   * variantlar jadvali butunlay ishlamay qolardi.
   */
  return transliterateCyrillic(withVariants);
}
