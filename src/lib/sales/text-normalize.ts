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

/** Moslashtirish uchun tayyor shakl: kichik harf + yagona apostrof. */
export function normalizeForMatch(text: string): string {
  return normalizeApostrophes(text).toLowerCase();
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
  return normalizeForMatch(text)
    .split(/(\s+)/)
    .map((chunk) => {
      if (/^\s+$/.test(chunk)) return chunk;
      const bare = chunk.replace(/[^\p{L}\p{N}']/gu, "");
      const replacement = SALES_WORD_VARIANTS[bare];
      return replacement ? chunk.replace(bare, replacement) : chunk;
    })
    .join("");
}
