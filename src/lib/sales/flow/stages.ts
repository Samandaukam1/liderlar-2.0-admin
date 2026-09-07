/**
 * Sotuv ssenariysining HOLAT MASHINASI.
 *
 * NEGA MASHINA: ssenariy chiziqli emas — mijoz har bosqichda "ha",
 * "yo'q", "keyinroq" yoki savol bilan javob berishi mumkin va har biri
 * boshqa yo'lga olib boradi. Buni `if` lar bilan yozsak, qaysi xabar
 * qachon yuborilishini hech kim aytib bera olmasdi.
 *
 * IDEMPOTENTLIK: `resolveTransition` bir xil (bosqich, niyat) juftligiga
 * doim bir xil natija beradi va allaqachon o'tilgan bosqichga qaytmaydi.
 * Telegram bitta update'ni ikki marta yetkazsa, ikkinchisi bosqichni
 * oldinga surmaydi.
 *
 * SOF MODUL — baza ham, Telegram ham yo'q.
 */

export const SALES_STAGES = [
  "new",
  "application_confirm",
  "benefits_question",
  "benefits_sent",
  "offer_sent",
  "waiting_offer_review",
  "article_decision",
  "need_full_name",
  "intake_link_sent",
  "waiting_intake",
  "intake_submitted",
  "payment_requested",
  "waiting_payment",
  "payment_review",
  "paid",
  "declined",
  "followup_later",
  "completed",
] as const;

export type SalesStage = (typeof SALES_STAGES)[number];

export const SALES_STAGE_LABELS: Record<SalesStage, string> = {
  new: "Yangi",
  application_confirm: "Ariza tasdiqlanmoqda",
  benefits_question: "Foydalar so‘raldi",
  benefits_sent: "Foydalar yuborildi",
  offer_sent: "Taklif yuborildi",
  waiting_offer_review: "Tanishishi kutilmoqda",
  article_decision: "Maqola qarori",
  need_full_name: "F.I.Sh. so‘raldi",
  intake_link_sent: "Anketa havolasi yuborildi",
  waiting_intake: "Anketa kutilmoqda",
  intake_submitted: "Anketa to‘ldirildi",
  payment_requested: "To‘lov so‘raldi",
  waiting_payment: "To‘lov kutilmoqda",
  payment_review: "Chek tekshirilmoqda",
  paid: "To‘langan",
  declined: "Rad etgan",
  followup_later: "Keyinroq deb qoldirgan",
  completed: "Yakunlangan",
};

/** Bu bosqichlarda ssenariy tugagan — AI o'zidan xabar boshlamaydi. */
export const TERMINAL_STAGES: readonly SalesStage[] = ["paid", "declined", "completed"];

export function isSalesStage(value: unknown): value is SalesStage {
  return typeof value === "string" && (SALES_STAGES as readonly string[]).includes(value);
}

/* ------------------------------- niyatlar ------------------------------- */

export const REPLY_INTENTS = [
  "yes",
  "no",
  "later",
  "reviewed",
  "not_reviewed",
  "need_info",
  "question",
  "full_name",
  "payment_evidence",
  "other",
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

/* ------------------------------ o‘tishlar ------------------------------- */

/** Bir o'tishda yuboriladigan template'lar ketma-ketligi. */
export interface StageTransition {
  from: SalesStage;
  intent: ReplyIntent;
  to: SalesStage;
  /** AYNAN yuboriladigan template kalitlari, tartib bilan. */
  templates: readonly string[];
  /** Javob kelmasa rejalashtiriladigan follow-up. */
  followup?: { type: string; delayMinutes: number };
  /** Bu o'tish maxsus ishlov talab qiladi (F.I.Sh., anketa havolasi). */
  action?: "request_intake_link";
}

/**
 * SSENARIY JADVALI.
 *
 * Har qator texnik topshiriqdagi bitta qadam. Jadval ko'rinishida
 * bo'lgani uchun "mijoz shu bosqichda shunday desa nima bo'ladi?"
 * degan savolga koddan emas, shu ro'yxatdan javob topiladi.
 */
export const STAGE_TRANSITIONS: readonly StageTransition[] = [
  // 2. Boshlanish — salomlashish va ariza tasdig'i.
  { from: "new", intent: "other", to: "application_confirm", templates: ["application_confirm"] },
  { from: "new", intent: "yes", to: "application_confirm", templates: ["application_confirm"] },
  { from: "new", intent: "question", to: "application_confirm", templates: ["application_confirm"] },

  // 3. "Ha" desa — foydalar haqida bilasizmi?
  {
    from: "application_confirm",
    intent: "yes",
    to: "benefits_question",
    templates: ["benefits_question"],
  },
  { from: "application_confirm", intent: "no", to: "declined", templates: ["declined"] },

  // 4–5. Ma'lumot kerak bo'lsa: tushunarli -> foydalar -> oferta -> narx.
  {
    from: "benefits_question",
    intent: "no",
    to: "offer_sent",
    templates: ["understood", "benefits_full", "benefits_review_prompt", "price_offer"],
    // 7 daqiqa javob bo'lmasa "Tanishib chiqdingizmi?".
    followup: { type: "offer_review", delayMinutes: 7 },
  },
  {
    from: "benefits_question",
    intent: "need_info",
    to: "offer_sent",
    templates: ["understood", "benefits_full", "benefits_review_prompt", "price_offer"],
    followup: { type: "offer_review", delayMinutes: 7 },
  },
  // Bilaman desa ham oferta va narx yuboriladi — sotuv qadami tushib
  // qolmasligi kerak, faqat uzun foydalar matni takrorlanmaydi.
  {
    from: "benefits_question",
    intent: "yes",
    to: "offer_sent",
    templates: ["benefits_review_prompt", "price_offer"],
    followup: { type: "offer_review", delayMinutes: 7 },
  },

  // 8. Tanishdim / tanishmadim.
  {
    from: "offer_sent",
    intent: "reviewed",
    to: "article_decision",
    templates: ["article_decision"],
  },
  {
    from: "offer_sent",
    intent: "not_reviewed",
    to: "waiting_offer_review",
    templates: ["review_later"],
    followup: { type: "article_decision", delayMinutes: 5 },
  },
  {
    from: "waiting_offer_review",
    intent: "reviewed",
    to: "article_decision",
    templates: ["article_decision"],
  },
  // Mijoz "hali tanishmadim" ni QAYTA yozsa.
  //
  // NEGA KERAK: har kiruvchi xabar kutilayotgan follow-up'ni bekor
  // qiladi. Bu qadam bo'lmasa, bekor qilingan 5 daqiqalik eslatma
  // o'rniga hech narsa rejalashtirilmasdi va suhbat SHU YERDA ABADIY
  // to'xtab qolardi. O'z-o'ziga qaytish bosqichni surmaydi, faqat
  // taymerni qaytadan qo'yadi.
  {
    from: "waiting_offer_review",
    intent: "not_reviewed",
    to: "waiting_offer_review",
    templates: [],
    followup: { type: "article_decision", delayMinutes: 5 },
  },

  // 9–11. Maqola yozamizmi?
  {
    from: "article_decision",
    intent: "yes",
    to: "need_full_name",
    templates: ["request_full_name"],
  },
  { from: "article_decision", intent: "no", to: "declined", templates: ["declined"] },
  {
    from: "article_decision",
    intent: "later",
    to: "followup_later",
    templates: [],
    followup: { type: "article_decision_later", delayMinutes: 60 },
  },
  {
    from: "followup_later",
    intent: "yes",
    to: "need_full_name",
    templates: ["request_full_name"],
  },
  { from: "followup_later", intent: "no", to: "declined", templates: ["declined"] },
  // "Keyinroq" ni qayta aytsa — taymer qaytadan qo'yiladi (yuqoridagi
  // bilan bir xil sabab: bekor qilingan eslatma o'rnini bosish kerak).
  {
    from: "followup_later",
    intent: "later",
    to: "followup_later",
    templates: [],
    followup: { type: "article_decision_later", delayMinutes: 60 },
  },

  // 12–14. F.I.Sh. -> anketa havolasi.
  {
    from: "need_full_name",
    intent: "full_name",
    to: "intake_link_sent",
    templates: ["intake_instructions"],
    action: "request_intake_link",
  },
  {
    from: "need_full_name",
    intent: "other",
    to: "need_full_name",
    templates: ["request_full_name_again"],
  },

  // 17. To'lov kutilayotganda chek kelsa.
  {
    from: "waiting_payment",
    intent: "payment_evidence",
    to: "payment_review",
    templates: ["payment_received"],
  },
];

/** Ssenariyda javobi bor bosqichlar — qolganida AI bilim bilan javob beradi. */
const TRANSITION_INDEX = new Map<string, StageTransition>(
  STAGE_TRANSITIONS.map((t) => [`${t.from}|${t.intent}`, t]),
);

export function resolveTransition(
  stage: SalesStage,
  intent: ReplyIntent,
): StageTransition | null {
  return TRANSITION_INDEX.get(`${stage}|${intent}`) ?? null;
}

/**
 * Bosqichlarning tabiiy tartibi — orqaga ketishning oldini olish uchun.
 * Ssenariydan tashqaridagi bosqichlar (declined, paid) tartibda emas.
 */
const ORDER: readonly SalesStage[] = [
  "new",
  "application_confirm",
  "benefits_question",
  "benefits_sent",
  "offer_sent",
  "waiting_offer_review",
  "article_decision",
  "need_full_name",
  "intake_link_sent",
  "waiting_intake",
  "intake_submitted",
  "payment_requested",
  "waiting_payment",
  "payment_review",
  "paid",
];

/**
 * Bosqich oldinga siljiydimi.
 *
 * IDEMPOTENTLIK KAFOLATI: takroriy update kelsa yoki mijoz "ha" ni ikki
 * marta yozsa, bosqich AYNAN BIR marta oldinga suriladi. Orqaga qaytish
 * ham bloklanadi — "ha" degan mijoz keyin yana "ha" desa, ssenariy
 * boshiga tushib qolmaydi.
 */
export function isForwardTransition(from: SalesStage, to: SalesStage): boolean {
  if (from === to) return false;
  // Ssenariydan chiqish (rad etish / keyinroq) har bosqichda mumkin.
  if (!ORDER.includes(to)) return true;
  const fromIndex = ORDER.indexOf(from);
  const toIndex = ORDER.indexOf(to);
  if (fromIndex === -1) return true;
  return toIndex > fromIndex;
}
