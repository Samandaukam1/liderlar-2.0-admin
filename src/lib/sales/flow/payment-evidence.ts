import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { INTAKE_BUCKET } from "@/lib/intake/constants";
import { getSalesFileUrl } from "../telegram-sales-api.ts";

/**
 * TO'LOV CHEKI (skrinshot / PDF).
 *
 * Fayl mavjud anketa bucket'iga saqlanadi — yangi saqlash joyi
 * ochilmaydi. Yuklab olish `getFile` orqali: bu O'QISH metodi va u
 * bilan mijozga hech narsa yuborib bo'lmaydi.
 *
 * AI CHEKGA QARAB "TO'LANDI" DEMAYDI. Bu modul faqat faylni saqlaydi
 * va yozuv qoldiradi; tasdiqlash admin tugmasi bilan bo'ladi
 * (`engine.ts` dagi `confirmPayment`).
 */

/** Chekdan kattaroq fayl kutilmaydi — himoya chegarasi. */
const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;

export interface RecordEvidenceInput {
  conversationId: string;
  messageId: string | null;
  fileId: string | null;
  messageType: string;
}

export interface RecordEvidenceResult {
  ok: boolean;
  evidenceId?: string;
  storagePath?: string;
  error?: string;
}

export async function recordPaymentEvidence(
  input: RecordEvidenceInput,
): Promise<RecordEvidenceResult> {
  const admin = createSupabaseAdminClient();
  const fileKind =
    input.messageType === "photo" ? "photo" : input.messageType === "document" ? "document" : "other";

  let storagePath: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;
  let downloadError: string | null = null;

  if (input.fileId) {
    try {
      const url = await getSalesFileUrl(input.fileId);
      if (!url) {
        downloadError = "Telegram fayl havolasini bermadi";
      } else {
        const response = await fetch(url);
        if (!response.ok) {
          downloadError = `fayl yuklanmadi (HTTP ${response.status})`;
        } else {
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.byteLength > MAX_EVIDENCE_BYTES) {
            downloadError = "fayl juda katta";
          } else {
            mimeType = response.headers.get("content-type");
            fileSize = buffer.byteLength;
            const extension = url.split(".").pop()?.split("?")[0]?.slice(0, 6) ?? "bin";
            storagePath = `sales-payments/${input.conversationId}/${randomUUID()}.${extension}`;

            const { error } = await admin.storage
              .from(INTAKE_BUCKET)
              .upload(storagePath, buffer, {
                contentType: mimeType ?? "application/octet-stream",
                upsert: false,
              });
            if (error) {
              downloadError = error.message;
              storagePath = null;
            }
          }
        }
      }
    } catch (err) {
      downloadError = err instanceof Error ? err.message : String(err);
    }
  }

  // Fayl yuklanmasa ham YOZUV QOLADI: chek kelgani fakti yo'qolmasligi
  // kerak, admin uni Telegram'da o'zi ko'ra oladi.
  const { data, error } = await admin
    .from("sales_payment_evidence")
    .insert({
      conversation_id: input.conversationId,
      message_id: input.messageId,
      file_kind: fileKind,
      telegram_file_id: input.fileId,
      storage_path: storagePath,
      mime_type: mimeType,
      file_size: fileSize,
    })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  await admin
    .from("sales_conversations")
    .update({ payment_status: "evidence_received" })
    .eq("id", input.conversationId)
    .neq("payment_status", "paid");

  return {
    ok: true,
    evidenceId: (data?.id as string) ?? undefined,
    storagePath: storagePath ?? undefined,
    error: downloadError ?? undefined,
  };
}
