/**
 * TIJORIY FAKTLAR — SOF MODUL (20-band).
 *
 * MUAMMO: narx shablonlarda, bilim bazasida va kodda alohida-alohida
 * yozilgan edi. Narx o'zgarganda ularning hammasini topib tuzatish
 * kerak bo'lardi va bittasi qolib ketishi muqarrar — o'shanda bot bir
 * mijozga 38 ming, boshqasiga 100 ming deb aytardi. Bunday xato
 * darhol ko'rinmaydi va ishonchni asta yemiradi.
 *
 * ENDI bitta joy: `sales_settings.commercial`. Model faqat shu yerdan
 * kelgan qiymatni ko'radi.
 *
 * QIYMAT YO'Q BO'LSA — TAXMIN QILINMAYDI. Eski narxni yodda saqlab
 * aytish mijozga yolg'on aytish bilan barobar.
 *
 * SOF: bazaga borish `commercial.ts` da, shunda qoidalar testda
 * tekshiriladi.
 */

export interface CommercialFacts {
  /** Chegirmasiz narx, so'mda. */
  regularPrice: number | null;
  /** Hozir amal qilayotgan narx, so'mda. */
  activePrice: number | null;
  discountEnabled: boolean;
  /** Chegirma tugash payti. NULL — muddat TASDIQLANMAGAN. */
  offerExpiresAt: string | null;
  /** Karta raqami va egasi — to'lov shablonidan. */
  paymentDetails: string | null;
  /** Xizmat muddati, masalan "1 yil". */
  servicePeriod: string | null;

  /* ---- 2-faza: tuzilmali tijoriy shartlar (11-band) ---- */
  currency: string | null;
  billingPeriod: string | null;
  discountStart: string | null;
  /**
   * Bo'lib to'lash MUMKINMI.
   *
   * `null` ATAYLAB uchinchi holat: "ha" va "yo'q" dan tashqari
   * "TASDIQLANMAGAN" ham bor. Auditda aynan shu savolda ziddiyat
   * topilgan — bilim bazasida "mumkin", chatda "mumkin emas".
   * `null` bo'lsa bot javob to'qimaydi, aniqlashtirishni aytadi.
   */
  installmentAvailable: boolean | null;
  installmentTerms: string | null;
  additionalFeePolicy: string | null;
}

export const EMPTY_COMMERCIAL: CommercialFacts = {
  regularPrice: null,
  activePrice: null,
  discountEnabled: false,
  offerExpiresAt: null,
  paymentDetails: null,
  servicePeriod: null,
  currency: null,
  billingPeriod: null,
  discountStart: null,
  installmentAvailable: null,
  installmentTerms: null,
  additionalFeePolicy: null,
};

function money(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? Math.round(n) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

export function parseCommercial(value: unknown): CommercialFacts {
  if (!value || typeof value !== "object") return EMPTY_COMMERCIAL;
  const raw = value as Record<string, unknown>;
  return {
    regularPrice: money(raw.regularPrice),
    activePrice: money(raw.activePrice),
    discountEnabled: raw.discountEnabled === true,
    offerExpiresAt: isoDate(raw.offerExpiresAt),
    paymentDetails: text(raw.paymentDetails),
    servicePeriod: text(raw.servicePeriod),
    currency: text(raw.currency),
    billingPeriod: text(raw.billingPeriod) ?? text(raw.servicePeriod),
    discountStart: isoDate(raw.discountStart),
    // Faqat ANIQ boolean qabul qilinadi; yo'q qiymat `null` bo'lib
    // qoladi va "noma'lum" ma'nosini saqlaydi.
    installmentAvailable: typeof raw.installmentAvailable === "boolean" ? raw.installmentAvailable : null,
    installmentTerms: text(raw.installmentTerms),
    additionalFeePolicy: text(raw.additionalFeePolicy),
  };
}

/**
 * Model uchun tijoriy faktlar bloki.
 *
 * Har qiymat alohida tekshiriladi: biri yo'q bo'lsa, qolganlari
 * baribir beriladi. "Hammasi yoki hech narsa" yondashuvi bitta
 * to'ldirilmagan maydon tufayli butun narx bilimini yo'q qilardi.
 */
export function buildCommercialBlock(facts: CommercialFacts, now: Date = new Date()): string {
  const lines: string[] = ["=== TASDIQLANGAN TIJORIY MA'LUMOT ==="];
  let any = false;

  if (facts.activePrice != null) {
    lines.push(`Hozirgi narx: ${formatSom(facts.activePrice)}`);
    any = true;
  }
  if (facts.regularPrice != null && facts.regularPrice !== facts.activePrice) {
    lines.push(`Chegirmasiz narx: ${formatSom(facts.regularPrice)}`);
    any = true;
  }
  if (facts.servicePeriod) {
    lines.push(`Xizmat muddati: ${facts.servicePeriod}`);
    any = true;
  }

  /*
   * MUDDAT — ENG NOZIK JOY (13-band).
   *
   * Muddat tasdiqlanmagan bo'lsa, modelga "chegirma bor" deyish ham
   * xavfli: u o'zidan "bugun tugaydi" deb qo'shib yuborishi mumkin.
   * Shuning uchun muddat yo'qligi OCHIQ aytiladi.
   */
  if (facts.discountEnabled) {
    if (facts.offerExpiresAt) {
      const expires = new Date(facts.offerExpiresAt);
      if (expires.getTime() > now.getTime()) {
        lines.push(`Chegirma amal qiladi, tugash payti: ${formatTashkent(expires)}`);
      } else {
        lines.push("Chegirma muddati TUGAGAN — hozirgi narx sifatida aytma.");
      }
    } else {
      lines.push(
        "Chegirma amal qiladi, lekin TUGASH MUDDATI TASDIQLANMAGAN — " +
          "“bugun tugaydi” yoki boshqa muddatni AYTMA.",
      );
    }
    any = true;
  }

  /*
   * BO'LIB TO'LASH — UCH HOLAT (10 va 11-band).
   *
   * Auditda shu savolda ziddiyat topilgan: tasdiqlangan bilimda
   * "chegirmasiz narxda mumkin", yaqindagi chatda oddiy "yo'q".
   * Sozlamada qiymat bo'lmasa, bot IKKALASINI ham aytmaydi.
   */
  if (facts.installmentAvailable === true) {
    lines.push(
      `Bo‘lib to‘lash: MUMKIN${facts.installmentTerms ? ` — ${facts.installmentTerms}` : ""}`,
    );
    any = true;
  } else if (facts.installmentAvailable === false) {
    lines.push("Bo‘lib to‘lash: mumkin emas.");
    any = true;
  } else {
    lines.push(
      "Bo‘lib to‘lash sharti TASDIQLANMAGAN — “mumkin” ham, “mumkin emas” ham DEMA; " +
        "aniqlab beraman deb javob ber.",
    );
  }

  if (facts.additionalFeePolicy) {
    lines.push(`Qo‘shimcha to‘lov: ${facts.additionalFeePolicy}`);
    any = true;
  }

  if (facts.paymentDetails) {
    lines.push(`To‘lov ma’lumoti: ${facts.paymentDetails}`);
    any = true;
  }

  if (!any) {
    return [
      "=== TIJORIY MA'LUMOT ===",
      "Narx va to‘lov ma’lumoti TASDIQLANMAGAN. Narxni AYTMA —",
      "“aniqlab, xabar beraman” deb javob ber.",
    ].join("\n");
  }

  return lines.join("\n");
}

/** "38 000 so'm" — o'zbekcha raqam yozuvi bilan. */
export function formatSom(amount: number): string {
  return `${amount.toLocaleString("ru-RU").replace(/ /g, " ")} so‘m`;
}

function formatTashkent(date: Date): string {
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
