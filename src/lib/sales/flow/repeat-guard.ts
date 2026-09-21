/**
 * TAKRORIY JAVOB QALQONI (6-band).
 *
 * AUDITDA (A reproduksiyasi): 20:42–20:44 oralig'ida bitta
 * mazmun — «Havoladagi savollarga javob yozib yuboring» —
 * YETTI MARTA yuborilgan. Mijoz ketma-ket bir necha rasm
 * yuborgan, har biri alohida turn bo'lib ishlangan va har
 * biriga bir xil javob ketgan.
 *
 * Burst birlashtirish bu xatoning ASOSIY sababini yopadi, bu
 * modul esa OXIRGI to'siq: boshqa yo'ldan kelgan takror ham
 * o'tmasin.
 *
 * QAT'IY CHEGARA: havola bo'lgan javob bloklanmaydi. Mijoz
 * havolani qaytadan so'rashi mumkin va uni "takror" deb
 * to'sish KERAKLI javobni yo'qotardi.
 *
 * SOF MODUL.
 */

/** Shu muddat ichida bir xil matn ikkinchi marta ketmaydi. */
export const REPEAT_WINDOW_MS = 10 * 60 * 1000;

export interface RepeatCheckInput {
  body: string;
  /** Shu suhbatda oxirgi vaqtda yuborilgan matnlar. */
  recentBodies: readonly string[];
}

/** Havola bo'lgan javob hech qachon bloklanmaydi. */
function carriesLink(body: string): boolean {
  return /https?:\/\/|t\.me\//i.test(body);
}

/** Taqqoslash uchun: bo'sh joy va registr farqi hisobga olinmaydi. */
function canonical(body: string): string {
  return body.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Bu matn yaqinda allaqachon yuborilganmi.
 *
 * `true` — yubormaslik kerak.
 */
export function isRepeatedReply(input: RepeatCheckInput): boolean {
  const body = input.body.trim();
  if (body === "") return false;
  if (carriesLink(body)) return false;

  /*
   * Juda qisqa javob ("Yaxshi.", "Arzimaydi 😊") takror
   * bo'lishi TABIIY — suhbatda ular ko'p marta kerak bo'ladi.
   * Ularni to'sish botni qo'pol qilardi.
   */
  if (body.length < 25) return false;

  const target = canonical(body);
  return input.recentBodies.some((previous) => canonical(previous) === target);
}
