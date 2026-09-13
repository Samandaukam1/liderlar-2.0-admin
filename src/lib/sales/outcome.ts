/**
 * Suhbat NATIJASINI aniqlash.
 *
 * NEGA AI'SIZ: natija — "ariza yuborildimi, to'lov so'ralganmi, to'landimi"
 * degan FAKT. Uni modelga topshirsak, model ishonchi past holatda ham
 * "paid" deb yozib yuborishi mumkin va butun "eng yaxshi javob" reytingi
 * o'ylab topilgan raqamga qurilardi. Shuning uchun bu yerda faqat aniq
 * belgilar (marker) va ularning ISBOTI — qaysi xabar shu xulosani bergani.
 *
 * ISHONCH YETMASA — `unknown`. Bu ataylab: taxmin qilib "muvaffaqiyatli"
 * deb belgilashdan ko'ra, bilmasligimizni aytish to'g'ri.
 *
 * Bu modul XOM matn ustida ishlaydi (redaksiyadan OLDIN), chunki natija
 * hech qaerga yuborilmaydi — u faqat bizning bazamizda qoladi. Karta
 * raqami maskalangandan keyin "to'lov so'raldi" belgisi yo'qolib ketardi.
 */

import { buildDialogTurns, ensureChronological, type DialogMessage } from "./dialog.ts";
import { normalizeForMatch } from "./text-normalize.ts";

export const SALES_OUTCOMES = [
  "unknown",
  "dropped",
  "continued",
  "application_sent",
  "payment_requested",
  "paid",
  "completed",
] as const;
export type SalesOutcome = (typeof SALES_OUTCOMES)[number];

export const SALES_OUTCOME_LABELS: Record<SalesOutcome, string> = {
  unknown: "Noma’lum",
  dropped: "Uzilgan",
  continued: "Davom etgan",
  application_sent: "Ariza yuborilgan",
  payment_requested: "To‘lov so‘ralgan",
  paid: "To‘langan",
  completed: "Yakunlangan",
};

/**
 * VORONKA BOSQICHLARI — sotuv EMAS.
 *
 * Bular oldinga siljish belgilari: mijoz anketa yubordi, unga to'lov
 * so'rovi ketdi. Ular foydali o'lchov, lekin ularning birortasi ham
 * PUL KELGANINI bildirmaydi.
 */
export const FUNNEL_PROGRESS_OUTCOMES: readonly SalesOutcome[] = [
  "application_sent",
  "payment_requested",
];

/**
 * HAQIQIY SOTUV — faqat tasdiqlangan to'lov (2-faza 30-band).
 *
 * ILGARI BU RO'YXATDA `application_sent` VA `payment_requested` HAM
 * BOR EDI. Oqibati og'ir: "to'lov so'raldi" degan holat "sotildi"
 * bilan bir qatorda turgani uchun har qanday hisobot konversiyani
 * bir necha barobar oshirib ko'rsatardi. Shu son asosida esa qaysi
 * javob yaxshi ishlayotgani baholanardi — ya'ni tizim o'zini
 * o'zi yolg'on ma'lumot bilan o'rgatardi.
 *
 * `paid` ham shubhali edi: uni mijozning "to'ladim" degan MATNI
 * qo'zg'atishi mumkin. Matn moliyaviy tasdiq emas. Shuning uchun
 * u ham asosiy konversiyadan chiqarildi va faqat `completed` —
 * vakolatli tasdiqdan o'tgan holat — sotuv hisoblanadi.
 */
export const SALE_CONFIRMED_OUTCOMES: readonly SalesOutcome[] = ["completed"];

/**
 * Eski nom — mavjud chaqiruvlar buzilmasin uchun saqlanadi, lekin
 * endi FAQAT tasdiqlangan sotuvni bildiradi.
 */
export const SUCCESSFUL_OUTCOMES: readonly SalesOutcome[] = SALE_CONFIRMED_OUTCOMES;

/** Tasdiqlangan sotuvmi. Voronka siljishi bu funksiyada `false`. */
export function isSuccessfulOutcome(outcome: SalesOutcome): boolean {
  return SALE_CONFIRMED_OUTCOMES.includes(outcome);
}

/** Oldinga siljishmi (sotuv bo'lmasa ham). */
export function isFunnelProgress(outcome: SalesOutcome): boolean {
  return FUNNEL_PROGRESS_OUTCOMES.includes(outcome) || isSuccessfulOutcome(outcome);
}

/* ------------------------------- belgilar ------------------------------- */

interface Marker {
  signal: keyof OutcomeSignals;
  /** Belgi kimning xabarida qidiriladi. */
  speaker: "customer" | "us" | "any";
  pattern: RegExp;
}

const MARKERS: Marker[] = [
  // Yakunlangan — maqola/post chiqqani tasdiqlangan.
  {
    signal: "completed",
    speaker: "us",
    pattern: /\b(chiqdi|e'lon qilindi|joylandi|nashr qilindi|maqolangiz tayyor|profilingiz tayyor|link tayyor)\b/i,
  },
  // To'langan.
  {
    signal: "paid",
    speaker: "customer",
    pattern: /\b(to'?ladim|to'?lovni qildim|pul o'?tkazdim|o'?tkazdim|chek yubordim|chek tashladim)\b/i,
  },
  {
    signal: "paid",
    speaker: "us",
    pattern: /\b(to'?lov (qabul qilindi|tushdi|tasdiqlandi)|chek qabul qilindi|tasdiqladik)\b/i,
  },
  // To'lov so'ralgan.
  {
    signal: "paymentRequested",
    speaker: "us",
    pattern: /\b(to'?lov(ni)? (qiling|amalga oshiring)|kartaga o'?tkazing|hisobga o'?tkazing|to'?lash uchun)\b/i,
  },
  // Ariza.
  {
    signal: "applicationSent",
    speaker: "customer",
    pattern: /\b(ariza(ni)? (yubordim|to'?ldirdim|qoldirdim)|ro'?yxatdan o'?tdim|to'?ldirdim)\b/i,
  },
  {
    signal: "applicationSent",
    speaker: "us",
    pattern: /\b(arizangiz (qabul qilindi|olindi)|ro'?yxatga oldik)\b/i,
  },
];

export interface OutcomeSignals {
  completed: boolean;
  paid: boolean;
  paymentRequested: boolean;
  applicationSent: boolean;
  /** Bizning javobimizdan keyin mijoz yana yozganmi. */
  customerRepliedAfterUs: boolean;
  /** Biz javob berdik, mijoz umuman javob qaytarmadi. */
  silentAfterOurLastMessage: boolean;
}

export interface OutcomeResult {
  outcome: SalesOutcome;
  /** Xulosani bergan xabar — adminda "nega shunday" savoliga javob. */
  evidenceMessageId: string | null;
  signals: OutcomeSignals;
  /**
   * Aniq belgiga asoslanganmi. `false` — xulosa faqat suhbat shaklidan
   * chiqarilgan (davom etdi / uzildi) yoki umuman noma'lum.
   */
  confident: boolean;
}

/** Shundan keyin javob kelmasa "uzilgan" deb hisoblanadi. */
const SILENCE_DAYS = 7;

const EMPTY_SIGNALS: OutcomeSignals = {
  completed: false,
  paid: false,
  paymentRequested: false,
  applicationSent: false,
  customerRepliedAfterUs: false,
  silentAfterOurLastMessage: false,
};

/**
 * Suhbat natijasini aniqlaydi.
 *
 * Ustuvorlik: completed > paid > payment_requested > application_sent >
 * continued > dropped > unknown. Yuqoridagisi topilsa pastdagisi
 * ko'rilmaydi — "to'langan" suhbat "davom etgan" deb belgilanmasligi kerak.
 */
export function detectOutcome(
  messages: readonly DialogMessage[],
  options: { now?: Date | string } = {},
): OutcomeResult {
  const ordered = ensureChronological(messages);
  if (ordered.length === 0) {
    return { outcome: "unknown", evidenceMessageId: null, signals: EMPTY_SIGNALS, confident: false };
  }

  const now = options.now ? new Date(options.now) : new Date();
  const signals: OutcomeSignals = { ...EMPTY_SIGNALS };
  const evidence: Partial<Record<keyof OutcomeSignals, string>> = {};

  for (const message of ordered) {
    const raw = message.text?.trim();
    if (!raw) continue;
    // Apostrof variantlari bir shaklga keltiriladi — aks holda
    // "to'lovni" (U+2018) qoidaga tushmay qolardi.
    const text = normalizeForMatch(raw);
    const speaker = message.direction === "incoming" ? "customer" : "us";

    for (const marker of MARKERS) {
      if (marker.speaker !== "any" && marker.speaker !== speaker) continue;
      if (!marker.pattern.test(text)) continue;
      signals[marker.signal] = true;
      // Birinchi isbot saqlanadi — belgi qachon paydo bo'lganini ko'rsatadi.
      evidence[marker.signal] ??= message.id;
    }
  }

  // Suhbat shakli: biz javob berdik, keyin mijoz yana yozdimi?
  const turns = buildDialogTurns(ordered);
  for (let i = 0; i < turns.length - 1; i += 1) {
    if (turns[i].speaker === "us" && turns[i + 1].speaker === "customer") {
      signals.customerRepliedAfterUs = true;
      break;
    }
  }

  const lastTurn = turns[turns.length - 1];
  const lastAt = new Date(ordered[ordered.length - 1].sentAt).getTime();
  const silentDays = (now.getTime() - lastAt) / (24 * 60 * 60 * 1000);
  signals.silentAfterOurLastMessage = lastTurn.speaker === "us" && silentDays >= SILENCE_DAYS;

  if (signals.completed) {
    return { outcome: "completed", evidenceMessageId: evidence.completed ?? null, signals, confident: true };
  }
  if (signals.paid) {
    return { outcome: "paid", evidenceMessageId: evidence.paid ?? null, signals, confident: true };
  }
  if (signals.paymentRequested) {
    return {
      outcome: "payment_requested",
      evidenceMessageId: evidence.paymentRequested ?? null,
      signals,
      confident: true,
    };
  }
  if (signals.applicationSent) {
    return {
      outcome: "application_sent",
      evidenceMessageId: evidence.applicationSent ?? null,
      signals,
      confident: true,
    };
  }
  if (signals.customerRepliedAfterUs) {
    // Aniq sotuv belgisi yo'q — faqat suhbat davom etgani ma'lum.
    return { outcome: "continued", evidenceMessageId: null, signals, confident: false };
  }
  if (signals.silentAfterOurLastMessage) {
    return { outcome: "dropped", evidenceMessageId: null, signals, confident: false };
  }

  // Suhbat hali yangi va hech qanday belgi yo'q — taxmin qilmaymiz.
  return { outcome: "unknown", evidenceMessageId: null, signals, confident: false };
}
