/**
 * BILIMNING AMAL QILISH MUDDATI VA ZIDDIYATI — SOF MODUL.
 *
 * AUDIT TOPILMASI (D-band): `status = 'approved'` "bu gap har doim
 * to'g'ri" degani edi. Tasdiqlangan bilim ichida esa quyidagi
 * BIR MARTALIK gaplar bor:
 *
 *   · "chegirma faqat bugun"          — o'sha kunga tegishli edi;
 *   · "maqola yarim soatda chiqadi"   — o'sha navbatga tegishli edi;
 *   · "sertifikatni birozdan so'ng"   — bitta mijozga berilgan va'da.
 *
 * Bularning hammasi bugun aytilsa YOLG'ON bo'ladi. Shuning uchun
 * bilimning TURI kiritiladi va turiga qarab amal qilish tekshiriladi.
 *
 * SOF: bazaga bormaydi, vaqtni o'zi olmaydi (`now` argument bilan
 * keladi) — shuning uchun test deterministik.
 */

import { normalizeForMatch } from "./text-normalize.ts";

/** Bilim qanday da'vo ekani. */
export const FACT_KINDS = [
  "unclassified",
  "permanent_fact",
  "temporary_offer",
  "customer_specific_offer",
  "task_promise",
  "historical_example",
  "style_example",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_KIND_LABELS: Record<FactKind, string> = {
  unclassified: "Tasniflanmagan",
  permanent_fact: "Doimiy fakt",
  temporary_offer: "Muddatli taklif",
  customer_specific_offer: "Shaxsiy taklif",
  task_promise: "Bajariladigan va’da",
  historical_example: "Tarixiy misol",
  style_example: "Uslub namunasi",
};

/**
 * FAKT sifatida ishlatilishi MUMKIN bo'lgan turlar.
 *
 * Tarixiy misol va uslub namunasi bu ro'yxatda YO'Q: ular
 * "sotuvchi bir paytlar shunday degan" degani, "bu hozir
 * to'g'ri" degani emas.
 */
const FACTUAL_KINDS: readonly FactKind[] = [
  "permanent_fact",
  "temporary_offer",
  "customer_specific_offer",
];

export type ConflictStatus = "none" | "suspected" | "conflicted" | "resolved";

export interface KnowledgeValidity {
  factKind: FactKind;
  validFrom: string | null;
  validUntil: string | null;
  neverExpires: boolean;
  scope: "all" | "conversation" | "campaign" | "region";
  scopeRef: string | null;
  conflictStatus: ConflictStatus;
  supersededAt: string | null;
}

/** Nega bilim javobga kiritilmadi — adminda aynan shu matn ko'rinadi. */
export type ExclusionReason =
  | "not_approved"
  | "superseded"
  | "conflicted"
  | "expired"
  | "not_yet_valid"
  | "undated_temporary_offer"
  | "task_promise"
  | "historical_example"
  | "other_scope"
  | "unclassified";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  not_approved: "tasdiqlanmagan",
  superseded: "yangi versiya bilan almashtirilgan",
  conflicted: "ziddiyatli — odam hal qilishi kerak",
  expired: "muddati tugagan",
  not_yet_valid: "hali boshlanmagan",
  undated_temporary_offer: "muddatli taklif, lekin tugash sanasi yo‘q",
  task_promise: "bajariladigan va’da — umumiy fakt emas",
  historical_example: "tarixiy misol — joriy haqiqat emas",
  other_scope: "boshqa mijoz/kampaniyaga tegishli",
  unclassified: "turi tasniflanmagan",
};

export interface ValidityContext {
  now: Date;
  /** Joriy suhbat — `scope = 'conversation'` yozuvlari uchun. */
  conversationId?: string | null;
}

export interface ValidityVerdict {
  usableAsFact: boolean;
  reason: ExclusionReason | null;
}

/**
 * Bu bilim MIJOZGA AYTILADIGAN FAKT bo'la oladimi.
 *
 * Tartib muhim: eng qat'iy sabab birinchi tekshiriladi, chunki
 * adminda BITTA sabab ko'rsatiladi va u eng muhimi bo'lishi kerak.
 */
export function evaluateValidity(
  input: KnowledgeValidity & { status: string },
  context: ValidityContext,
): ValidityVerdict {
  const deny = (reason: ExclusionReason): ValidityVerdict => ({ usableAsFact: false, reason });

  if (input.status !== "approved") return deny("not_approved");
  if (input.supersededAt) return deny("superseded");

  // ZIDDIYAT — eng xavflisi. Ikki qarama-qarshi tasdiqlangan javobdan
  // tasodifan bittasi tanlansa, mijoz bugun "mumkin", ertaga "mumkin
  // emas" deb eshitadi. Shuning uchun ikkalasi ham chiqarib tashlanadi.
  if (input.conflictStatus === "conflicted") return deny("conflicted");

  if (input.factKind === "unclassified") return deny("unclassified");
  if (input.factKind === "historical_example") return deny("historical_example");
  if (input.factKind === "style_example") return deny("historical_example");
  // Va'da — bitta mijozga, bitta ish. Umumiy javobga aylanmaydi.
  if (input.factKind === "task_promise") return deny("task_promise");

  if (!FACTUAL_KINDS.includes(input.factKind)) return deny("unclassified");

  // Shaxsiy taklif faqat O'SHA suhbatda amal qiladi.
  if (input.scope === "conversation") {
    if (!context.conversationId || input.scopeRef !== context.conversationId) {
      return deny("other_scope");
    }
  }

  const now = context.now.getTime();

  if (input.validFrom) {
    const from = Date.parse(input.validFrom);
    if (Number.isFinite(from) && now < from) return deny("not_yet_valid");
  }

  if (input.validUntil) {
    const until = Date.parse(input.validUntil);
    if (Number.isFinite(until) && now > until) return deny("expired");
  }

  /*
   * MUDDATLI TAKLIF, LEKIN TUGASH SANASI YO'Q.
   *
   * Aynan shu holat "chegirma faqat bugun" ni bir yil davomida
   * aytdirgan. Muddatli taklif MUDDATSIZ bo'la olmaydi: sanasi
   * yo'q bo'lsa, u fakt emas.
   */
  if (
    (input.factKind === "temporary_offer" || input.factKind === "customer_specific_offer") &&
    !input.validUntil &&
    !input.neverExpires
  ) {
    return deny("undated_temporary_offer");
  }

  return { usableAsFact: true, reason: null };
}

/* ------------------------- muddat da'vosini topish ---------------------- */

/**
 * Matnda MUDDAT DA'VOSI bormi ("faqat bugun", "ertaga tugaydi").
 *
 * Kerak ikki joyda: qazishda bilimni `temporary_offer` deb belgilash
 * va javob tekshiruvida tasdiqlanmagan muddatni bloklash uchun.
 */
/*
 * NAQSHLAR NORMALLASHTIRILGAN matnga qo'llanadi, shuning uchun
 * apostrof faqat ASCII `'` shaklida yoziladi.
 */
const DEADLINE_PATTERNS: readonly RegExp[] = [
  /\bfaqat\s+bugun\b/i,
  /\bbugun\s+(tugaydi|yakunlanadi|oxirgi)\b/i,
  /\bertaga\s+(tugaydi|yakunlanadi|\d)/i,
  /\bshoshiling\b/i,
  /\boxirgi\s+(kun|imkoniyat|joy)\b/i,
  /\bmuddat\s+tugaydi\b/i,
  /\bbir\s+kun\s+davomida\b/i,
  /\bchegirma\s+(tugaydi|amal qiladi)\b/i,
  /\bhozir\s+ro'?yxatdan\s+o'?tsangiz\b/i,
];

export function containsDeadlineClaim(text: string | null | undefined): boolean {
  if (!text) return false;
  // APOSTROF OLDIN NORMALLASHTIRILADI. O'zbek matnida "so'ng"
  // yettita har xil belgi bilan yozilishi mumkin; qo'lda yozilgan
  // belgilar sinfi ulardan birini o'tkazib yuborgan edi va test
  // shuni tutdi. `text-normalize.ts` bu ishni bir joyda qiladi.
  return DEADLINE_PATTERNS.some((pattern) => pattern.test(normalizeForMatch(text)));
}

/**
 * Matnda BAJARILADIGAN VA'DA bormi ("birozdan so'ng yuboraman").
 *
 * Bunday gap bilim emas — u kimningdir vazifasi. Bilim bazasiga
 * tushsa, bot uni hamma mijozga takrorlaydi va hech kim bajarmaydi.
 */
const PROMISE_PATTERNS: readonly RegExp[] = [
  /\bbirozdan\s+so'?ng\b/i,
  /\bhozir\s+(yuboraman|qilaman|jo'?nataman|tayyorlayman)\b/i,
  /\byuborib\s+qo'?yaman\b/i,
  /\btayyorlab\s+beraman\b/i,
  /\bko'?rib\s+chiqaman\b/i,
  /\beslatib\s+qo'?yaman\b/i,
  /\bbugun\s+(yuboraman|qilaman)\b/i,
];

export function containsTaskPromise(text: string | null | undefined): boolean {
  if (!text) return false;
  return PROMISE_PATTERNS.some((pattern) => pattern.test(normalizeForMatch(text)));
}

/**
 * Matn mazmuniga qarab bilim turini TAXMIN qiladi.
 *
 * Bu faqat TAKLIF: natija `draft` bo'lib adminga chiqadi va odam
 * tasdiqlaydi. Avtomatik `permanent_fact` HECH QACHON qo'yilmaydi —
 * aks holda eski xato yangi nom bilan qaytardi.
 */
export function suggestFactKind(text: string | null | undefined): FactKind {
  if (containsTaskPromise(text)) return "task_promise";
  if (containsDeadlineClaim(text)) return "temporary_offer";
  return "unclassified";
}
