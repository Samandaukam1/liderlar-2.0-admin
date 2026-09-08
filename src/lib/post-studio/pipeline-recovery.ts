/**
 * Uzilib qolgan quvur yugurishlarini tiklash.
 *
 * MUAMMO: `claim()` anketani `post_pipeline_status = 'running'` deb
 * belgilaydi, `findDueIntakes` esa faqat `pending` va `failed` ni
 * oladi. Agar funksiya ishlash o'rtasida o'lsa (serverless timeout —
 * bu yerda bir necha OpenAI chaqiruvi, ONNX kesish va render bor),
 * qator ABADIY `running` bo'lib qoladi va uni hech kim qayta olmaydi.
 *
 * Xuddi shu paytda `promoteIntakeToDraft` anketa statusini
 * `ai_reviewing` qilib qo'yadi va uni faqat o'zi qaytaradi. Jarayon
 * o'lsa, admin panelda "AI ko'rmoqda" abadiy osilib qoladi.
 *
 * Ikkalasi birga aynan shu shikoyatni beradi: "to'lov qilindi bosildi,
 * lekin maqola chiqmadi, AI ko'rmoqda bo'lib qotib qolgan".
 *
 * SOF MODUL — qaror qoidalari testda tekshiriladi.
 */

/**
 * Shuncha vaqtdan keyin `running` yugurish o'lgan deb hisoblanadi.
 *
 * Cron funksiyasining chegarasi 300 sekund, shuning uchun 15 daqiqa
 * xavfsiz zaxira: hali ishlab turgan yugurish hech qachon shu chegaraga
 * yetmaydi, o'lgani esa ko'pi bilan 15 daqiqada qaytariladi.
 */
export const PIPELINE_STALE_AFTER_MS = 15 * 60 * 1000;

/** Yugurish o'lganmi. Boshlanish vaqti noma'lum bo'lsa — ha (eski yozuv). */
export function isStaleRun(
  startedAt: string | Date | null | undefined,
  now: Date = new Date(),
  staleAfterMs: number = PIPELINE_STALE_AFTER_MS,
): boolean {
  if (!startedAt) return true;
  const started = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(started.getTime())) return true;
  return now.getTime() - started.getTime() >= staleAfterMs;
}

/**
 * AI bosqichi o'rtasida uzilgan anketa qaysi statusga qaytarilishi kerak.
 *
 * `ai_reviewing` — o'tkinchi holat, uni saqlab qolishning ma'nosi yo'q:
 * AI natijasi baribir yozilmagan. Qaytariladigan joy anketa qay darajaga
 * yetganiga bog'liq:
 *   · tasdiqlangan bo'lsa (`approved_at` bor) — `approved`, ya'ni
 *     promotion qaytadan urinadi;
 *   · aks holda — `submitted`, ya'ni yaxshilash bosqichidan boshlanadi.
 *
 * Boshqa statuslar TEGILMAYDI: `published` yoki `needs_clarification`
 * ni orqaga surish real ma'lumotni yo'qotardi.
 */
export function recoveredIntakeStatus(
  currentStatus: string,
  approvedAt: string | null | undefined,
): string | null {
  if (currentStatus !== "ai_reviewing") return null;
  return approvedAt ? "approved" : "submitted";
}
