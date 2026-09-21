/**
 * XABAR ≠ SAVOL.
 *
 * ILDIZ SABAB (audit): tizimda mijoz xabarining MULOQOT
 * ma'nosini aniqlaydigan qatlam umuman yo'q edi. `classifyReply`
 * faqat voronka niyatini beradi (ha/yo'q/tanishdim), qolgan
 * hamma narsa "other" bo'lib bilim bazasiga yuborilardi. Bilim
 * topilmasa — savol "Javobsiz savollar" ga yozilardi.
 *
 * Natijada u yerga "Hop", "Rahmat", "Tanishib chiqdim", ".",
 * "хоп", odamlarning ismlari tushib ketdi: ularning hech biri
 * savol emas.
 *
 * YAGONA TO'G'RI ANIQ RO'YXAT YO'Q. Shuning uchun bu modul
 * qat'iy matn solishtirishga TAYANMAYDI:
 *   1. matn normallashadi (apostrof, kirill, imlo variantlari);
 *   2. niyat MA'NO guruhlari bo'yicha aniqlanadi;
 *   3. qisqa xabar SUHBAT KONTEKSTI bilan hal qilinadi —
 *      "Mana", "Yubordim", "Bo'ldimi?" o'zicha ma'nosiz.
 *
 * SOF MODUL — baza ham, model ham yo'q. Shuning uchun u
 * "Rahmat" uchun LLM chaqirmaydi (36-band).
 */

import { normalizeForIntent } from "../text-normalize.ts";
import { validateFullName } from "./full-name.ts";
import type { SalesStage } from "./stages.ts";

/* ========================================================================= *
 * TURLAR
 * ========================================================================= */

export const MESSAGE_INTENTS = [
  "greeting",
  "thanks",
  "acknowledgement",
  "confirmation",
  "decline",
  "cancellation",
  "affirmation",
  "negation",
  "identity_data",
  "form_data",
  "attachment_reference",
  "payment_receipt_reference",
  "status_question",
  "price_question",
  "process_question",
  "knowledge_question",
  "follow_up_question",
  "clarification",
  "continuation",
  "action_confirmation",
  "complaint",
  "human_request",
  "off_topic",
  "ambiguous",
  "spam_or_noise",
] as const;
export type MessageIntent = (typeof MESSAGE_INTENTS)[number];

export const MESSAGE_INTENT_LABELS: Record<MessageIntent, string> = {
  greeting: "Salomlashish",
  thanks: "Minnatdorchilik",
  acknowledgement: "Tan olish / tushundim",
  confirmation: "Tasdiq",
  decline: "Rad etish",
  cancellation: "Bekor qilish / chiqarmang",
  affirmation: "Rozilik",
  negation: "Inkor",
  identity_data: "Shaxs ma’lumoti (ism)",
  form_data: "Anketa ma’lumoti",
  attachment_reference: "Biriktirmaga ishora",
  payment_receipt_reference: "Chekka ishora",
  status_question: "Holat savoli",
  price_question: "Narx savoli",
  process_question: "Jarayon savoli",
  knowledge_question: "Bilim savoli",
  follow_up_question: "Davomiy savol",
  clarification: "Aniqlashtirish",
  continuation: "Keyingi qadam so‘rovi",
  action_confirmation: "Bajarganini aytdi",
  complaint: "Shikoyat",
  human_request: "Odam so‘radi",
  off_topic: "Mavzudan tashqari",
  ambiguous: "Noaniq",
  spam_or_noise: "Shovqin",
};

/** Mijozdan nima kutilayotgani — oldingi javobdan kelib chiqadi. */
export const PENDING_USER_ACTIONS = [
  "none",
  "send_full_name",
  "send_payment_receipt",
  "submit_intake",
  "review_offer",
  "decide_article",
  "answer_question",
] as const;
export type PendingUserAction = (typeof PENDING_USER_ACTIONS)[number];

/** Xabar NIMAGA ishora qilyapti. */
export const REFERENCED_OBJECTS = [
  "none",
  "identity",
  "payment",
  "intake",
  "offer",
  "article",
  "certificate",
  "price",
] as const;
export type ReferencedObject = (typeof REFERENCED_OBJECTS)[number];

export interface IntentContext {
  stage: SalesStage;
  /** Oldingi javobdan kelib chiqadigan kutilayotgan harakat. */
  pendingUserAction: PendingUserAction;
  /** Xabarga rasm/hujjat biriktirilganmi. */
  hasAttachment: boolean;
  /**
   * Biriktirma CHEK deb tasniflanganmi.
   *
   * ODDIY RASM CHEK EMAS (P0). Mijozlar eng ko'p MAQOLA UCHUN
   * PORTRET yuboradi. "Chek qabul qilindi" degan javob faqat
   * biriktirma chek deb tasniflanganda beriladi — aks holda
   * bot to'lov kelgandek muomala qilardi.
   */
  attachmentIsPayment?: boolean;
  /** Suhbatda oldin xabar bo'lganmi. */
  hasHistory: boolean;
}

export const EMPTY_INTENT_CONTEXT: IntentContext = {
  stage: "new",
  pendingUserAction: "none",
  hasAttachment: false,
  hasHistory: false,
};

export interface IntentResult {
  intent: MessageIntent;
  confidence: "high" | "medium" | "low";
  /** Qaysi qoida ishladi — diagnostika va panel uchun. */
  matched: string | null;
  /**
   * Javob berish uchun TASDIQLANGAN BILIM kerakmi.
   *
   * Bu maydon "Javobsiz savollar" darvozasining asosi: false
   * bo'lsa, bilim bazasiga umuman murojaat qilinmaydi va
   * bo'shliq yozilmaydi.
   */
  needsKnowledge: boolean;
  /**
   * Javob MIJOZNING O'Z holatidan kelishi kerakmi.
   *
   * "Maqolam tayyormi?" — umumiy bilim bunga javob bermaydi.
   * Bunday savol bilim bo'shlig'i EMAS (7-band).
   */
  needsSystemState: boolean;
  referencedObject: ReferencedObject;
}

/* ========================================================================= *
 * MA'NO GURUHLARI
 *
 * Har biri NAQSH, ro'yxat emas: "rahmat" ham, "raxmat" ham,
 * "rahmatlar" ham, "kattakon rahmat" ham bitta naqshga tushadi.
 * ========================================================================= */

interface SemanticGroup {
  id: string;
  patterns: readonly RegExp[];
}

/** Salomlashish. */
const GREETING: SemanticGroup = {
  id: "greeting",
  patterns: [
    /assalom|assalam|salom\b|salem|alaykum|aleykum|aleikum/u,
    /\bhayrli (kun|tong|kech)|xayrli (kun|tong|kech)/u,
    /yaxshimisiz|yaxshimisz|qalaysiz|ahvollaringiz|zdravstvuyte|privet/u,
  ],
};

/** Minnatdorchilik. */
const THANKS: SemanticGroup = {
  id: "thanks",
  patterns: [
    /\br[ae]h?x?mat|tashakkur|spasibo|minnatdor/u,
  ],
};

/**
 * Tan olish — "eshitdim, tushundim, davom etamiz".
 *
 * Eng katta guruh va aynan shu guruh javobsiz savollarni
 * ifloslantirgan edi.
 */
const ACKNOWLEDGEMENT: SemanticGroup = {
  id: "acknowledgement",
  patterns: [
    // hop / xop / xo'p / ho'p / hup / xup
    /(?:^|[^\p{L}])[hx][ou]'?p(?:[^\p{L}]|$)/u,
    // aha / axa / ahaa / aga
    /(?:^|[^\p{L}])a[hxg]a+(?:[^\p{L}]|$)/u,
    /tushunarli|tushundim|tushindim|angladim/u,
    /ma'?qul|mayli|yaxshi\b|zo'?r\b|durust/u,
    // bo'ldi / buldi / bulli / boldi — "tamom" ma'nosida
    /(?:^|[^\p{L}])b[ou]'?l[dl]i(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])hozi(?:r)?(?:[^\p{L}]|$)/u,
    /tanishdim|tanishib chiq|o'?qidim|o'?qib chiq|ko'?rdim/u,
  ],
};

/**
 * Ko'rib chiqqanini aytdi: "tanishdim", "o'qidim", "ko'rdim".
 *
 * Bu ALOHIDA guruh, chunki uni oddiy tan olish deb o'qish
 * botni kulgili qilardi: mijoz "tanishib chiqdim" deganda
 * "shartlar bilan tanishib chiqqach ayting" degan eslatma
 * qaytardi — ya'ni bot uni o'qimagani ko'rinib turardi.
 */
const REVIEW_CONFIRMATION: SemanticGroup = {
  id: "review_confirmation",
  patterns: [/tanish[dt]im|tanishib chiq|o'?qidim|o'?qib chiq|ko'?rdim|ko'?rib chiq/u],
};

/**
 * AYNAN TO'LOV haqidagi fe'llar.
 *
 * Auditda (B reproduksiyasi): anketa topshirilgandan keyin
 * mijoz «Ha toldirdim» degan va bot «Chek qabul qilindi» deb
 * javob bergan. Sabab — «bajardim» fe'li kutilayotgan
 * harakatga KO'R-KO'RONA bog'langan edi: bosqich
 * `waiting_payment` bo'lgani uchun «to'ldirdim» ham chek
 * hisoblangan.
 *
 * "to'ldirdim" — ANKETANI to'ldirdim; "to'ladim" — PUL to'ladim.
 * Bir harf farq qiladi va ma'no butunlay boshqa.
 */
const PAYMENT_ACTION: SemanticGroup = {
  id: "payment_action",
  patterns: [
    /to'?la[dt]im|to'?lov qildim|pul (?:tashla|yubor|o'?tkaz)/u,
    /kartaga (?:tashla|yubor|o'?tkaz)|hisobga o'?tkaz/u,
    /chekni yubordim|chek yubordim|chekni tashladim/u,
  ],
};

/** AYNAN ANKETA haqidagi fe'llar. */
const INTAKE_ACTION: SemanticGroup = {
  id: "intake_action",
  patterns: [
    /to'?ldir[dt]im|to'?ldirib yubordim|javob(?:lar)?(?:ni)? (?:berdim|yubordim|yozdim)/u,
    /anketani (?:to'?ldir|yubor)|savollarga javob berdim/u,
  ],
};

/** Mijoz so'ralgan ishni BAJARGANINI aytdi (fe'l aniq emas). */
const ACTION_CONFIRMATION: SemanticGroup = {
  id: "action_confirmation",
  patterns: [
    /yubor[dt]i?m|yubordm|jo'?nat[dt]im|tashla[dt]im|otkaz[dt]im|o'?tkaz[dt]im/u,
    /\bqil[dt]im\b|\bto'?la[dt]im\b|\btushir[dt]im\b|\bsolib yubordim\b/u,
  ],
};

/** Biriktirmaga ishora: "mana", "ana", "shu". */
const ATTACHMENT_REFERENCE: SemanticGroup = {
  id: "attachment_reference",
  patterns: [
    /(?:^|[^\p{L}])(?:mana|ana|mna|manabu|mana bu|shu\b|shuni\b|bu\b)(?:[^\p{L}]|$)/u,
  ],
};

/** Holat savoli: "bo'ldimi?", "tayyormi?", "tushdimi?". */
const STATUS_QUESTION: SemanticGroup = {
  id: "status_question",
  patterns: [
    /b[ou]'?l[dt]imi|bulldimi|tayyormi|tayormi|chiq[dt]imi|bitdimi/u,
    /tush[dt]imi|o'?t[dt]imi/u,
    /*
     * "qabul qilinadi" EMAS, "qabul bo'ldimi" — farq katta.
     * Birinchisi umumiy savol ("kim qabul qilinadi?"), ikkinchisi
     * mijozning o'z holati. Keng naqsh umumiy savolni ham
     * shaxsiy holat deb o'qib, uni bilim bazasidan uzib
     * qo'yardi.
     */
    /qabul bo'?l[dt]imi|qabul qilin[dt]imi/u,
    /qachon (?:tayyor|chiqa|bo'?la)|nima bo'?ldi|qanaqa bo'?ldi/u,
    /*
     * «Qachon javobi chiqadi» — ARIZA natijasi haqida
     * (E reproduksiyasi). Ilgari bu bilim savoli bo'lib
     * ketardi va bot Google'da indekslanish haqida javob
     * berardi: mijoz umuman bu haqda so'ramagan edi.
     */
    /javob(?:i|lar)?(?:ni)? (?:qachon )?(?:chiq|kel|bo'?l)/u,
    /natija(?:si)?(?:ni)? (?:qachon )?(?:chiq|kel|bo'?l|ayt)/u,
    /holati?\b|status/u,
  ],
};

/** Narx savoli. */
const PRICE_QUESTION: SemanticGroup = {
  id: "price_question",
  patterns: [
    /qancha|necha pul|nech pul|narx|to'?lov(?:i|ni)? qancha|qanchadan|puli qancha/u,
  ],
};

/** Keyingi qadam so'rovi. */
const CONTINUATION: SemanticGroup = {
  id: "continuation",
  patterns: [
    /(?:^|[^\p{L}])endi(?:[^\p{L}]|$)|keyin ?chi|keyin nima|nima qil(?:ish|ay|aman)/u,
    /davom et|keyingi qadam|nima qilishim kerak/u,
  ],
};

/** Inkor / rad etish. */
const DECLINE: SemanticGroup = {
  id: "decline",
  patterns: [
    /yo'?q\b|kerak emas|kerakmas|istamayman|xohlamayman|qiziqmayman|rad etaman/u,
  ],
};

/** Rozilik. */
const AFFIRMATION: SemanticGroup = {
  id: "affirmation",
  patterns: [
    /(?:^|[^\p{L}])(?:ha+|xa+|da)(?:[^\p{L}]|$)/u,
    /roziman|albatta|to'?g'?ri\b|shunaqa|shundoq|\bok\b|okey/u,
  ],
};

/**
 * BEKOR QILISH / CHIQARMANG (2-band, F reproduksiyasi).
 *
 * Auditda: mijoz «Чикармела ккмас» (chiqarmang, kerakmas) deb
 * yozgan, keyin «Рахмат» degan. Bot minnatdorchilikni birinchi
 * ko'rib, «Arzimaydi. Shartlar bilan tanishib chiqqach ayting»
 * deb javob bergan — ya'ni BEKOR QILISH NIYATI YO'QOLGAN.
 *
 * Shu sababli bu guruh minnatdorchilikdan ham, tan olishdan ham
 * OLDIN tekshiriladi: bitta xabarda ikkalasi bo'lsa, bekor
 * qilish ustun.
 */
const CANCELLATION: SemanticGroup = {
  id: "cancellation",
  patterns: [
    /*
     * chiqarmang / chikarmela / chiqarma — nashr etilmasin.
     *
     * Oxirgi unli OLINIB TASHLANDI: jonli xabar «Чикармела»
     * ko'rinishida kelgan va `chiqarma` naqshi uni tutmagan.
     * `chiqarm` esa tutadi.
     *
     * "chiqaring" (nashr eting) tutilmaydi — unda `m` yo'q.
     */
    /chi[qk]arm|chop etma|joylama|nashr qilma/u,
    /bekor qil|to'?xtat|olib tashla|o'?chirib tashla|o'?chiring/u,
    /*
     * «Kerak emas» YOLG'IZ — bu BEKOR QILISH EMAS, oddiy rad
     * javobi ("taklif kerak emas"). Uni bekor qilish deb
     * o'qish har rad javobiga odam topshirig'i yaratardi.
     *
     * Shuning uchun faqat BEKOR QILUVCHI FE'L bilan birga:
     * «chiqarmang, kerakmas» — bu boshqa gap.
     */
    /voz kech(?:dim|aman)|hojat yo'?q/u,
  ],
};

/** Shikoyat. */
const COMPLAINT: SemanticGroup = {
  id: "complaint",
  patterns: [/shikoyat|norozi|alda|yomon xizmat|javob bermayapsiz|kutdim/u],
};

/** Odam so'radi. */
const HUMAN_REQUEST: SemanticGroup = {
  id: "human_request",
  patterns: [/odam bilan|operator|menejer|mas'?ul|jonli odam|inson bilan/u],
};

/** So'roq belgilari — bilim savoli uchun. */
const QUESTION_MARKERS =
  /\b(qancha|qanday|qayer|qachon|nima|nega|kim|necha|nech|qaysi|bormi|mumkinmi|kerakmi|qanaqa|qilaman|qilamiz)\b|\?/u;

/** Jarayon savoli — "qanday qilib", "qanday topshiraman". */
const PROCESS_MARKERS = /qanday qil|qanday topshir|qanday yubor|jarayon|bosqich|qadam/u;

function matches(group: SemanticGroup, text: string): string | null {
  return group.patterns.some((pattern) => pattern.test(text)) ? group.id : null;
}

/* ========================================================================= *
 * SHOVQIN VA ISM
 * ========================================================================= */

/** Faqat tinish belgisi, emoji yoki bo'sh. */
export function isNoiseOnly(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (raw === "") return true;
  // Harf ham, raqam ham yo'q — demak mazmun yo'q.
  return !/[\p{L}\p{N}]/u.test(raw);
}

/**
 * Xabar RAQAMLI IDENTIFIKATORmi (34-band).
 *
 * Javobsiz savollar ro'yxatida karta va hisob raqamlari bor
 * edi. Ular savol emas va ularni bilim sifatida o'rganish
 * XAVFLI: mijoz yozgan raqam rasmiy to'lov ma'lumoti bo'lib
 * qolishi mumkin edi.
 *
 * Bunday xabar shovqin deb tasniflanadi va bo'shliqqa umuman
 * tushmaydi.
 */
export function isNumericIdentifier(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (raw === "") return false;

  const digits = (raw.match(/\d/g) ?? []).length;
  if (digits < 6) return false;

  const letters = (raw.match(/\p{L}/gu) ?? []).length;
  // Raqamlar hukmron: bir nechta so'z bo'lsa bu savol bo'lishi mumkin.
  return digits >= letters * 2;
}

/**
 * Matn ODAM ISMIGA o'xshaydimi.
 *
 * AUDITDA IKKI JIDDIY XATO (A va B reproduksiyalari):
 *   · «shu joyi ai notori qib qoyibdi» F.I.Sh. bo'lib yozilgan
 *     va shu nom bilan YANGI ANKETA yaratilgan;
 *   · «Royxatdan oʻtdim endichi» ham F.I.Sh. bo'lib qolgan.
 *
 * Sabab: `validateFullName` faqat "kamida ikkita ma'noli
 * bo'lak" talab qiladi — har qanday gap shu shartni bajaradi.
 *
 * YECHIM QO'SHIMCHAGA BOG'LANMAYDI. Ilgari bu yerda
 * `-ov/-ova/-qizi` qo'shimchasi TALAB qilinardi va u
 * «Dilnoza Sobir» kabi haqiqiy ismni rad etardi. Endi
 * tekshiruv SALBIY SIGNALLARGA asoslanadi: gap bo'lagi,
 * fe'l, savol yoki xizmat so'zi bo'lsa — ism emas.
 */

/** Ism bo'lagi bo'la olmaydigan so'zlar. */
const NON_NAME_WORDS = new Set([
  // ko'rsatish va bog'lovchilar
  "shu", "bu", "u", "ana", "mana", "endi", "endichi", "yana", "hozir",
  "deb", "uchun", "bilan", "ham", "lekin", "ammo", "yoki", "va",
  // xizmatga oid otlar
  "anketa", "ariza", "maqola", "post", "chek", "tolov", "to'lov",
  "narx", "narxi", "pul", "link", "havola", "sayt", "rasm", "video",
  "joyi", "joy", "ai", "bot", "admin", "sertifikat", "royxat", "ro'yxat",
  // odatiy fe'l shakllari
  "qildim", "qilib", "qib", "qoyibdi", "qo'yibdi", "otdim", "o'tdim",
  "boldi", "bo'ldi", "keldim", "yozdim", "yubordim", "tashladim",
  "toldirdim", "to'ldirdim", "oldim", "berdim", "ketdim", "bordim",
  "bolsa", "bo'lsa", "kerak", "mumkin", "notori", "notog'ri", "noto'g'ri",
  // buyruq shakllari va xushmuomalalik so'zlari
  "iltimos", "bekor", "qiling", "yuboring", "ayting", "bering", "qilib",
  "tashlang", "toxtating", "to'xtating", "chiqaring", "chiqarmang",
]);

/**
 * O'ZBEK FE'L QO'SHIMCHALARI.
 *
 * Ism bo'lagi bunday tugamaydi. Rad etish ARZON: mijozdan
 * ismni qayta so'raymiz. Noto'g'ri qabul qilish QIMMAT:
 * anketa va maqola chala nom bilan chiqadi.
 */
const VERB_ENDINGS = /(?:dim|tim|dik|tik|ibdi|yapti|moqda|ganman|yapman|masdan|mayman|sizmi|dimi)$/u;

/** Ism-familiyaga xos qo'shimchalar — MAJBURIY emas, faqat signal. */
const NAME_SUFFIXES =
  /(?:ov|ova|yev|yeva|ev|eva|zoda|zade|qizi|o'?g'?li|ugli|vich|vna|bek|jon)$/u;

/**
 * Ismga xos IJOBIY signal bormi.
 *
 * Ism kutilmayotgan joyda bitta salbiy tekshiruv yetarli
 * emas: "falon pismadon narsa" ham undan o'tib ketadi va
 * tasodifiy matn "ism" bo'lib qolardi. Odamlar ismni bosh
 * harf bilan yozadi — shu eng ishonchli signal.
 */
function hasNameSignal(tokens: readonly string[], raw: string): boolean {
  if (tokens.some((token) => NAME_SUFFIXES.test(token.toLowerCase()))) return true;

  const words = raw.trim().split(/[\s,]+/).filter((word) => word !== "");
  return (
    words.length >= 2 &&
    words.every((word) => {
      const first = word[0] ?? "";
      return first === first.toLocaleUpperCase("uz") && first !== first.toLocaleLowerCase("uz");
    })
  );
}

export function looksLikePersonName(
  text: string | null | undefined,
  /** Ism AYNAN shu bosqichda so'ralganmi. */
  expectingName = false,
): boolean {
  const check = validateFullName(text);
  if (!check.ok) return false;
  // Ikkitadan kam — F.I.Sh. emas; beshtadan ko'p — bu gap.
  if (check.tokens.length < 2 || check.tokens.length > 5) return false;

  const raw = (text ?? "").trim();
  // Raqam bor bo'lsa bu ism emas (identifikator yoki sana).
  if (/\d/.test(raw)) return false;

  const normalized = normalizeForIntent(raw);
  if (QUESTION_MARKERS.test(normalized)) return false;

  for (const token of check.tokens) {
    const lower = normalizeForIntent(token).trim();
    if (lower.length < 2 || lower.length > 24) return false;
    if (NON_NAME_WORDS.has(lower)) return false;
    if (VERB_ENDINGS.test(lower)) return false;
    // Harf, apostrof va defisdan boshqa narsa bo'lmasin.
    if (!/^[\p{L}'\-]+$/u.test(lower)) return false;
  }

  // Ism so'ralgan bo'lsa shakl yetarli; aks holda ijobiy signal kerak.
  return expectingName || hasNameSignal(check.tokens, raw);
}

/* ========================================================================= *
 * KONTEKSTDAN ISHORA
 * ========================================================================= */

/** Kutilayotgan harakat qaysi obyektga tegishli. */
export function objectOfPendingAction(action: PendingUserAction): ReferencedObject {
  switch (action) {
    case "send_full_name":
      return "identity";
    case "send_payment_receipt":
      return "payment";
    case "submit_intake":
      return "intake";
    case "review_offer":
      return "offer";
    case "decide_article":
      return "article";
    default:
      return "none";
  }
}

/**
 * Bosqichdan kutilayotgan harakatni chiqaradi.
 *
 * ALOHIDA HOLAT SAQLANMAYDI: bosqich allaqachon bazada va u
 * haqiqiy voqealardan yangilanadi. Ikkinchi holat tizimi
 * yaratilsa, ikkovi vaqt o'tib ajralib ketardi (4-band).
 */
export function pendingActionForStage(
  stage: SalesStage,
  /**
   * Bu mijozdan pul so'ralishi kerakmi.
   *
   * IMTIYOZ BUTUN ZANJIRDA HISOBGA OLINADI (P0, B reproduksiyasi).
   * Auditda imtiyozli mijozga «To'lov chekini shu yerga yuboring»
   * deb yozilgan: shablonlar to'silgan edi, LEKIN bosqichdan
   * kelib chiqadigan eslatma to'silmagan edi.
   */
  paymentRequired = true,
): PendingUserAction {
  switch (stage) {
    case "need_full_name":
      return "send_full_name";
    case "intake_link_sent":
    case "waiting_intake":
      return "submit_intake";
    case "payment_requested":
    case "waiting_payment":
      return paymentRequired ? "send_payment_receipt" : "none";
    case "offer_sent":
    case "waiting_offer_review":
      return "review_offer";
    case "article_decision":
      return "decide_article";
    case "benefits_question":
    case "application_confirm":
      return "answer_question";
    default:
      return "none";
  }
}

/* ========================================================================= *
 * TASNIFLASH
 * ========================================================================= */

interface Decision {
  intent: MessageIntent;
  confidence: "high" | "medium" | "low";
  matched: string | null;
  referencedObject?: ReferencedObject;
}

/** Bilim bazasi FAQAT shu niyatlar uchun ochiladi. */
const KNOWLEDGE_INTENTS: readonly MessageIntent[] = [
  "knowledge_question",
  "process_question",
  "price_question",
  "follow_up_question",
];

/** Javob mijozning O'Z holatidan kelishi kerak bo'lgan niyatlar. */
const SYSTEM_STATE_INTENTS: readonly MessageIntent[] = ["status_question"];

export function classifyMessageIntent(
  text: string | null | undefined,
  context: IntentContext = EMPTY_INTENT_CONTEXT,
): IntentResult {
  const decision = decide(text, context);
  const referencedObject =
    decision.referencedObject ?? objectOfPendingAction(context.pendingUserAction);

  return {
    intent: decision.intent,
    confidence: decision.confidence,
    matched: decision.matched,
    needsKnowledge: KNOWLEDGE_INTENTS.includes(decision.intent),
    needsSystemState: SYSTEM_STATE_INTENTS.includes(decision.intent),
    referencedObject,
  };
}

function decide(text: string | null | undefined, context: IntentContext): Decision {
  const raw = (text ?? "").trim();

  /* --------------------------- biriktirma ustun -------------------------- */
  /*
   * FAYL MATNDAN USTUN.
   *
   * Mijoz rasm yuborib, izohsiz qoldirishi juda keng tarqalgan.
   * Bo'sh izohni "shovqin" deb o'qish chekni umuman ko'rmaslikka
   * olib borardi (27-band).
   */
  if (context.hasAttachment) {
    const object = objectOfPendingAction(context.pendingUserAction);
    if (object === "payment" && context.attachmentIsPayment === true) {
      return {
        intent: "payment_receipt_reference",
        confidence: "high",
        matched: "fayl + to'lov kutilyapti",
        referencedObject: "payment",
      };
    }
    return {
      intent: "attachment_reference",
      confidence: "high",
      matched: "fayl biriktirilgan",
      referencedObject: object,
    };
  }

  /* --------------------- raqamli identifikator (34-band) ----------------- */
  if (isNumericIdentifier(raw)) {
    return { intent: "spam_or_noise", confidence: "high", matched: "raqamli identifikator" };
  }

  /* ------------------------------ shovqin ------------------------------- */
  if (isNoiseOnly(raw)) {
    /*
     * "?" — MAZMUNSIZ EMAS, kontekstga bog'liq.
     *
     * Oldingi javobimizdan keyin kelgan "?" — "javob bermadingiz"
     * degani. Uni bilim savoli deb yozish eng ko'p uchragan
     * ifloslanish turlaridan biri edi.
     */
    if (/[?？]/u.test(raw) && context.hasHistory) {
      return { intent: "clarification", confidence: "medium", matched: "savol belgisi" };
    }
    return { intent: "spam_or_noise", confidence: "high", matched: "matn yo'q" };
  }

  const normalized = normalizeForIntent(raw).trim();

  /* ------------------------ eng ustun holatlar -------------------------- */
  if (matches(HUMAN_REQUEST, normalized)) {
    return { intent: "human_request", confidence: "high", matched: "odam so'radi" };
  }
  if (matches(COMPLAINT, normalized)) {
    return { intent: "complaint", confidence: "high", matched: "shikoyat" };
  }

  /*
   * BEKOR QILISH — MINNATDORCHILIKDAN OLDIN (P0, F reproduksiyasi).
   *
   * «Chiqarmang, kerakmas. Rahmat» — bitta xabarda ikkalasi.
   * Minnatdorchilik oldin tekshirilsa, bekor qilish butunlay
   * yo'qolardi va bot savdoni davom ettiraverardi.
   */
  if (matches(CANCELLATION, normalized)) {
    return {
      intent: "cancellation",
      confidence: "high",
      matched: "bekor qilish",
      referencedObject: cancellationObject(normalized, context),
    };
  }

  /* --------------------- ko'rib chiqqanini aytdi ------------------------- */
  if (matches(REVIEW_CONFIRMATION, normalized)) {
    return {
      intent: "confirmation",
      confidence: "high",
      matched: "ko'rib chiqdim",
      referencedObject: context.pendingUserAction === "review_offer" ? "offer" : "none",
    };
  }

  /* --------------------- bajarganini aytdi (kontekst) -------------------- */
  /*
   * "Yubordim", "Qildim", "To'ladim" — bu savol emas, HOLAT
   * o'zgarishi. Nimani yuborgani kutilayotgan harakatdan
   * kelib chiqadi.
   */
  /*
   * FE'L OBYEKTNI BELGILAYDI, BOSQICH EMAS (P0, B reproduksiyasi).
   *
   * Ilgari «bajardim» ma'nosidagi har qanday fe'l kutilayotgan
   * harakatga ko'r-ko'rona bog'lanardi. Natijada anketani
   * to'ldirgan mijozga «Chek qabul qilindi» deb javob ketgan.
   */
  if (matches(INTAKE_ACTION, normalized)) {
    return {
      intent: "action_confirmation",
      confidence: "high",
      matched: "anketani to'ldirdim",
      referencedObject: "intake",
    };
  }
  if (matches(PAYMENT_ACTION, normalized)) {
    /*
     * MIJOZ "TO'LADIM" DEDI — BU CHEK EMAS.
     *
     * Dalil yo'q: na fayl, na tizim yozuvi. Shuning uchun bu
     * "chek keldi" emas, faqat MIJOZNING DA'VOSI (18-band).
     */
    return {
      intent: "action_confirmation",
      confidence: "high",
      matched: "to'ladim (da'vo)",
      referencedObject: "payment",
    };
  }
  if (matches(ACTION_CONFIRMATION, normalized)) {
    return {
      intent: "action_confirmation",
      confidence: context.pendingUserAction === "none" ? "medium" : "high",
      matched: "bajardim (fe'l aniq emas)",
      /*
       * Fe'l aniq emas — obyekt ham aniq emas. Kutilayotgan
       * harakatga bog'lash mumkin, LEKIN to'lov bundan
       * mustasno: noaniq fe'ldan chek dalilini yasab
       * bo'lmaydi.
       */
      referencedObject:
        objectOfPendingAction(context.pendingUserAction) === "payment"
          ? "none"
          : objectOfPendingAction(context.pendingUserAction),
    };
  }

  /* ------------------------- biriktirmaga ishora ------------------------- */
  if (matches(ATTACHMENT_REFERENCE, normalized) && normalized.length <= 20) {
    const object = objectOfPendingAction(context.pendingUserAction);
    return {
      intent: "attachment_reference",
      confidence: object === "none" ? "low" : "medium",
      matched: "ishora so'zi",
      referencedObject: object,
    };
  }

  /* ------------------------------ ism / anketa --------------------------- */
  if (looksLikePersonName(raw, context.pendingUserAction === "send_full_name")) {
    /*
     * ISM HECH QACHON BILIM SAVOLI EMAS (20-band).
     *
     * Kontekst bo'lmasa ham u savol bo'lib qolmaydi — ko'pi
     * bilan "nima yordam kerak?" deb so'raladi.
     */
    return {
      intent: context.pendingUserAction === "send_full_name" ? "form_data" : "identity_data",
      confidence: context.pendingUserAction === "send_full_name" ? "high" : "medium",
      matched: "ism shakli",
      referencedObject: "identity",
    };
  }

  /* --------------------------- savol turlari ----------------------------- */
  /*
   * SAVOLLAR TAN OLISHDAN OLDIN.
   *
   * "Bo'ldimi?" ichida "bo'ldi" bor va tan olish guruhiga
   * tushib ketardi. Savol shakli ustun turishi kerak.
   */
  if (matches(STATUS_QUESTION, normalized)) {
    return {
      intent: "status_question",
      confidence: "high",
      matched: "holat savoli",
      referencedObject: statusObject(normalized, context),
    };
  }
  if (matches(PRICE_QUESTION, normalized)) {
    return {
      intent: "price_question",
      confidence: "high",
      matched: "narx savoli",
      referencedObject: "price",
    };
  }
  if (matches(CONTINUATION, normalized)) {
    return { intent: "continuation", confidence: "high", matched: "keyingi qadam" };
  }

  /* ---------------------- oddiy muloqot (savol emas) --------------------- */
  if (matches(THANKS, normalized)) {
    return { intent: "thanks", confidence: "high", matched: "minnatdorchilik" };
  }
  if (matches(GREETING, normalized)) {
    return { intent: "greeting", confidence: "high", matched: "salomlashish" };
  }
  if (matches(ACKNOWLEDGEMENT, normalized)) {
    return { intent: "acknowledgement", confidence: "high", matched: "tan olish" };
  }
  if (matches(DECLINE, normalized)) {
    return { intent: "decline", confidence: "high", matched: "rad etish" };
  }
  if (matches(AFFIRMATION, normalized)) {
    return { intent: "affirmation", confidence: "high", matched: "rozilik" };
  }

  /* --------------------- QISQA ANIQLASHTIRISH (P1) ----------------------- */
  /*
   * «Qanaqa chek», «Qanaqa shart», «qaysi» — bular BIZNING
   * oldingi xabarimizga tegishli savol, umumiy bilim savoli
   * emas (B, G reproduksiyalari). Ilgari ular bilim bazasiga
   * borardi, javob topilmasdi va «Javobsiz savollar» ga
   * yozilardi — ya'ni bot o'z tushunmovchiligini bilim
   * bo'shlig'i deb qayd etardi.
   */
  const tokens = normalized.split(/\s+/).filter((token) => token !== "");
  if (
    context.hasHistory &&
    /*
     * IKKITA SO'ZGACHA. «Qanday hujjat kerak?» — uchta so'z va
     * u HAQIQIY bilim savoli; uni aniqlashtirish deb o'qish
     * mijozni javobsiz qoldirardi.
     */
    tokens.length <= 2 &&
    /^(?:qanaqa|qaysi|qanday|nimaga|nega)\b/u.test(normalized)
  ) {
    return {
      intent: "clarification",
      confidence: "medium",
      matched: "qisqa aniqlashtirish",
      referencedObject: objectOfPendingAction(context.pendingUserAction),
    };
  }

  /* ------------------------------ bilim savoli --------------------------- */
  /*
   * BILIM SAVOLI KUTILAYOTGAN OBYEKTNI MEROS QILIB OLMAYDI.
   *
   * To'lov haqida gaplashilgan bo'lsa ham, "Sertifikatni
   * qayerdan olaman?" to'lov savoli emas. Eski kontekst yangi
   * savolni bo'yab yuborardi (15-band).
   */
  if (PROCESS_MARKERS.test(normalized)) {
    return {
      intent: "process_question",
      confidence: "medium",
      matched: "jarayon savoli",
      referencedObject: "none",
    };
  }
  if (QUESTION_MARKERS.test(normalized)) {
    return {
      intent: "knowledge_question",
      confidence: "medium",
      matched: "so'roq shakli",
      referencedObject: "none",
    };
  }

  return { intent: "ambiguous", confidence: "low", matched: null };
}

/** Bekor qilish NIMAGA tegishli. */
function cancellationObject(normalized: string, context: IntentContext): ReferencedObject {
  if (/maqola|post|nashr|chi[qk]ar/u.test(normalized)) return "article";
  if (/to'?lov|pul|chek/u.test(normalized)) return "payment";
  if (/anketa|ariza/u.test(normalized)) return "intake";
  return objectOfPendingAction(context.pendingUserAction);
}

/** Holat savoli NIMA haqida. */
function statusObject(normalized: string, context: IntentContext): ReferencedObject {
  if (/maqola|article|chiq|nashr/u.test(normalized)) return "article";
  if (/to'?lov|pul|chek|tush[dt]i/u.test(normalized)) return "payment";
  if (/anketa|ariza|savol|javob/u.test(normalized)) return "intake";
  if (/sertifikat/u.test(normalized)) return "certificate";
  return objectOfPendingAction(context.pendingUserAction);
}
