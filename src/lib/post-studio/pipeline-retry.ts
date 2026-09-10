/**
 * To'xtab qolgan yugurishni O'ZI qayta urinib ko'rish mumkinmi.
 *
 * SOF MODUL — qaror qoidalari testda tekshiriladi, chunki bu yerdagi
 * xato jimgina noto'g'ri nashrga olib keladi.
 *
 * `needs_review` holati "odam qarab chiqsin" degani edi va amalda u
 * O'LIK NUQTA bo'lib qoldi: `findDueIntakes` faqat `pending`/`failed`
 * ni oladi, ya'ni bunday anketa hech qachon o'zi qayta ishlanmasdi va
 * kimdir panelga kirib qo'lda bosishini kutib turardi.
 *
 * Aksariyat to'xtashlar aslida O'TKINCHI (model javob bermadi, render
 * uzildi, Telegram qabul qilmadi) va ularning barchasi idempotent —
 * qayta yugurish mavjud maqolani ham, postni ham takrorlamaydi.
 * Shularni bot o'zi tuzatadi.
 *
 * IKKI to'xtash esa HECH QACHON avtomatik tuzatilmaydi, chunki ular
 * xato emas — ODAM QARORI:
 *
 *   • ismdosh: bu ismli nomzod allaqachon saytda. Avtomatik "tuzatish"
 *     yo tirik maqolani qayta yozardi, yo bir odamni ikki marta chop
 *     etardi. Bu ikki xil odammi yoki bir odam ikki marta anketa
 *     to'ldirganmi — buni faqat odam biladi.
 *   • qora ro'yxat: shartnoma buzilgan. Buni "tuzatib" nashr qilish
 *     qarorning o'zini bekor qilish bo'lardi.
 */

import { splitPipelineError, type PipelineStage } from "./pipeline-stages.ts";

/**
 * Bot o'zi qayta uradigan bosqichlar.
 *
 * OQ RO'YXAT, qora ro'yxat emas: kelajakda yangi bosqich qo'shilsa, u
 * avtomatik ravishda "qayta urinma" bo'lib qoladi va uni bu yerga
 * ataylab qo'shish kerak bo'ladi. Teskarisi bo'lganda yangi bosqich
 * jimgina avtomatik nashrga qo'shilib ketardi.
 *
 * Hammasi IDEMPOTENT: `createPostDraft` nomzod bo'yicha mavjud qoralamani
 * qayta ishlatadi, `deliverPostToSubscribers` allaqachon yuborilgan
 * chatni o'tkazib yuboradi, `render` esa faylni qayta yozadi.
 */
const AUTO_RETRY_STAGES: readonly PipelineStage[] = [
  "ai_improvement",
  // Faktlar bosqichi endi umuman to'xtatmaydi (pastdagi izohga qarang),
  // lekin eski yozuvlar bazada qolgan va ular ham qaytarilishi kerak.
  "fact_validation",
  "publication",
  "post_draft",
  "portrait",
  "render",
  "caption",
  "telegram",
];

/**
 * Bosqichidan qat'i nazar, hech qachon avtomatik qaytarilmaydigan matnlar.
 *
 * Ikkinchi himoya qatlami: agar bu qarorlar kelajakda boshqa bosqich
 * nomi bilan yozila boshlasa, oq ro'yxat ularni o'tkazib yuborishi
 * mumkin edi. Matn esa qaror bilan birga ko'chadi.
 */
const NEVER_AUTO_RETRY_PATTERNS: readonly RegExp[] = [
  /avval chop etilgan/i,
  /qora ro‘yxat|qora ro'yxat/i,
  /shartnoma buzildi/i,
];

export interface RetryDecision {
  retry: boolean;
  /** Xato qaysi bosqichda bo'lgani — xabarda ko'rsatiladi. */
  stage: PipelineStage | null;
  /** Nega qaytarilmagani; `retry` true bo'lganda null. */
  refusal: "human_decision" | "unknown_stage" | "no_error" | null;
}

/**
 * `post_pipeline_error` da turgan satrga qarab qaror qiladi.
 *
 * Satr `fail()` yozgan "<bosqich>: <matn>" shaklida. Bosqichi
 * o'qilmagan satr QAYTARILMAYDI: nima bo'lganini bilmasdan qayta
 * yugurish — ko'r-ko'rona urinish.
 */
export function decideAutoRetry(storedError: string | null | undefined): RetryDecision {
  const raw = (storedError ?? "").trim();
  if (raw === "") return { retry: false, stage: null, refusal: "no_error" };

  const { stage } = splitPipelineError(raw);

  if (NEVER_AUTO_RETRY_PATTERNS.some((pattern) => pattern.test(raw))) {
    return { retry: false, stage, refusal: "human_decision" };
  }

  if (!stage || !AUTO_RETRY_STAGES.includes(stage)) {
    return { retry: false, stage, refusal: "unknown_stage" };
  }

  return { retry: true, stage, refusal: null };
}

export { AUTO_RETRY_STAGES };
