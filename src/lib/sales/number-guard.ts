/**
 * SEMANTIK RAQAM TO'SIG'I — SOF MODUL.
 *
 * AUDIT TOPILMASI (E-band): `findUnsupportedNumbers()` bir xonali
 * sonlarni UMUMAN tekshirmasdi:
 *
 *     if (digits.length <= 1) continue;
 *
 * Izohda "bitta xonali son fakt da'vosi emas" deyilgan. Bu noto'g'ri:
 * "maqola 2 kunda chiqadi" — aynan FAKT DA'VOSI va u eng ko'p
 * uchraydigan tasdiqlanmagan va'dalardan biri. "5% chegirma",
 * "3 kun ichida", "7 ta maqola" ham shunday.
 *
 * TO'G'RI FARQ SONDA EMAS, MA'NODA:
 *
 *   FAKT DA'VOSI     — sondan keyin BIRLIK keladi (kun, %, so'm, ta).
 *   FAKT DA'VOSI EMAS — ro'yxat raqami, vaqt, "bitta savol".
 *
 * Shuning uchun bu yerda son BIRLIGI bilan birga ko'riladi.
 */

/** Sonni FAKT DA'VOSIGA aylantiradigan birliklar. */
export const FACT_UNITS = [
  "narx",
  "muddat",
  "foiz",
  "son",
] as const;
export type FactUnit = (typeof FACT_UNITS)[number];

export const FACT_UNIT_LABELS: Record<FactUnit, string> = {
  narx: "summa",
  muddat: "muddat",
  foiz: "foiz",
  son: "miqdor",
};

interface UnitRule {
  unit: FactUnit;
  /** Sondan KEYIN keladigan birlik. */
  pattern: RegExp;
}

/**
 * Birliklar. Naqsh sondan keyingi matnga qo'llanadi.
 *
 * `so'm` apostrof variantlari bilan — o'zbek matnida ular yetti
 * xil belgi bo'lishi mumkin (`text-normalize.ts` izohiga qarang).
 */
const UNIT_RULES: readonly UnitRule[] = [
  { unit: "narx", pattern: /^\s*(so['’ʻ`´]?m|ming|million|mln|usd|\$|dollar)\b/i },
  {
    unit: "muddat",
    pattern: /^\s*(kun|kunda|kunlik|kundan|hafta|haftada|oy|oyda|oylik|yil|yilda|yillik|soat|soatda|daqiqa|minut)\b/i,
  },
  /*
   * `%` dan keyin `\b` ISHLAMAYDI: `%` so'z belgisi emas va undan
   * keyin bo'shliq kelsa chegara hosil bo'lmaydi. Shu sabab "5%"
   * umuman fakt da'vosi deb sanalmasdi — testda tutildi.
   */
  { unit: "foiz", pattern: /^\s*(?:%|(?:foiz|protsent)\b)/i },
  { unit: "son", pattern: /^\s*(ta|marta|dona|nafar|kishi|maqola|sertifikat)\b/i },
];

export interface NumericClaim {
  /** Matndagi asl yozilishi ("2", "500 000"). */
  raw: string;
  /** Faqat raqamlar — taqqoslash kaliti. */
  digits: string;
  unit: FactUnit;
  /** Son va birlik birga ("2 kun"). */
  phrase: string;
  index: number;
}

const NUMBER_RE = /\d[\d\s.,]*\d|\d+/g;

/** Satr boshida turgan va nuqta/qavs bilan tugagan raqam — ro'yxat belgisi. */
function isListMarker(text: string, index: number, raw: string): boolean {
  const before = text.slice(0, index);
  const atLineStart = before === "" || /[\n\r]\s*$/.test(before);
  const after = text.slice(index + raw.length);
  return atLineStart && /^[.)]\s/.test(after);
}

/** Vaqt ("14:30") va sana ("12.09.2026") fakt da'vosi emas. */
function isClockOrDate(text: string, index: number, raw: string): boolean {
  const after = text.slice(index + raw.length);
  const before = text.slice(Math.max(0, index - 1), index);
  return /^[:.]\d/.test(after) || /[:.]$/.test(before);
}

/**
 * Matndagi BARCHA raqamli fakt da'volarini topadi.
 *
 * Faqat BIRLIGI BOR sonlar qaytariladi. "Bitta savol bering"
 * yoki "1) birinchi" bu ro'yxatga TUSHMAYDI — ular fakt
 * da'vosi emas va ularni bloklash javoblarni asossiz to'sardi.
 */
export function extractNumericClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = [];

  for (const match of text.matchAll(NUMBER_RE)) {
    const raw = match[0].trim();
    const index = match.index ?? 0;
    const digits = raw.replace(/\D+/g, "");
    if (digits.length === 0) continue;
    if (isListMarker(text, index, raw)) continue;
    if (isClockOrDate(text, index, raw)) continue;

    const after = text.slice(index + match[0].length);
    const rule = UNIT_RULES.find((entry) => entry.pattern.test(after));
    if (!rule) continue;

    const unitMatch = after.match(rule.pattern);
    claims.push({
      raw,
      digits,
      unit: rule.unit,
      phrase: `${raw}${unitMatch ? unitMatch[0] : ""}`.trim(),
      index,
    });
  }

  return claims;
}

/**
 * Yil ko'rinishidagi qiymat — "2026 yil" fakt da'vosi, lekin
 * uni bloklash ma'nosiz: joriy yil har doim to'g'ri.
 */
function isPlausibleYear(digits: string): boolean {
  if (digits.length !== 4) return false;
  const value = Number(digits);
  return value >= 2000 && value <= 2100;
}

export interface UnsupportedNumber {
  phrase: string;
  unit: FactUnit;
  raw: string;
}

/**
 * Javobdagi TASDIQLANMAGAN raqamli da'volarni topadi.
 *
 * `allowedTexts` — tasdiqlangan bilim, tijoriy sozlama va real
 * tranzaksiya holati matnlari. Javobdagi har bir sonli da'vo
 * SHULARNING BIRIDA uchrashi shart.
 *
 * MUHIM: manba matnlari TO'PLAM sifatida yig'iladi, bitta satrga
 * birlashtirilmaydi. Birlashtirilsa "5000" qiymati "500000"
 * ichidan topilib, o'ylab topilgan son tasdiqlangan ko'rinardi.
 */
export function findUnsupportedNumericClaims(
  reply: string,
  allowedTexts: readonly string[],
): UnsupportedNumber[] {
  const allowed = new Set(
    allowedTexts.flatMap((text) =>
      [...text.matchAll(NUMBER_RE)].map((match) => match[0].replace(/\D+/g, "")),
    ),
  );

  const found = new Map<string, UnsupportedNumber>();
  for (const claim of extractNumericClaims(reply)) {
    if (isPlausibleYear(claim.digits)) continue;
    if (allowed.has(claim.digits)) continue;
    found.set(claim.phrase, { phrase: claim.phrase, unit: claim.unit, raw: claim.raw });
  }

  return [...found.values()];
}

/** Odam o'qiydigan sabab — adminda va diagnostikada ko'rinadi. */
export function describeUnsupported(items: readonly UnsupportedNumber[]): string {
  if (items.length === 0) return "";
  return items
    .map((item) => `“${item.phrase}” (${FACT_UNIT_LABELS[item.unit]}) tasdiqlangan manbada yo‘q`)
    .join("; ");
}
