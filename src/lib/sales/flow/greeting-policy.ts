/**
 * SALOMLASHISH SIYOSATI — SOF MODUL.
 *
 * AUDIT TOPILMASI: uslub profili "salomlashish ulushi 42%" deb
 * hisoblagan va prompt modelga HAR JAVOBDA salomlashishni
 * buyurgan. Bot jurnalidagi ketma-ket besh javobning hammasi
 * salom bilan boshlangan.
 *
 * Sabab ikki qatlamli:
 *   · `hi` substring bo'lib "yaxshi" ichidan topilardi (tuzatilgan);
 *   · ulush yuqori bo'lsa BAJARILISHI SHART ko'rsatma chiqardi.
 *
 * Ikkinchisi hali ochiq edi: profil to'g'ri bo'lsa ham, uzluksiz
 * suhbatda har javobda "Assalomu alaykum" deyish g'alati.
 *
 * QOIDA: salomlashish SUHBAT HOLATI, uslub emas. Uslub faqat
 * QANDAY salomlashishni aytadi, QACHONini emas.
 */

export interface GreetingState {
  /** Joriy sessiyada salomlashilganmi. */
  greetedAt: string | null;
  /** Sessiya qachon boshlangan. */
  sessionStartedAt: string | null;
  /** Mijozning oxirgi xabari — tanaffusni hisoblash uchun. */
  lastCustomerMessageAt: string | null;
}

export interface GreetingDecision {
  shouldGreet: boolean;
  /** Sessiya yangilanganmi (uzoq tanaffusdan keyin). */
  sessionReset: boolean;
  reason: string;
}

/**
 * Shuncha vaqt jimlikdan keyin suhbat YANGI sessiya deb qaraladi.
 *
 * 12 soat ataylab: bir ish kuni ichidagi tanaffus (tushlik,
 * majlis) sessiyani uzmaydi, ertasi kuni yozilgan xabar esa
 * yangi suhbat sifatida salom bilan boshlanadi. Bu son
 * o'lchangan optimal emas — u ASOSLANGAN TANLOV va sozlama
 * sifatida o'zgartirilishi mumkin.
 */
export const SESSION_GAP_HOURS = 12;

export function decideGreeting(
  state: GreetingState,
  now: Date = new Date(),
): GreetingDecision {
  // Hech qachon salomlashilmagan — birinchi murojaat.
  if (!state.greetedAt) {
    return {
      shouldGreet: true,
      sessionReset: false,
      reason: "birinchi murojaat — hali salomlashilmagan",
    };
  }

  const greetedMs = Date.parse(state.greetedAt);
  if (!Number.isFinite(greetedMs)) {
    return { shouldGreet: true, sessionReset: false, reason: "salomlashish vaqti noma’lum" };
  }

  const gapHours = (now.getTime() - greetedMs) / (60 * 60 * 1000);
  if (gapHours >= SESSION_GAP_HOURS) {
    return {
      shouldGreet: true,
      sessionReset: true,
      reason: `oxirgi salomlashishdan ${Math.round(gapHours)} soat o‘tdi — yangi sessiya`,
    };
  }

  return {
    shouldGreet: false,
    sessionReset: false,
    reason: "suhbat davom etyapti — qayta salomlashilmaydi",
  };
}

/**
 * Model uchun ko'rsatma satri.
 *
 * MAJBURIY SALOMLASHISH FAQAT `shouldGreet` bo'lganda chiqadi.
 * Aks holda ochiq TAQIQ yoziladi — model uslub namunalarida
 * salom ko'rib, o'zidan qo'shib yubormasligi uchun.
 */
export function greetingInstruction(
  decision: GreetingDecision,
  preferredGreeting: string | null,
): string {
  if (!decision.shouldGreet) {
    return "Bu suhbat DAVOM ETYAPTI — qayta salomlashma. To‘g‘ridan-to‘g‘ri savolga javob ber.";
  }
  const sample = preferredGreeting?.trim();
  return sample
    ? `Suhbat boshlanyapti — bir marta salomlash, masalan: “${sample}”.`
    : "Suhbat boshlanyapti — qisqa o‘zbekcha salom bilan boshla.";
}

/**
 * Javobda salomlashish bormi.
 *
 * Faqat BOSHIDA qidiriladi: matn o'rtasidagi "salom" (masalan
 * "salom yo'lladi") salomlashish emas.
 */
const GREETING_HEAD_PATTERNS: readonly RegExp[] = [
  /^\s*assalomu\s+alaykum/i,
  /^\s*va\s*alaykum/i,
  /^\s*salom\b/i,
  /^\s*xayrli\s+(tong|kun|kech)/i,
  /^\s*hayrli\s+(tong|kun|kech)/i,
];

export function startsWithGreeting(text: string | null | undefined): boolean {
  if (!text) return false;
  return GREETING_HEAD_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Javobdan ortiqcha salomlashishni olib tashlaydi.
 *
 * OXIRGI TO'SIQ: model ko'rsatmaga qaramay salomlashsa,
 * javob mijozga shundayligicha ketmaydi. Faqat BIRINCHI
 * satr/gap kesiladi, qolgan mazmun saqlanadi.
 */
export function stripGreeting(text: string): string {
  let result = text;
  for (const pattern of GREETING_HEAD_PATTERNS) {
    const match = result.match(pattern);
    if (!match) continue;
    const rest = result.slice(match[0].length);
    // Salomdan keyingi tinish belgisi va bo'shliqni ham olib tashlaymiz.
    result = rest.replace(/^[\s,!.।–—-]+/, "");
    break;
  }
  return result.trim() === "" ? text.trim() : result.trim();
}
