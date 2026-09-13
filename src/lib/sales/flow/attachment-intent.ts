/**
 * BIRIKMA NIMA UCHUN YUBORILGAN (master spec 6-band).
 *
 * MUAMMO: webhook har kiruvchi rasm yoki hujjatni SO'ROQSIZ chek
 * deb hisoblardi. `recordPaymentEvidence()` uni saqlab, suhbatga
 * `evidence_received` qo'yardi.
 *
 * Amalda mijoz rasm yuborishining bir nechta sababi bor va ular
 * butunlay boshqa ish talab qiladi:
 *   · PORTRET — maqola uchun surat. Eng ko'p uchraydigani.
 *   · CHEK — to'lov isboti.
 *   · SKRINSHOT — anketa xatosi, texnik muammo.
 *   · HUJJAT — diplom, sertifikat, yutuq tasdig'i.
 *
 * Portretni chek deb belgilash ikki xil zarar keltiradi: to'lov
 * voronkasi yolg'on ko'rsatkich beradi va AI mijozga to'lov
 * tasdiqlanayotgandek javob yozishi mumkin.
 *
 * SHUBHADA — `unknown`. Taxmin qilinmaydi: noto'g'ri "chek" deb
 * belgilash "bilmayman" dan ancha qimmat.
 *
 * SOF MODUL.
 */

import { normalizeForIntent } from "../text-normalize.ts";
import type { SalesStage } from "./stages.ts";

export const ATTACHMENT_KINDS = [
  "payment_evidence",
  "portrait",
  "technical_screenshot",
  "achievement_document",
  "unknown",
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  payment_evidence: "To‘lov cheki",
  portrait: "Portret / surat",
  technical_screenshot: "Texnik skrinshot",
  achievement_document: "Yutuq hujjati",
  unknown: "Noma’lum birikma",
};

/** Chekka ishora qiluvchi so'zlar — caption yoki yondosh matnda. */
const PAYMENT_WORDS: readonly string[] = [
  "chek", "check", "to'ladim", "toladim", "to'lov", "tolov", "pul o'tkazdim",
  "pul otkazdim", "o'tkazdim", "otkazdim", "kvitansiya", "kvitansya",
  "screenshot to'lov", "tashladim", "yubordim pul", "perevod", "oplata",
];

/** Portretga ishora qiluvchi so'zlar. */
const PORTRAIT_WORDS: readonly string[] = [
  "rasm", "rasmim", "surat", "suratim", "foto", "fotim", "portret",
  "3x4", "3×4", "rasmni", "mana rasm", "shu rasm",
];

/** Texnik muammoga ishora. */
const TECHNICAL_WORDS: readonly string[] = [
  "xato", "xatolik", "ishlamayapti", "ishlamadi", "saqlanmayapti",
  "chiqmayapti", "skrinshot", "qabul qilmadi", "error",
];

/** Yutuq hujjatiga ishora. */
const DOCUMENT_WORDS: readonly string[] = [
  "diplom", "sertifikat", "guvohnoma", "yutuq", "tanlov", "gramota",
];

/**
 * TO'LOV KUTILAYOTGAN bosqichlar.
 *
 * Bu kontekst kuchli, lekin O'ZI YETARLI EMAS: to'lov so'ralgandan
 * keyin ham mijoz portret yuborishi mumkin (ko'pincha shunday
 * bo'ladi — ikkalasi bir vaqtda so'raladi).
 */
const PAYMENT_STAGES: readonly SalesStage[] = [
  "payment_requested",
  "waiting_payment",
  "payment_review",
];

export interface AttachmentContext {
  messageType: string;
  /** Rasm bilan kelgan matn yoki shu atrofdagi mijoz xabari. */
  caption: string | null;
  stage: SalesStage;
  /** Suhbatning to'lov holati. */
  paymentStatus: string;
}

export interface AttachmentClassification {
  kind: AttachmentKind;
  /** Nega shunday qaror qilingani — admin ko'radi. */
  reason: string;
  /**
   * To'lov isboti sifatida SAQLANSINMI.
   *
   * `unknown` uchun ham `true` bo'lishi mumkin emas: saqlash
   * suhbatga `evidence_received` qo'yadi va bu holat o'zgarishi.
   */
  treatAsPayment: boolean;
}

/**
 * O'ZBEK TILI QO'SHIMCHALI.
 *
 * "diplom" so'zi matnda "diplomim", "diplomimni", "diplomni" bo'lib
 * keladi. Qat'iy so'z chegarasi ularni o'tkazib yuborardi va
 * mijozning diplomi "noma'lum birikma" bo'lib qolardi.
 *
 * Shuning uchun so'zdan KEYIN cheklangan qo'shimcha ruxsat etiladi.
 * Cheklangan: chegarasiz `\p{L}*` butunlay boshqa so'zlarni ham
 * tutib olardi.
 */
const MAX_SUFFIX = 6;

/**
 * ATAYLAB ISTISNO QILINGANLAR.
 *
 * "rasmiy" — "rasm" bilan boshlanadi, lekin butunlay boshqa ma'no
 * ("rasmiy tashkilotmisiz?"). Uni portret deb o'qish savolni
 * butunlay noto'g'ri tushunish bo'lardi.
 */
const EXCLUDED: readonly string[] = ["rasmiy", "rasmiylashtir", "rasmiylash"];

function contains(haystack: string, words: readonly string[]): string | null {
  for (const excluded of EXCLUDED) {
    const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Istisno so'z uchraganda, uning o'zagi bo'yicha moslik
    // qidirilmaydi: matndan olib tashlaymiz.
    haystack = haystack.replace(new RegExp(escaped + "\\p{L}*", "gu"), " ");
  }

  for (const word of words) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escaped}\\p{L}{0,${MAX_SUFFIX}}(?:[^\\p{L}\\p{N}]|$)`,
      "u",
    );
    if (pattern.test(haystack)) return word;
  }
  return null;
}

export function classifyAttachment(context: AttachmentContext): AttachmentClassification {
  const caption = normalizeForIntent(context.caption ?? "").trim();

  // 1. MATN ENG ISHONCHLI DALIL. Mijoz "chek" desa — chek.
  const paymentWord = contains(caption, PAYMENT_WORDS);
  if (paymentWord) {
    return {
      kind: "payment_evidence",
      reason: `matnda "${paymentWord}"`,
      treatAsPayment: true,
    };
  }

  const portraitWord = contains(caption, PORTRAIT_WORDS);
  if (portraitWord) {
    return { kind: "portrait", reason: `matnda "${portraitWord}"`, treatAsPayment: false };
  }

  const technicalWord = contains(caption, TECHNICAL_WORDS);
  if (technicalWord) {
    return {
      kind: "technical_screenshot",
      reason: `matnda "${technicalWord}"`,
      treatAsPayment: false,
    };
  }

  const documentWord = contains(caption, DOCUMENT_WORDS);
  if (documentWord) {
    return {
      kind: "achievement_document",
      reason: `matnda "${documentWord}"`,
      treatAsPayment: false,
    };
  }

  /*
   * 2. MATN YO'Q — BOSQICHGA QARAYMIZ.
   *
   * To'lov so'ralgan va hali kelmagan bo'lsa, matnsiz rasm katta
   * ehtimol bilan chek. Bu TAXMIN, shuning uchun sabab yoziladi va
   * admin uni ko'radi.
   */
  if (PAYMENT_STAGES.includes(context.stage) && context.paymentStatus !== "paid") {
    return {
      kind: "payment_evidence",
      reason: `to‘lov kutilayotgan bosqich (${context.stage}), matnsiz birikma`,
      treatAsPayment: true,
    };
  }

  /*
   * 3. ANKETA BOSQICHLARIDA matnsiz rasm — portret.
   *
   * Bu yerda to'lov hali so'ralmagan, ya'ni chek bo'lishi mumkin
   * emas.
   */
  if (
    context.stage === "need_full_name" ||
    context.stage === "intake_link_sent" ||
    context.stage === "waiting_intake" ||
    context.stage === "intake_submitted"
  ) {
    return {
      kind: "portrait",
      reason: `anketa bosqichi (${context.stage}), to‘lov hali so‘ralmagan`,
      treatAsPayment: false,
    };
  }

  // 4. SHUBHADA — taxmin qilinmaydi.
  return {
    kind: "unknown",
    reason: "matn yo‘q va bosqich aniqlik bermadi",
    treatAsPayment: false,
  };
}

/**
 * Noma'lum birikma kelganda mijozdan so'raladigan savol.
 *
 * Bitta qisqa savol — jim qolish ham, noto'g'ri taxmin ham yaramaydi.
 */
export const UNKNOWN_ATTACHMENT_QUESTION =
  "Rasmni oldim. Aniqlashtirib olsam: bu to‘lov cheki bo‘ldimi yoki maqola uchun suratmi?";
