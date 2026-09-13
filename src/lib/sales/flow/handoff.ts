/**
 * ODAMGA O'TKAZISH (13-band).
 *
 * AI qachon to'xtashini BILISHI kerak. Ba'zi vaziyatlarda eng
 * yaxshi avtomatik javob ham noto'g'ri: shikoyat, pul qaytarish
 * talabi, huquqiy savol, OAV so'rovi. Bu yerda "urinib ko'rish"
 * zarar keltiradi.
 *
 * O'TKAZISH IKKI NARSANI QILADI:
 *   1. `ai_enabled = false` — AI shu suhbatda jim bo'ladi;
 *   2. XULOSA tayyorlaydi — odam nolga qaytmasligi uchun.
 *
 * SOF MODUL.
 */

import { normalizeForIntent } from "../text-normalize.ts";
import { OBJECTION_LABELS, type ObjectionKind } from "./objections.ts";
import { SALES_STAGE_LABELS, type SalesStage } from "./stages.ts";
import { LEAD_TEMPERATURE_LABELS, type LeadTemperature } from "./lead-score.ts";

export const HANDOFF_TRIGGERS = [
  "explicit_request",
  "complaint",
  "refund_dispute",
  "payment_mismatch",
  "legal",
  "privacy_review",
  "repeated_misunderstanding",
  "hot_lead",
  "partnership",
  "media_or_government",
  "technical_failure",
  "unsafe",
] as const;
export type HandoffTrigger = (typeof HANDOFF_TRIGGERS)[number];

export const HANDOFF_TRIGGER_LABELS: Record<HandoffTrigger, string> = {
  explicit_request: "Mijoz odam bilan gaplashishni so‘radi",
  complaint: "Shikoyat",
  refund_dispute: "Pulni qaytarish / to‘lov bahsi",
  payment_mismatch: "To‘lov summasi mos kelmadi",
  legal: "Huquqiy masala",
  privacy_review: "Shaxsiy ma’lumot bo‘yicha ko‘rib chiqish",
  repeated_misunderstanding: "AI takroran tushunmadi",
  hot_lead: "Qizigan mijoz — odam yopgani yaxshiroq",
  partnership: "Hamkorlik taklifi",
  media_or_government: "OAV yoki davlat tashkiloti murojaati",
  technical_failure: "Texnik nosozlik",
  unsafe: "Xavfli vaziyat",
};

interface TriggerRule {
  trigger: HandoffTrigger;
  phrases: readonly string[];
}

const RULES: readonly TriggerRule[] = [
  {
    trigger: "explicit_request",
    phrases: [
      "odam bilan", "operator", "menejer", "rahbar", "mas'ul", "masul",
      "jonli odam", "inson bilan", "человеком", "оператор",
    ],
  },
  {
    trigger: "refund_dispute",
    phrases: [
      "pulimni qaytaring", "pul qaytarish", "qaytarib bering", "vozvrat",
      "to'lovni qaytar", "tolovni qaytar", "верните",
    ],
  },
  {
    trigger: "complaint",
    phrases: [
      "shikoyat", "norozi", "aldadingiz", "aldadilar", "yomon xizmat",
      "jalob", "жалоба", "prokuratura", "sud",
    ],
  },
  {
    trigger: "legal",
    phrases: ["sudga beraman", "advokat", "yurist", "qonun buzil", "shartnoma bo'yicha", "суд"],
  },
  {
    trigger: "payment_mismatch",
    phrases: ["boshqa summa", "kam o'tdi", "ko'p o'tdi", "noto'g'ri summa", "pul yechildi"],
  },
  {
    trigger: "privacy_review",
    phrases: ["ma'lumotimni o'chiring", "malumotimni ochiring", "maqolamni o'chiring", "olib tashlang"],
  },
  {
    trigger: "partnership",
    phrases: ["hamkorlik", "sherik", "investitsiya", "reklama joylash", "partner"],
  },
  {
    trigger: "media_or_government",
    phrases: [
      "telekanal", "gazeta", "jurnalist", "vazirlik", "hokimiyat",
      "davlat idorasi", "matbuot",
    ],
  },
];

export interface HandoffDetection {
  trigger: HandoffTrigger;
  matched: string;
}

function contains(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "u").test(haystack);
}

/** Matndan o'tkazish sababini qidiradi. Topilmasa null. */
export function detectHandoff(text: string | null | undefined): HandoffDetection | null {
  const normalized = normalizeForIntent(text ?? "").trim();
  if (normalized === "") return null;

  for (const rule of RULES) {
    for (const phrase of rule.phrases) {
      if (contains(normalized, phrase)) return { trigger: rule.trigger, matched: phrase };
    }
  }
  return null;
}

/* ------------------------------- XULOSA ---------------------------------- */

export interface HandoffSummaryInput {
  customerName: string | null;
  region: string | null;
  stage: SalesStage;
  temperature: LeadTemperature;
  objections: readonly string[];
  /** AI allaqachon tushuntirgan mavzular. */
  explained: readonly string[];
  lastCustomerQuestion: string | null;
  trigger: HandoffTrigger;
  paymentStatus: string;
  intakeSubmitted: boolean;
}

/**
 * Odam nolga qaytmasligi uchun xulosa.
 *
 * Bu matn koordinator o'qiydigan YAGONA narsa bo'lishi mumkin,
 * shuning uchun unda "keyingi qadam" bo'lishi shart: holat
 * tavsifining o'zi ishni bajarmaydi.
 */
export function buildHandoffSummary(input: HandoffSummaryInput): string {
  const lines: string[] = ["🤝 ODAM ARALASHUVI KERAK", ""];

  lines.push(`Sabab: ${HANDOFF_TRIGGER_LABELS[input.trigger]}`);
  lines.push(`Mijoz: ${input.customerName?.trim() || "(ismi noma’lum)"}`);
  if (input.region?.trim()) lines.push(`Hudud: ${input.region.trim()}`);
  lines.push(`Bosqich: ${SALES_STAGE_LABELS[input.stage]}`);
  lines.push(`Harorat: ${LEAD_TEMPERATURE_LABELS[input.temperature]}`);

  const objectionLabels = input.objections
    .filter((kind): kind is ObjectionKind => kind in OBJECTION_LABELS)
    .map((kind) => OBJECTION_LABELS[kind]);
  if (objectionLabels.length > 0) {
    lines.push(`E’tirozlar: ${objectionLabels.join(", ")}`);
  }

  lines.push(`Anketa: ${input.intakeSubmitted ? "to‘ldirilgan" : "to‘ldirilmagan"}`);
  lines.push(`To‘lov: ${paymentLabel(input.paymentStatus)}`);

  if (input.explained.length > 0) {
    lines.push("", `AI tushuntirgan: ${input.explained.join(", ")}`);
  }

  if (input.lastCustomerQuestion?.trim()) {
    lines.push("", `Oxirgi savol: “${input.lastCustomerQuestion.trim().slice(0, 300)}”`);
  }

  lines.push("", `Tavsiya: ${recommendation(input)}`);
  return lines.join("\n");
}

function paymentLabel(status: string): string {
  switch (status) {
    case "paid":
      return "tasdiqlangan";
    case "evidence_received":
      return "chek kelgan, tekshirilmagan";
    case "requested":
      return "so‘ralgan";
    default:
      return "yo‘q";
  }
}

/** Keyingi qadam — sababga va bosqichga qarab. */
function recommendation(input: HandoffSummaryInput): string {
  switch (input.trigger) {
    case "refund_dispute":
    case "payment_mismatch":
      return "To‘lov yozuvlarini tekshirib, mijozga o‘zingiz javob bering.";
    case "complaint":
    case "legal":
      return "Darhol javob bering — bu savol avtomatik javobga qoldirilmaydi.";
    case "privacy_review":
      return "Ma’lumotni o‘chirish talabini ko‘rib chiqing.";
    case "media_or_government":
    case "partnership":
      return "Rahbariyatga yo‘naltiring.";
    case "hot_lead":
      return "Mijoz qizigan — qo‘ng‘iroq qilib yoping.";
    case "explicit_request":
      return "Mijoz odam bilan gaplashmoqchi — imkon qadar tez javob bering.";
    case "repeated_misunderstanding":
      return "AI savolni tushunmadi — savolga o‘zingiz javob bering va bilim bazasiga qo‘shing.";
    case "technical_failure":
      return "Texnik nosozlik — suhbatni qo‘lda davom ettiring.";
    case "unsafe":
      return "Ehtiyot bo‘ling — vaziyatni o‘zingiz baholang.";
  }
}

/**
 * Qizigan mijozni odamga o'tkazish kerakmi.
 *
 * Avtomatik emas: HOT bo'lgani bilan AI suhbatni davom ettira oladi.
 * Faqat to'lovga tayyor va bosqich turib qolgan holatda odam
 * yopgani foydaliroq.
 */
export function shouldEscalateHotLead(input: {
  temperature: LeadTemperature;
  stage: SalesStage;
  unansweredFollowups: number;
}): boolean {
  if (input.temperature !== "payment_ready") return false;
  if (input.stage !== "waiting_payment" && input.stage !== "payment_requested") return false;
  return input.unansweredFollowups >= 2;
}
