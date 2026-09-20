/**
 * Admin panelning tashqi manzili — SOF MODUL.
 *
 * NEGA ALOHIDA MANTIQ KERAK.
 *
 * Telegram webhook va Mini App manzillari FAQAT HTTPS bo'lishi
 * mumkin. Bu yerda esa aynan shunday bo'ldi: Vercel
 * Production'da `NEXT_PUBLIC_ADMIN_URL` qiymati dev
 * sozlamasidan qolgan `http://localhost:3001` edi va Telegram
 * ikkala so'rovni ham rad etdi.
 *
 * Xato matni tushunarli edi, lekin sabab sozlamada — kodda
 * emas. Shuning uchun kod endi bunday qiymatni QABUL QILMAYDI
 * va o'zi ishonchli manbaga o'tadi: Vercel o'z production
 * domenini `VERCEL_PROJECT_PRODUCTION_URL` da o'zi beradi va
 * uni qo'lda yozish shart emas.
 */

export type OriginRejection = "empty" | "malformed" | "not_https" | "local";

export type OriginCheck =
  | { ok: true; origin: string }
  | { ok: false; reason: OriginRejection };

/** Tashqaridan kirib bo'lmaydigan hostlar. */
function isLocal(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    // Ichki tarmoq manzillari ham Telegram uchun yaroqsiz.
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/**
 * Bitta nomzodni tekshiradi.
 *
 * Protokolsiz qiymat ham qabul qilinadi: Vercel domenni
 * `liderlar-2-0-admin.vercel.app` ko'rinishida, protokolsiz
 * beradi.
 */
export function checkOrigin(raw: string | null | undefined): OriginCheck {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, reason: "empty" };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  /*
   * Lokal manzil HTTPS bo'lsa ham yaramaydi — Telegram unga
   * umuman yeta olmaydi. Shuning uchun bu tekshiruv
   * protokoldan OLDIN.
   */
  if (isLocal(url.hostname)) return { ok: false, reason: "local" };

  /*
   * `http://` ni jimgina `https://` ga aylantirish vasvasa
   * qiladi, lekin bu yolg'on ishonch berardi: sayt HTTPS'da
   * ochilmasa, webhook baribir ishlamaydi va sabab yana
   * yashirin qolardi. Ochiq rad etamiz.
   */
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };

  return { ok: true, origin: url.origin };
}

export interface OriginCandidate {
  /** Environment o'zgaruvchisining NOMI — xabarda ko'rsatish uchun. */
  name: string;
  value: string | null | undefined;
}

export type ResolveResult =
  | { ok: true; origin: string; source: string }
  | { ok: false; problems: { name: string; reason: OriginRejection }[] };

/**
 * Birinchi yaroqli manzilni tanlaydi.
 *
 * Yaroqsizlari JIMGINA TASHLANMAYDI: qaysi o'zgaruvchi nega
 * rad etilgani qaytariladi, chunki aynan shu ma'lumot yetishmay
 * turgan edi — panel "o'rnatilmadi" derdi-yu, sababni
 * ko'rsatmasdi.
 */
export function resolveAdminOrigin(candidates: readonly OriginCandidate[]): ResolveResult {
  const problems: { name: string; reason: OriginRejection }[] = [];

  for (const candidate of candidates) {
    const verdict = checkOrigin(candidate.value);
    if (verdict.ok) return { ok: true, origin: verdict.origin, source: candidate.name };

    // Umuman qo'yilmagan o'zgaruvchi "muammo" emas.
    if (verdict.reason !== "empty") {
      problems.push({ name: candidate.name, reason: verdict.reason });
    }
  }

  return { ok: false, problems };
}

const REASON_TEXT: Readonly<Record<OriginRejection, string>> = {
  empty: "qo'yilmagan",
  malformed: "manzil formati noto'g'ri",
  not_https: "HTTPS emas — Telegram faqat HTTPS qabul qiladi",
  local: "lokal manzil (localhost) — Telegram unga yeta olmaydi",
};

/** Adminga ko'rsatiladigan tushunarli xabar. */
export function describeOriginFailure(problems: readonly { name: string; reason: OriginRejection }[]): string {
  if (problems.length === 0) {
    return (
      "Admin panel manzilini aniqlab bo'lmadi. NEXT_PUBLIC_ADMIN_URL ni " +
      "https:// bilan boshlanadigan haqiqiy domenga qo'ying."
    );
  }

  const list = problems.map((p) => `${p.name} — ${REASON_TEXT[p.reason]}`).join("; ");
  return `Admin panel manzili yaroqsiz: ${list}.`;
}
