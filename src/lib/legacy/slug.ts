/**
 * Liderlar 1.0 (Tilda) URL shakli — sof modul.
 *
 * QAYERDAN MA'LUM. CSV'da "Alias" ustuni 1991 qatordan faqat BITTASIDA
 * to'ldirilgan, ya'ni eski slug fayldan to'g'ridan-to'g'ri o'qib bo'lmaydi.
 * Lekin ikkita maqola matnining ICHIDA haqiqiy 1.0 havolalari qolgan
 * (bir odamning ikki nusxasi bir-biriga havola qilgan):
 *
 *   https://liderlar.uz/nomzodlar/9bidsfxtk1-asomiddinov-behruzbek-nuriddin-ogli
 *   https://liderlar.uz/nomzodlar/eux0ts6bh1-asomiddinov-behruzbek-nuriddin-ogli
 *
 * Ikkalasi ham "<Post ID>-<sarlavha-slug>" ko'rinishida, va quyidagi qoida
 * ikkalasini ham AYNAN qayta hosil qiladi (tests/legacy-slug.test.ts shuni
 * tekshiradi). Ya'ni bu taxmin emas — ma'lumotning o'zidan olingan qoida.
 */

/** Eski saytdagi ro'yxat sahifasi. 2.0 dagi /liderlar bilan almashtirilmaydi. */
export const LEGACY_PATH_PREFIX = "/nomzodlar";

/**
 * O'zbekcha matnda uchraydigan apostrof shakllari.
 *
 * "O‘G‘LI" → "ogli": Tilda ularni defisga aylantirmay, butunlay TASHLAB
 * yuborgan — yuqoridagi ikki havola shuni ko'rsatadi. Shuning uchun bular
 * ajratuvchi emas, olib tashlanadigan belgilar ro'yxatida.
 */
const APOSTROPHES = "'‘’ʻʼʾʿ`´′";

/** Sarlavhalarda uchragan lotin bo'lmagan yagona harflar uchun. */
const TRANSLITERATION: Record<string, string> = {
  "А": "a", // Cyrillic А — bitta sarlavhada lotin A o'rniga yozilgan
  "а": "a",
};

/**
 * Sarlavhadan URL bo'lagini yasaydi (Post ID prefiksisiz).
 * Bo'sh sarlavha bo'sh satr qaytaradi — chaqiruvchi buni hal qiladi.
 */
export function slugifyLegacyTitle(title: string): string {
  let value = (title ?? "").trim().toLowerCase();
  value = [...value].map((ch) => TRANSLITERATION[ch] ?? ch).join("");
  value = [...value].filter((ch) => !APOSTROPHES.includes(ch)).join("");
  // NFD + kombinatsiyalanuvchi belgilarni tashlash: "shohróz" → "shohroz".
  value = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return value.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * To'liq legacy slug.
 *
 * Alias berilgan bo'lsa u yutadi — Tilda'da qo'lda qo'yilgan alias URL'ni
 * butunlay almashtiradi. Aks holda "<postId>-<sarlavha>". Post ID prefiksi
 * har doim bor, shuning uchun natija 1991/1991 unikal.
 */
export function buildLegacySlug(
  postId: string,
  title: string,
  alias?: string | null,
): string {
  const explicit = (alias ?? "").trim();
  if (explicit) return explicit;

  const id = (postId ?? "").trim();
  const tail = slugifyLegacyTitle(title);
  if (!id) return tail;
  return tail ? `${id}-${tail}` : id;
}

/** To'liq eski yo'l: /nomzodlar/<slug>. */
export function buildLegacyPath(slug: string): string {
  return `${LEGACY_PATH_PREFIX}/${slug}`;
}

/**
 * URL bo'lagidan Tilda Post ID prefiksini ajratadi.
 *
 * Bu route uchun ZAXIRA yo'li. Slug'ning DUMI Tilda transliteratsiyasiga
 * bog'liq va biz uni faqat ikki namunadan bilamiz; PREFIKS esa aniq — u
 * manbadagi Post ID ning o'zi. Shuning uchun dumida farq bo'lsa ham eski
 * havola ishlaydi.
 *
 * Tilda Post ID — 10 ta harf/raqam. Bo'lakda undan keyin defis kelishi shart,
 * aks holda oddiy alias ("xasanov-sanjar") xato ravishda ID deb o'qilardi.
 */
export function extractLegacyPostId(slug: string): string | null {
  const match = /^([a-z0-9]{10})-/.exec((slug ?? "").trim().toLowerCase());
  return match ? match[1] : null;
}
