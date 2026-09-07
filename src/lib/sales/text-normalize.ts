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
