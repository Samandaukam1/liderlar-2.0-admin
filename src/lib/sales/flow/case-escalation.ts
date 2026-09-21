import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redactPii } from "../redact.ts";
import {
  categoryForObject,
  type EscalationCategory,
} from "./case-escalation-rules.ts";

export * from "./case-escalation-rules.ts";

/**
 * ODAM TOPSHIRIG'I — HAQIQIY, VA'DA EMAS (12–13-band).
 *
 * Bot "administratorga yo'naltirdim" deyishga FAQAT shu
 * funksiya `created: true` qaytargandan keyin haqli. Ilgari
 * bunday va'da har safar berilardi, lekin orqada hech qanday
 * yozuv yaratilmasdi.
 */

export interface CreateEscalationInput {
  conversationId: string;
  messageId: string | null;
  category: EscalationCategory;
  question: string;
  reason: string;
  contextSummary?: string | null;
}

export interface CreateEscalationResult {
  created: boolean;
  /** Shu suhbatda shu turdagi ochiq topshiriq allaqachon bor edi. */
  duplicate: boolean;
  error: string | null;
}

export async function createCaseEscalation(
  input: CreateEscalationInput,
): Promise<CreateEscalationResult> {
  const admin = createSupabaseAdminClient();

  /*
   * MATN REDAKSIYADAN O'TADI.
   *
   * Topshiriq matni panelda, jurnal va bildirishnomalarda
   * ko'rinadi. Mijoz savolining ichida karta yoki telefon
   * raqami bo'lishi mumkin (37-band).
   */
  const question = redactPii(input.question).text.slice(0, 1000);
  const context = input.contextSummary
    ? redactPii(input.contextSummary).text.slice(0, 2000)
    : null;

  const { error } = await admin.from("sales_case_escalations").insert({
    conversation_id: input.conversationId,
    message_id: input.messageId,
    category: input.category,
    question,
    reason: input.reason.slice(0, 500),
    context_summary: context,
  });

  if (!error) return { created: true, duplicate: false, error: null };

  /*
   * 23505 — shu suhbatda shu turdagi OCHIQ topshiriq bor.
   *
   * Bu xato emas: mijoz "tayyormi?" deb uch marta so'rasa,
   * koordinator uchta bir xil topshiriq ko'rmasligi kerak.
   * Va'da baribir haqiqiy — topshiriq navbatda turibdi.
   */
  if (error.code === "23505") {
    return { created: true, duplicate: true, error: null };
  }

  console.error("SALES_ESCALATION_FAILED", {
    conversationId: input.conversationId,
    code: error.code,
    message: error.message,
  });
  return { created: false, duplicate: false, error: error.message };
}

export { categoryForObject };
