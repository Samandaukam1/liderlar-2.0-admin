import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MessageIntent } from "../flow/message-intent.ts";

/**
 * SUHBAT AQLI KO'RSATKICHLARI (31-band).
 *
 * ENG MUHIM RAQAM — YOLG'ON JAVOBSIZLIK ULUSHI: oddiy muloqot
 * xabarlarining qanchasi "Javobsiz savollar" ga tushgan.
 * Maqsad — nol atrofida.
 *
 * Raqamlar TASNIFLANGAN xabarlardan hisoblanadi, ya'ni
 * o'lchov yangi tizim ishga tushgandan keyingi davrni
 * ko'rsatadi. Eski xabarlarda tasnif yo'q va ular sanoqqa
 * kirmaydi — bu ataylab: ularni "toza" deb ko'rsatish
 * natijani bo'yab qo'yardi.
 */

/** Bilim bazasi kerak bo'lgan niyatlar. */
const QUESTION_INTENTS: readonly MessageIntent[] = [
  "knowledge_question",
  "process_question",
  "price_question",
  "follow_up_question",
];

/** Savol bo'lmagan — oddiy muloqot. */
function isConversational(intent: string): boolean {
  return (
    !QUESTION_INTENTS.includes(intent as MessageIntent) &&
    intent !== "status_question"
  );
}

export interface IntelligenceMetrics {
  /** Tasniflangan kiruvchi xabarlar soni. */
  classified: number;
  /** Oddiy muloqot xabarlari. */
  conversational: number;
  /** Bilim talab qilgan savollar. */
  questions: number;
  /** Mijozning o'z holati haqidagi savollar. */
  statusQuestions: number;
  /** Bo'shliq yozilgan xabarlar. */
  knowledgeGaps: number;
  /** Odam topshirig'i yaratilgan xabarlar. */
  escalations: number;
  /**
   * YOLG'ON JAVOBSIZLIK: muloqot xabari bo'la turib bo'shliqqa
   * tushganlar. Nol bo'lishi kerak.
   */
  falseUnanswered: number;
  /** Niyatlar bo'yicha taqsimot. */
  byIntent: Record<string, number>;
}

export async function getIntelligenceMetrics(limit = 5000): Promise<IntelligenceMetrics> {
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("sales_messages")
    .select("message_intent, gap_decision")
    .not("message_intent", "is", null)
    .order("sent_at", { ascending: false })
    .limit(limit);

  const metrics: IntelligenceMetrics = {
    classified: 0,
    conversational: 0,
    questions: 0,
    statusQuestions: 0,
    knowledgeGaps: 0,
    escalations: 0,
    falseUnanswered: 0,
    byIntent: {},
  };

  for (const row of data ?? []) {
    const intent = (row.message_intent as string | null) ?? "";
    if (intent === "") continue;
    const decision = (row.gap_decision as string | null) ?? "none";

    metrics.classified += 1;
    metrics.byIntent[intent] = (metrics.byIntent[intent] ?? 0) + 1;

    if (intent === "status_question") metrics.statusQuestions += 1;
    else if (QUESTION_INTENTS.includes(intent as MessageIntent)) metrics.questions += 1;
    else metrics.conversational += 1;

    if (decision === "knowledge_gap") {
      metrics.knowledgeGaps += 1;
      // Muloqot xabari bo'shliqqa tushgan — aynan shu xato
      // uchun butun tizim qayta qurildi.
      if (isConversational(intent)) metrics.falseUnanswered += 1;
    }
    if (decision === "case_escalation") metrics.escalations += 1;
  }

  return metrics;
}
