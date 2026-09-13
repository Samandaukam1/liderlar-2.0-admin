/**
 * E'TIROZ DVIGATELI (9-band).
 *
 * NEGA KERAK: "qimmat ekan" savol emas, e'tiroz. Ilgari u `other`
 * bo'lib tushardi va ssenariyda javobi yo'qligi uchun bilim bazasiga
 * borardi — u yerda esa "qimmat" degan savol yo'q. Natijada mijoz
 * e'tiroz bildirganda AI umuman javob bermasdi. Sotuv suhbatida eng
 * yomon javob — jim qolish.
 *
 * BITTA XABARDA BIR NECHTA E'TIROZ bo'lishi mumkin: "qimmat ekan,
 * ishonchlimi o'zi?" — PRICE + TRUST. Shuning uchun natija ro'yxat.
 *
 * SOF MODUL — hech qanday I/O yo'q.
 */

import { normalizeForIntent } from "../text-normalize.ts";

export const OBJECTION_KINDS = [
  "PRICE",
  "TRUST",
  "NEED_TO_THINK",
  "ASK_PARENTS",
  "ASK_FAMILY",
  "NO_MONEY_NOW",
  "PAY_LATER",
  "NOT_INTERESTED",
  "WHAT_IS_THE_BENEFIT",
  "IS_IT_OFFICIAL",
  "IS_IT_REAL",
  "HOW_FOUND_ME",
  "PRIVACY",
  "ARTICLE_QUALITY",
  "PHOTO_REQUIREMENT",
  "PAYMENT_SAFETY",
  "TIME",
  "CERTIFICATE",
  "GOOGLE_INDEXING",
  "WIKIPEDIA",
  "SOCIAL_VERIFICATION",
  /*
   * 2-FAZA QO'SHIMCHASI (17-band).
   *
   * Auditda ko'rilgan, lekin toifasi bo'lmagan e'tirozlar. Ular
   * ilgari `OTHER` ga tushardi yoki umuman yo'qolardi — ya'ni
   * eng ko'p uchraydigan sotuvdan keyingi muammolar (rasm
   * o'xshamasligi, internet, anketa nosozligi) statistikada
   * KO'RINMASDI va ularga strategiya yozib bo'lmasdi.
   */
  "THOUGHT_FREE",
  "WHY_PAY",
  "INSTALLMENT",
  "NOT_ENOUGH_ACHIEVEMENTS",
  "PHOTO_PROBLEM",
  "PHOTO_PRIVACY",
  "PHOTO_LOOKS_DIFFERENT",
  "TECHNICAL_PROBLEM",
  "INTERNET_PROBLEM",
  "NO_TIME",
  "ARTICLE_QUESTION",
  "GRANT_VALUE",
  "SCAM_CONCERN",
  "LICENSE",
  "STOP",
  "OTHER",
] as const;

export type ObjectionKind = (typeof OBJECTION_KINDS)[number];

export const OBJECTION_LABELS: Record<ObjectionKind, string> = {
  PRICE: "Narx qimmat",
  TRUST: "Ishonch yo‘q",
  NEED_TO_THINK: "O‘ylab ko‘rishi kerak",
  ASK_PARENTS: "Ota-onasidan so‘rashi kerak",
  ASK_FAMILY: "Oilasi bilan maslahatlashadi",
  NO_MONEY_NOW: "Hozir puli yo‘q",
  PAY_LATER: "Keyinroq to‘layman",
  NOT_INTERESTED: "Qiziqmayapti",
  WHAT_IS_THE_BENEFIT: "Foydasi nima",
  IS_IT_OFFICIAL: "Rasmiymi",
  IS_IT_REAL: "Haqiqiymi",
  HOW_FOUND_ME: "Meni qayerdan topdingiz",
  PRIVACY: "Shaxsiy ma’lumot xavfsizligi",
  ARTICLE_QUALITY: "Maqola sifati",
  PHOTO_REQUIREMENT: "Rasm talabi",
  PAYMENT_SAFETY: "To‘lov xavfsizligi",
  TIME: "Vaqt / muddat",
  CERTIFICATE: "Sertifikat",
  GOOGLE_INDEXING: "Google’da chiqishi",
  WIKIPEDIA: "Wikipedia",
  SOCIAL_VERIFICATION: "Ko‘k belgi / tasdiq",
  THOUGHT_FREE: "Bepul deb o‘ylagan",
  WHY_PAY: "Nega pul to‘lashim kerak",
  INSTALLMENT: "Bo‘lib to‘lash so‘rayapti",
  NOT_ENOUGH_ACHIEVEMENTS: "Yutug‘im yetarli emas",
  PHOTO_PROBLEM: "Rasm bilan muammo",
  PHOTO_PRIVACY: "Rasm maxfiyligi",
  PHOTO_LOOKS_DIFFERENT: "Rasm o‘xshamadi",
  TECHNICAL_PROBLEM: "Texnik nosozlik",
  INTERNET_PROBLEM: "Internet muammosi",
  NO_TIME: "Vaqtim yo‘q",
  ARTICLE_QUESTION: "Maqola bo‘yicha savol",
  GRANT_VALUE: "Grant/stipendiyaga foydasi",
  SCAM_CONCERN: "Firibgarlikdan xavotir",
  LICENSE: "Litsenziya so‘rayapti",
  STOP: "Yozmang",
  OTHER: "Boshqa e’tiroz",
};

interface ObjectionRule {
  kind: ObjectionKind;
  phrases: readonly string[];
}

/**
 * QOIDALAR TARTIBI MUHIM EMAS — hammasi ko'rib chiqiladi va topilgan
 * har biri qaytariladi. Bu niyat tasnifidan farqli: u yerda bitta
 * javob kerak, bu yerda esa mijoz aytgan HAMMA e'tiroz kerak.
 *
 * Iboralar `normalizeForIntent` dan o'tgan matnga solishtiriladi,
 * ya'ni apostrof variantlari va kirill shakllar allaqachon
 * bir xillashtirilgan.
 */
const RULES: readonly ObjectionRule[] = [
  {
    kind: "PRICE",
    phrases: [
      "qimmat", "qimat", "narxi baland", "juda ko'p pul", "arzonroq",
      "chegirma", "skidka", "дорого", "qimmatroq", "pulga qimmat",
    ],
  },
  {
    kind: "NO_MONEY_NOW",
    phrases: [
      "pulim yo'q", "pul yo'q", "hozir pulim", "mablag'im yo'q",
      "imkoniyatim yo'q", "puli yo'q", "hozircha pulim",
    ],
  },
  {
    kind: "PAY_LATER",
    phrases: [
      "keyin to'layman", "keyinroq to'layman", "oyoxirida", "oy oxirida",
      "maoshdan keyin", "stipendiya", "bo'lib to'lash", "bolib tolash",
      "keyin tolayman",
    ],
  },
  {
    kind: "TRUST",
    phrases: [
      "ishonchlimi", "ishonsam bo'ladimi", "aldamaysizmi", "aldov",
      "firibgar", "scam", "обман", "ishonmayman", "ishonch yo'q",
    ],
  },
  {
    kind: "IS_IT_OFFICIAL",
    phrases: ["rasmiymi", "rasmiy", "davlat", "litsenziya", "guvohnoma bormi"],
  },
  {
    kind: "IS_IT_REAL",
    phrases: ["haqiqiymi", "rostmi", "chinmi", "haqiqatdan", "rost gapmi"],
  },
  {
    kind: "NEED_TO_THINK",
    phrases: ["o'ylab ko'raman", "oylab koraman", "o'ylashim kerak", "bir o'ylay"],
  },
  {
    kind: "ASK_PARENTS",
    phrases: [
      "ota onam", "otamdan", "onamdan", "ota-onam", "dadamdan", "oyimdan",
      "ota onamdan so'rayman", "родител",
    ],
  },
  {
    kind: "ASK_FAMILY",
    phrases: ["oilam bilan", "turmush o'rtog'im", "akam bilan", "opam bilan", "maslahatlashaman"],
  },
  {
    kind: "NOT_INTERESTED",
    phrases: ["qiziqmayman", "kerak emas", "kerakmas", "xohlamayman", "istamayman", "не интересно"],
  },
  {
    kind: "WHAT_IS_THE_BENEFIT",
    phrases: ["foydasi nima", "nima foyda", "nima beradi", "menga nima", "foydasi bormi"],
  },
  {
    kind: "HOW_FOUND_ME",
    phrases: ["qayerdan topdingiz", "qayerdan bildingiz", "raqamimni qayerdan", "kim aytdi"],
  },
  {
    kind: "PRIVACY",
    phrases: [
      "ma'lumotlarim", "shaxsiy ma'lumot", "maxfiy", "kimga beriladi",
      "boshqalarga", "tarqalib ketmaydimi",
    ],
  },
  {
    kind: "ARTICLE_QUALITY",
    phrases: ["kim yozadi", "qanday yoziladi", "maqola qanaqa", "sifatli", "ko'rib chiqamanmi"],
  },
  {
    kind: "PHOTO_REQUIREMENT",
    phrases: ["rasm kerakmi", "surat", "foto", "rasmim yo'q", "qanaqa rasm"],
  },
  {
    kind: "PAYMENT_SAFETY",
    phrases: ["karta xavfsiz", "pulim yo'qolmaydi", "to'lov xavfsiz", "qaytarib berasizmi", "kafolat"],
  },
  {
    kind: "TIME",
    phrases: ["qancha vaqt", "qachon tayyor", "necha kun", "uzoq", "tez bo'ladimi", "qachon chiqadi"],
  },
  {
    kind: "CERTIFICATE",
    phrases: ["sertifikat", "guvohnoma", "diplom", "сертификат"],
  },
  {
    kind: "GOOGLE_INDEXING",
    phrases: ["google", "gugl", "qidiruvda", "internetda chiqadimi", "izlasam chiqadimi"],
  },
  {
    kind: "WIKIPEDIA",
    phrases: ["wikipedia", "vikipediya", "википедия", "vikipedia"],
  },
  {
    kind: "SOCIAL_VERIFICATION",
    phrases: ["ko'k belgi", "kok belgi", "galochka", "tasdiqlangan akkaunt", "verified", "sinigi"],
  },

  /* ---------------- 2-faza: auditda ko'rilgan e'tirozlar ---------------- */
  {
    kind: "THOUGHT_FREE",
    phrases: ["bepul deb o'ylagandim", "tekin deb", "bepul emasmi", "tekin emasmi", "pullikmi"],
  },
  {
    kind: "WHY_PAY",
    phrases: [
      "nega pul", "nimaga pul", "nega pullik", "pul qayerga ketadi",
      "sizlarga nima foyda", "nima uchun to'layman",
    ],
  },
  {
    kind: "INSTALLMENT",
    phrases: ["bo'lib to'lasa", "bolib tolasa", "qismlarga", "rassrochka", "bo'lib to'lash mumkinmi"],
  },
  {
    kind: "NOT_ENOUGH_ACHIEVEMENTS",
    phrases: [
      "yutuqlarim yo'q", "yutugim yoq", "unchalik ko'p yutuq", "hali endi talaba",
      "men to'g'ri kelamanmi", "mos kelamanmi",
    ],
  },
  {
    kind: "PHOTO_PROBLEM",
    phrases: [
      "rasm yuklanmayapti", "rasmni tahrirlay olmayapman", "gemini qilib bermayapti",
      "rasm ketmayapti", "surat yuklanmadi",
    ],
  },
  {
    kind: "PHOTO_PRIVACY",
    phrases: ["rasmimni yuboraolmayman", "rasmimni yubora olmayman", "hammaga ham rasmimni", "rasmim tarqal"],
  },
  {
    kind: "PHOTO_LOOKS_DIFFERENT",
    phrases: [
      "rasmim o'xshamabdi", "o'xshamadi", "oxshamabdi", "yuzimni o'zgartir",
      "o'zgartirib yuboribdi", "bu men emas", "juda uzgartrb",
    ],
  },
  {
    kind: "TECHNICAL_PROBLEM",
    phrases: [
      "ishlamayapti", "ochilmayapti", "saqlanmayapti", "xatolik chiqdi",
      "qabul qilmadi", "link eskirgan", "havola ishlamayapti",
    ],
  },
  {
    kind: "INTERNET_PROBLEM",
    phrases: ["internet yaxshi ishlamayapti", "internetim", "aloqa yo'q", "trafik yo'q"],
  },
  {
    kind: "NO_TIME",
    phrases: ["vaqtim yo'q", "bandman", "ishdan chiqib", "uyga borvolay", "keyinroq yozaman"],
  },
  {
    kind: "ARTICLE_QUESTION",
    phrases: ["maqola yozolmayman", "maqolani kim yozadi", "maqola yozasizlarmi", "men maqola beraman"],
  },
  {
    kind: "GRANT_VALUE",
    phrases: ["grant", "kontraktdan", "stipendiyaga", "ijtimoiy faollik", "ball beriladi"],
  },
  {
    kind: "SCAM_CONCERN",
    phrases: ["firibgarlik", "aldab", "pulni olib qochib", "pulimni yeb", "obman"],
  },
  {
    kind: "LICENSE",
    phrases: ["litsenziya berilganmi", "litsenziyangiz", "ruxsatnoma", "guvohnomangiz bormi"],
  },
  {
    kind: "STOP",
    phrases: ["boshqa yozmang", "yozmang", "bezovta qilmang", "obuna bekor", "unsubscribe", "otpishis"],
  },
];

export interface DetectedObjection {
  kind: ObjectionKind;
  /** Qaysi ibora ishladi — diagnostikada ko'rsatiladi. */
  matched: string;
}

/** So'z chegarasi bilan: "haq" ichidagi "ha" e'tiroz emas. */
function contains(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "u").test(haystack);
}

/**
 * Xabardagi HAMMA e'tirozni topadi.
 *
 * Topilmasa BO'SH ro'yxat qaytadi — "OTHER" avtomatik qo'yilmaydi.
 * "Nomaʼlum eʼtiroz" deb belgilash chaqiruvchini javob yozishga
 * majburlardi, holbuki mijoz umuman eʼtiroz bildirmagan bo'lishi
 * mumkin.
 */
export function detectObjections(text: string | null | undefined): DetectedObjection[] {
  const normalized = normalizeForIntent(text ?? "").trim();
  if (normalized === "") return [];

  const found: DetectedObjection[] = [];
  for (const rule of RULES) {
    for (const phrase of rule.phrases) {
      if (contains(normalized, phrase)) {
        found.push({ kind: rule.kind, matched: phrase });
        break;
      }
    }
  }
  return found;
}

/**
 * Suhbatdagi e'tirozlar ro'yxatini yangilaydi.
 *
 * Eskisi SAQLANADI: mijoz narx haqida bir marta aytgan bo'lsa, keyin
 * boshqa mavzuga o'tsa ham o'sha e'tiroz suhbatning haqiqati bo'lib
 * qoladi va yakuniy javobda hisobga olinishi kerak.
 */
export function mergeObjections(
  existing: readonly string[],
  detected: readonly DetectedObjection[],
): ObjectionKind[] {
  const set = new Set<ObjectionKind>();
  for (const value of existing) {
    if ((OBJECTION_KINDS as readonly string[]).includes(value)) set.add(value as ObjectionKind);
  }
  for (const item of detected) set.add(item.kind);
  return [...set];
}

/**
 * Eng muhim e'tiroz — javob shunga qaratiladi.
 *
 * TARTIB QOIDASI: mijozning ALOQANI TO'XTATISH talabi eng yuqorida,
 * undan keyin ishonch va maxfiylik, keyin pul. Sabab oddiy: "boshqa
 * yozmang" degan odamga narx tushuntirish eng qo'pol xato bo'lardi.
 */
const PRIORITY: readonly ObjectionKind[] = [
  "STOP",
  "NOT_INTERESTED",
  "SCAM_CONCERN",
  "TRUST",
  "IS_IT_REAL",
  "PRIVACY",
  "PAYMENT_SAFETY",
  "PRICE",
  "NO_MONEY_NOW",
  "IS_IT_OFFICIAL",
  "WHAT_IS_THE_BENEFIT",
  "ASK_PARENTS",
  "ASK_FAMILY",
  "NEED_TO_THINK",
  "PAY_LATER",
  "ARTICLE_QUALITY",
  "GOOGLE_INDEXING",
  "WIKIPEDIA",
  "SOCIAL_VERIFICATION",
  "CERTIFICATE",
  "TIME",
  "PHOTO_LOOKS_DIFFERENT",
  "PHOTO_PRIVACY",
  "PHOTO_PROBLEM",
  "PHOTO_REQUIREMENT",
  "TECHNICAL_PROBLEM",
  "INTERNET_PROBLEM",
  "LICENSE",
  "THOUGHT_FREE",
  "WHY_PAY",
  "INSTALLMENT",
  "NOT_ENOUGH_ACHIEVEMENTS",
  "GRANT_VALUE",
  "ARTICLE_QUESTION",
  "NO_TIME",
  "HOW_FOUND_ME",
  "OTHER",
];

export function primaryObjection(kinds: readonly string[]): ObjectionKind | null {
  for (const candidate of PRIORITY) {
    if (kinds.includes(candidate)) return candidate;
  }
  return null;
}
