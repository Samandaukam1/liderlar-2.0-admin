/**
 * LEAD HARORATI VA BALLI (10-band).
 *
 * MUTLAQ HAQIQAT EMAS. Ball — bu mijoz haqidagi taxmin, va u
 * SABABLARI bilan birga saqlanadi: "78" degan son o'zi hech narsani
 * tushuntirmaydi, "narxni so'radi + jarayonni so'radi + taklifga
 * ijobiy javob berdi" esa tushuntiradi.
 *
 * BALL MIJOZGA HECH QACHON KO'RSATILMAYDI.
 *
 * SOF MODUL.
 */

import { normalizeForIntent } from "../text-normalize.ts";
import type { SalesStage } from "./stages.ts";

export const LEAD_TEMPERATURES = ["cold", "warm", "hot", "payment_ready"] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

export const LEAD_TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  cold: "Sovuq",
  warm: "Iliq",
  hot: "Qizigan",
  payment_ready: "To‘lovga tayyor",
};

interface Signal {
  /** Ijobiy — musbat, salbiy — manfiy. */
  points: number;
  reason: string;
  phrases: readonly string[];
}

const SIGNALS: readonly Signal[] = [
  { points: 18, reason: "narxni so‘radi", phrases: ["narxi", "qancha turadi", "necha pul", "narx", "qancha"] },
  { points: 22, reason: "to‘lov usulini so‘radi", phrases: ["karta", "hisob raqam", "qayerga to'layman", "click", "payme"] },
  { points: 20, reason: "qanday qo‘shilishni so‘radi", phrases: ["qanday qo'shilaman", "qanday bo'laman", "nima qilishim kerak", "qanday ishtirok"] },
  { points: 16, reason: "nashr muddatini so‘radi", phrases: ["qachon chiqadi", "qachon tayyor", "necha kunda"] },
  { points: 25, reason: "maqola yozishga rozi", phrases: ["yozamiz", "yozaylik", "roziman", "ma'qul", "maqul", "boshlaymiz"] },
  { points: -30, reason: "qiziqmasligini aytdi", phrases: ["qiziqmayman", "kerak emas", "kerakmas", "istamayman"] },
  { points: -40, reason: "yozmaslikni so‘radi", phrases: ["yozmang", "bezovta qilmang", "stop", "unsubscribe"] },
  { points: -12, reason: "hozir puli yo‘qligini aytdi", phrases: ["pulim yo'q", "pul yo'q", "imkoniyatim yo'q"] },
];

/** Bosqichning o'zi ham signal: anketa to'ldirgan odam sovuq bo'lolmaydi. */
const STAGE_POINTS: Partial<Record<SalesStage, { points: number; reason: string }>> = {
  benefits_sent: { points: 8, reason: "foydalar yuborildi" },
  offer_sent: { points: 12, reason: "taklif yuborildi" },
  article_decision: { points: 20, reason: "maqola qaroriga yetdi" },
  need_full_name: { points: 30, reason: "F.I.Sh. so‘raldi" },
  intake_link_sent: { points: 38, reason: "anketa havolasi yuborildi" },
  waiting_intake: { points: 42, reason: "anketa to‘ldirilmoqda" },
  intake_submitted: { points: 60, reason: "anketa to‘ldirildi" },
  payment_requested: { points: 70, reason: "to‘lov so‘raldi" },
  waiting_payment: { points: 74, reason: "to‘lov kutilmoqda" },
  payment_review: { points: 85, reason: "chek yuborildi" },
  paid: { points: 100, reason: "to‘lov tasdiqlandi" },
  declined: { points: -50, reason: "rad etdi" },
};

export interface LeadScoreInput {
  stage: SalesStage;
  /** Mijozning oxirgi xabari. */
  text: string | null;
  /** Suhbatdagi mavjud ball — yangi signal unga qo'shiladi. */
  previousScore: number;
  previousReasons: readonly string[];
  /** To'lov isboti kelganmi. */
  hasPaymentEvidence: boolean;
  /** Javobsiz qolgan follow-up soni. */
  unansweredFollowups: number;
  optedOut: boolean;
}

export interface LeadScoreResult {
  score: number;
  temperature: LeadTemperature;
  reasons: string[];
}

function contains(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "u").test(haystack);
}

/**
 * Ballni qayta hisoblaydi.
 *
 * Bosqich balli YANGIDAN olinadi (u suhbatning hozirgi haqiqati),
 * matn signallari esa QO'SHILADI — mijoz narxni so'ragan bo'lsa, bu
 * keyin ham rost bo'lib qoladi.
 */
export function computeLeadScore(input: LeadScoreInput): LeadScoreResult {
  const reasons = new Set(input.previousReasons);
  let score = input.previousScore;

  const normalized = normalizeForIntent(input.text ?? "").trim();
  if (normalized !== "") {
    for (const signal of SIGNALS) {
      if (signal.phrases.some((phrase) => contains(normalized, phrase))) {
        // Bir sabab ikki marta ball bermaydi.
        if (!reasons.has(signal.reason)) {
          reasons.add(signal.reason);
          score += signal.points;
        }
      }
    }
  }

  const stagePoints = STAGE_POINTS[input.stage];
  if (stagePoints) {
    // Bosqich balli — POL, qo'shimcha emas: anketa to'ldirgan odam
    // qancha salbiy signal bergan bo'lsa ham sovuq emas.
    score = Math.max(score, stagePoints.points);
    reasons.add(stagePoints.reason);
  }

  if (input.hasPaymentEvidence) {
    score = Math.max(score, 85);
    reasons.add("to‘lov cheki yuborildi");
  }

  // Javobsiz follow-up — sovuganining belgisi, lekin rad etish emas.
  if (input.unansweredFollowups > 0) {
    score -= Math.min(20, input.unansweredFollowups * 7);
    reasons.add(`${input.unansweredFollowups} ta follow-up javobsiz qoldi`);
  }

  if (input.optedOut) {
    score = 0;
    reasons.add("avtomatik aloqadan chiqdi");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, temperature: temperatureFor(score, input), reasons: [...reasons] };
}

function temperatureFor(score: number, input: LeadScoreInput): LeadTemperature {
  if (input.optedOut || input.stage === "declined") return "cold";

  // To'lov bosqichlari haroratni BOSHQARADI: bu yerdagi odam
  // ballidan qat'i nazar to'lovga tayyor.
  if (
    input.hasPaymentEvidence ||
    input.stage === "payment_requested" ||
    input.stage === "waiting_payment" ||
    input.stage === "payment_review" ||
    input.stage === "paid"
  ) {
    return "payment_ready";
  }

  if (score >= 55) return "hot";
  if (score >= 25) return "warm";
  return "cold";
}
