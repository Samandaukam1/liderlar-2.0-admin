/**
 * E'TIROZLARNI QAZISH VA STRATEGIYA — SOF MODUL.
 *
 * IKKI NARSA ATAYLAB AJRATILGAN (18-band):
 *
 *   STRATEGIYA — "qanday javob berish": tan ol, tasdiqlangan
 *   xizmat doirasini tushuntir, bitta foydali qadam so'ra.
 *
 *   FAKT — "nima deyish": narx, muddat, shart. U FAQAT
 *   tasdiqlangan bilim va tijoriy sozlamadan keladi.
 *
 * Nega: e'tirozga tayyor "copy-paste" javob yozilsa, narx
 * o'zgarganda o'sha javob eskiradi va bot eski narxni aytadi.
 * Strategiya esa eskirmaydi — u faktga havola qiladi, faktni
 * o'zida saqlamaydi.
 */

import {
  OBJECTION_LABELS,
  type DetectedObjection,
  type ObjectionKind,
} from "../flow/objections.ts";

export interface ObjectionOccurrence {
  kinds: readonly ObjectionKind[];
  conversationId: string;
  messageId: string | null;
  /** REDAKSIYADAN O'TGAN matn. */
  redactedText: string;
  seenAt: string | null;
}

export interface ObjectionCluster {
  kind: ObjectionKind;
  label: string;
  messageCount: number;
  conversationCount: number;
  examples: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  strategy: readonly string[];
}

const MAX_EXAMPLES = 5;

/**
 * STRATEGIYA KUTUBXONASI.
 *
 * Har qadam — HARAKAT, matn emas. Modelga shu qadamlar beriladi
 * va u tasdiqlangan faktlar bilan javobni O'ZI yozadi.
 *
 * TAQIQLANGANLARI bu yerda umuman yo'q: soxta tanqislik, soxta
 * muddat, aybdorlik hissi, haqorat, o'ylab topilgan tavsiya,
 * uchinchi tomon natijasi kafolati (18-band).
 */
export const OBJECTION_STRATEGIES: Partial<Record<ObjectionKind, readonly string[]>> = {
  PRICE: [
    "E’tirozni tan ol — narx muhim savol ekanini inkor qilma.",
    "Tasdiqlangan xizmat doirasini ayt: nima kiradi, qancha muddatga.",
    "Mijozning O‘Z maqsadiga bog‘la (portfolio, hujjat, ko‘rinish).",
    "Bitta foydali keyingi qadam so‘ra.",
  ],
  NO_MONEY_NOW: [
    "Holatni tushunganingni bildir, bosim qilma.",
    "Mijozning o‘zi aytgan vaqtni so‘ra va eslab qol.",
    "Qayta yozish vaqtini mijoz belgilasin.",
  ],
  NEED_TO_THINK: [
    "O‘ylashga vaqt kerakligini tabiiy deb qabul qil.",
    "Qaysi savol ochiq qolganini SO‘RA — taxmin qilma.",
    "Faqat o‘sha savolga javob ber.",
  ],
  ASK_PARENTS: [
    "Qarorni oila bilan olishni hurmat bilan qabul qil.",
    "Ota-onaga ko‘rsatish uchun aniq, tasdiqlangan ma’lumot ber.",
    "Bosim yoki muddat qo‘yma.",
  ],
  ASK_FAMILY: [
    "Maslahatlashish talabini hurmat qil.",
    "Tasdiqlangan xizmat tavsifini yubor.",
    "Javobni kutishni ayt, takror yozma.",
  ],
  TRUST: [
    "Ishonchsizlik tabiiy ekanini tan ol.",
    "Tasdiqlangan tashkilot ma’lumotini ayt — faqat hujjatlangan qismini.",
    "AI yordamchi ekaningni ochiq ayt.",
    "Tekshirish mumkin bo‘lgan manba ko‘rsat.",
  ],
  SCAM_CONCERN: [
    "Xavotirni jiddiy qabul qil.",
    "Tasdiqlangan tashkilot va asoschi ma’lumotini ber.",
    "Hech qanday shaxsiy hujjat yoki karta ma’lumotini so‘rama.",
    "Mijoz istasa insonga ulash taklif qil.",
  ],
  IS_IT_OFFICIAL: [
    "Tashkilot haqida FAQAT tasdiqlangan ma’lumotni ayt.",
    "Davlat idorasi emasligini yashirma.",
  ],
  LICENSE: [
    "Qaysi hujjat borligini faqat tasdiqlangan bilimdan ayt.",
    "Bo‘lmasa — bilmasligingni ayt va insonga ulash taklif qil.",
  ],
  WHY_PAY: [
    "Savolning o‘rinli ekanini tan ol.",
    "Badal nimaga sarflanishini tasdiqlangan bilimdan ayt.",
    "Mijoz oladigan aniq natijani sana.",
  ],
  THOUGHT_FREE: [
    "Tushunmovchilik uchun ayblama.",
    "Xizmat pullik ekanini aniq, bir gapda ayt.",
    "Nima kirishini qisqa tushuntir.",
  ],
  INSTALLMENT: [
    "So‘rovni tan ol.",
    "Bo‘lib to‘lash shartini FAQAT tasdiqlangan tijoriy sozlamadan ayt.",
    "Sozlamada yo‘q bo‘lsa — aniqlashtirish kerakligini ayt, o‘ylab topma.",
  ],
  PAY_LATER: [
    "Vaqtni mijoz belgilashiga ruxsat ber.",
    "Kelishilgan vaqtni eslab qol va o‘shangacha yozma.",
  ],
  NOT_ENOUGH_ACHIEVEMENTS: [
    "Mijozning o‘zini kamsitma.",
    "Ishtirok mezonini tasdiqlangan bilimdan ayt.",
    "Mijoz haqida yutuq TO‘QIMA.",
  ],
  PHOTO_LOOKS_DIFFERENT: [
    "Noqulaylik uchun uzr so‘ra — bahslashma.",
    "Rasmga shaxsiy baho berma.",
    "Qayta ko‘rib chiqish uchun support vazifasi yarat.",
    "Nashrni shoshirma; mijoz so‘rasa to‘xtatib turishni qayd et.",
  ],
  PHOTO_PRIVACY: [
    "Rasm nimaga kerakligini ochiq tushuntir.",
    "Qayerda ishlatilishini tasdiqlangan siyosatdan ayt.",
    "Rad etish huquqi borligini ayt.",
  ],
  PHOTO_PROBLEM: [
    "Aniq nima ishlamayotganini so‘ra.",
    "Bitta bajariladigan qadam ber.",
    "Hal bo‘lmasa insonga ulash taklif qil.",
  ],
  TECHNICAL_PROBLEM: [
    "Muammoni takrorlatib ko‘rma — bir marta aniq so‘ra.",
    "Ma’lum yechim bo‘lsa bitta qadam ber.",
    "Aks holda texnik yordamga o‘tkaz.",
  ],
  INTERNET_PROBLEM: [
    "Holatni tushun, takror yozib bezovta qilma.",
    "Mijoz qulay bo‘lganda yozishini ayt.",
  ],
  NO_TIME: [
    "Qisqa yoz.",
    "Mijoz aytgan vaqtni eslab qol.",
  ],
  TIME: [
    "Muddatni FAQAT tasdiqlangan holat/navbatdan ayt.",
    "Aniq muddat bilmasang — bilmasligingni ayt, taxminiy sana berma.",
  ],
  CERTIFICATE: [
    "Sertifikat mavjudligini tasdiqlangan bilimdan ayt.",
    "Muddat so‘ralsa — real holatdan javob ber yoki insonga ulash.",
  ],
  GRANT_VALUE: [
    "Portfelga qo‘shish mumkinligini ayt.",
    "Grant/kontrakt natijasini KAFOLATLAMA — qaror boshqa tashkilotniki.",
  ],
  GOOGLE_INDEXING: [
    "Indekslash va kafolatni aralashtirma.",
    "Tasdiqlanmagan muddat va natija berma.",
  ],
  WIKIPEDIA: [
    "Wikipedia bilan bog‘liq tasdiqlanmagan da’vo qilma.",
    "Xizmat aslida nima ekanini ayt.",
  ],
  SOCIAL_VERIFICATION: [
    "Ko‘k belgi/verifikatsiya kafolatini berma.",
  ],
  WHAT_IS_THE_BENEFIT: [
    "Mijozning maqsadini SO‘RA.",
    "Faqat o‘sha maqsadga tegishli 2–3 foydani ayt.",
    "Uzun shablonni takror yuborma.",
  ],
  ARTICLE_QUESTION: [
    "Biografik anketa bilan mualliflik maqolasini ajrat.",
    "Kim nima yozishini aniq ayt.",
  ],
  PRIVACY: [
    "Qanday ma’lumot olinishini va nima uchun kerakligini ayt.",
    "Ortiqcha shaxsiy ma’lumot so‘rama.",
  ],
  NOT_INTERESTED: [
    "Qarorni qabul qil.",
    "Qayta ishontirishga URINMA.",
    "Xayrlash va aloqani yopish.",
  ],
  STOP: [
    "Darhol to‘xta.",
    "Opt-out qayd et, sabab so‘rama.",
    "Boshqa hech qanday taklif yozma.",
  ],
};

/** Toifa uchun strategiya; yo'q bo'lsa umumiy, xavfsiz qadamlar. */
export function strategyFor(kind: ObjectionKind): readonly string[] {
  return (
    OBJECTION_STRATEGIES[kind] ?? [
      "E’tirozni o‘z so‘zing bilan tan ol.",
      "Faqat tasdiqlangan ma’lumotga tayan.",
      "Bitta aniq keyingi qadam taklif qil.",
    ]
  );
}

/**
 * E'tirozlarni toifalar bo'yicha yig'adi.
 *
 * MULTI-LABEL: bitta xabar bir nechta toifaga qo'shiladi. Shuning
 * uchun toifalar yig'indisi xabarlar sonidan KO'P bo'lishi mumkin —
 * bu xato emas va adminda shunday izohlanadi.
 */
export function clusterObjections(
  occurrences: readonly ObjectionOccurrence[],
): ObjectionCluster[] {
  const groups = new Map<
    ObjectionKind,
    { cluster: ObjectionCluster; conversations: Set<string>; seen: Set<string> }
  >();

  for (const occurrence of occurrences) {
    for (const kind of occurrence.kinds) {
      let group = groups.get(kind);
      if (!group) {
        group = {
          cluster: {
            kind,
            label: OBJECTION_LABELS[kind],
            messageCount: 0,
            conversationCount: 0,
            examples: [],
            firstSeenAt: occurrence.seenAt,
            lastSeenAt: occurrence.seenAt,
            strategy: strategyFor(kind),
          },
          conversations: new Set(),
          seen: new Set(),
        };
        groups.set(kind, group);
      }

      group.cluster.messageCount += 1;
      group.conversations.add(occurrence.conversationId);

      const text = occurrence.redactedText.trim();
      if (text !== "" && !group.seen.has(text) && group.cluster.examples.length < MAX_EXAMPLES) {
        group.seen.add(text);
        group.cluster.examples.push(text);
      }

      if (occurrence.seenAt) {
        if (!group.cluster.firstSeenAt || occurrence.seenAt < group.cluster.firstSeenAt) {
          group.cluster.firstSeenAt = occurrence.seenAt;
        }
        if (!group.cluster.lastSeenAt || occurrence.seenAt > group.cluster.lastSeenAt) {
          group.cluster.lastSeenAt = occurrence.seenAt;
        }
      }
    }
  }

  const clusters: ObjectionCluster[] = [];
  for (const group of groups.values()) {
    group.cluster.conversationCount = group.conversations.size;
    clusters.push(group.cluster);
  }

  return clusters.sort(
    (a, b) => b.conversationCount - a.conversationCount || b.messageCount - a.messageCount,
  );
}

/** `detectObjections()` natijasini toifalar ro'yxatiga aylantiradi. */
export function kindsOf(detected: readonly DetectedObjection[]): ObjectionKind[] {
  return [...new Set(detected.map((item) => item.kind))];
}
