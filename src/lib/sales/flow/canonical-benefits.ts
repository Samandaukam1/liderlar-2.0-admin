/**
 * KANONIK FOYDALAR MATNI (12-band).
 *
 * BU MATN AYNAN SHU HOLIDA YUBORILADI. Model uni qayta yozmaydi,
 * qisqartirmaydi va o'zidan qo'shmaydi: bu tijoriy taklifning rasmiy
 * matni, unda havola, oferta va ijtimoiy tarmoq manzillari bor.
 * Modelga qayta yozdirish har safar boshqacha va'da berish demakdir.
 *
 * BIR MARTA YUBORILADI. Mijoz "yana foydasini ayt" desa, butun matn
 * QAYTA KELMAYDI — o'rniga aniq savoliga qisqa javob beriladi.
 * O'n sakkiz bandli matnni ikkinchi marta o'qish hech kim qilmaydigan
 * ish, va uni yuborish mijozni tinglamaganingizni ko'rsatadi.
 */

export const CANONICAL_BENEFITS_TEMPLATE_KEY = "canonical_benefits";

export const CANONICAL_BENEFITS_TEXT = `Ushbu xabarda sizga qo‘shimcha ma’lumotlarni taqdim etmoqdamiz.
Ensiklopediyaga istalgan sohada faoliyat yuritayotgan, o‘z ustida ishlayotgan yoshlar qabul qilinadi.
Bu loyiha yoshlarning yutuqlarini hujjatlashtirish, ularni ommaga tanitish va boshqalarga ilhom manbai bo‘lish maqsadida yaratilgan.

✅ Qidiruv tizimlarida ko‘rinish:
Siz haqingizdagi maqola Google, Yandex, Bing kabi qidiruv tizimlarida chiqadi. Bu sizni istagan odam — hamkor, ish beruvchi yoki jurnalist — osongina topishi mumkinligini anglatadi.

✅ Sun’iy intellekt platformalarida tanilish:
ChatGPT, Copilot, Gemini kabi sun’iy intellekt tizimlari endilikda siz haqingizda aniq manbalarga tayangan holda ma’lumot bera oladi. Bu sizning onlayn obro‘yingizni mustahkamlovchi kuchli vosita.

✅ Kelajakdagi Wikipedia sahifangiz uchun asos:
Bugun e’lon qilinadigan maqola — ertaga siz haqingizda yoziladigan Wikipedia sahifasi uchun tayyor ishonchli manba bo‘lishi mumkin.

✅ AdabiyotX platformasidagi eksklyuziv imkoniyatlar:
AdabiyotX platformasi orqali birinchi kitobingiz, maqolangiz yoki boshqa mualliflik materiallaringizni mutlaqo bepul nashr etishingiz mumkin. Asaringiz platformada kitobxonlarga taqdim etiladi va har bir sotuvdan mualliflik daromadi olish imkoniyatiga ega bo‘lasiz.

✅ Ijtimoiy tarmoqlarda tasdiq belgisi olish imkoniyati:
Instagram, Facebook, TikTok, YouTube kabi platformalarda ko‘k nishon olish uchun siz haqingizda onlayn nashrlar zarur. Ushbu maqola bu yo‘lda ishonchli hujjat bo‘lib xizmat qiladi.

✅ Rezumega qo‘shiladigan rasmiy havola:
Ish qidirishda, grantga hujjat topshirishda yoki xalqaro loyihalarda qatnashishda ushbu maqola — sizning shaxsiy brendingizni isbotlovchi kuchli hujjat bo‘ladi.

✅ Xorijiy universitetlar va dasturlar va stipendiyalar uchun tavsiyanoma:
Xorijiy universitetlar, grant dasturlari, almashinuv loyihalari va xalqaro tanlovlar, stipendiyalar uchun tashkilot yoki rahbar nomidan universal yoki maxsus tavsiyanoma (Recommendation Letter) tayyorlash xizmatidan foydalanishingiz mumkin. Har bir tavsiyanoma sizning yutuqlaringiz, faoliyatingiz va maqsadlaringiz asosida professional tarzda tayyorlanadi.

✅ Lider yoshlar online jurnalida yoritilish
Biografik maqolasi bor yoshlar Lider yoshlar online jurnalida muntazam yoritiladi. Ularning hayotida yuz bergan muhim voqea, ularning loyihalari va tashabbuslari keng targ‘ib qilinadi.

✅ Ommaviy axborot vositalari e’tiboriga tushasiz:
Jurnalistlar, blogerlar, televideniye va radio uchun maqolaviy manba sifatida sizga murojaatlar ko‘payadi.

✅ Liderlar iqtibosida faollik
Har qanday jamiyat uchun kerakli va mazmunli g‘oyangizni Liderlardan iqtiboslar ruknida e’lon qilishingiz mumkin bo‘ladi.

✅ Shaxsiy brendingiz uchun poydevor:
Har qanday lider, ekspert yoki jamoat faoli uchun shaxsiy brend muhim. Bu maqola — o‘zingizga bo‘lgan ishonchni va boshqalarning sizga nisbatan ishonchini mustahkamlaydi.

✅ Project Found dasturi imkoniyatlari:
Project Found dasturi orqali startap, loyiha yoki tashabbusingiz uchun mutlaqo bepul zamonaviy va professional veb-saytga ega bo‘lish imkoniyatini qo‘lga kiriting.

✅ Kelajak loyihalarda e’tibor markazida bo‘lish:
Tanlovlar, forumlar, konferensiyalar yoki grant dasturlarida qatnashishda siz haqingizdagi onlayn maqola sizni ajratib ko‘rsatadi.

✅ Ensiklopediyaga kirganlik haqida sertifikat
Tanlovlar, forumlar, konferensiyalar yoki grant dasturlarida qatnashishda yoki talaba bo‘lsangiz, ijtimoiy faollikni tasdiqlovchi materiallar qatorida yutuqlar jildiga qo‘shishingiz mumkin bo‘lgan sertifikatga ega bo‘lasiz.

Ensiklopediyamizning ommaviy ofertasi bilan quyidagi link orqali batafsil tanishishingiz mumkin!
https://liderlar.uz/ommaviy_ofertasi

Liderlar.uz | Instagram | @uzlye_rasmiy`;

/**
 * Umumiy "menga nima beradi?" savollari.
 *
 * ATAYLAB UMUMIY: bular butun taklif haqidagi savollar. Aniq savol
 * ("sertifikat bormi?") bu ro'yxatga KIRMAYDI — unga qisqa javob
 * kerak, o'n sakkiz bandli matn emas (8-band).
 */
const BENEFITS_QUESTION_PHRASES: readonly string[] = [
  "menga nima beradi",
  "nima foydasi",
  "foydasi nima",
  "qanday foyda",
  "nima olaman",
  "nima beradi",
  "plus tomoni",
  "plyus tomoni",
  "afzalligi nima",
  "afzalliklari",
  "imkoniyatlari qanday",
  "imkoniyatlari nima",
  "nega kirishim kerak",
  "nimaga kirishim kerak",
  "batafsil ma'lumot",
  "to'liq ma'lumot",
  "nima uchun kerak",
];

import { normalizeForIntent } from "../text-normalize.ts";

function contains(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "u").test(haystack);
}

/** Mijoz umumiy "nima beradi?" savolini berdimi. */
export function isGeneralBenefitsQuestion(text: string | null | undefined): boolean {
  const normalized = normalizeForIntent(text ?? "").trim();
  if (normalized === "") return false;
  return BENEFITS_QUESTION_PHRASES.some((phrase) => contains(normalized, phrase));
}

/**
 * Kanonik matn shu chatda allaqachon yuborilganmi.
 *
 * Solishtirish TEMPLATE KALITI bo'yicha, matn bo'yicha emas: matn
 * uzun va uni har safar solishtirish qimmat, kalit esa jurnalda
 * allaqachon yozilgan.
 */
export function benefitsAlreadySent(sentTemplateKeys: readonly string[]): boolean {
  return sentTemplateKeys.includes(CANONICAL_BENEFITS_TEMPLATE_KEY);
}
