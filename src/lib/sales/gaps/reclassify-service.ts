import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  classifyHistoricalGap,
  emptyCounts,
  type GapClassification,
} from "./gap-classification.ts";

export * from "./gap-classification.ts";

/**
 * TARIXIY TOZALASH — QAYTARILADIGAN (23- va 38-band).
 *
 * HECH BIR QATOR O'CHIRILMAYDI. Savol bo'lmagan yozuvning
 * `status` i `archived` ga o'tadi, eskisi esa `previous_status`
 * da qoladi — ya'ni tozalashni butunlay qaytarib bo'ladi.
 *
 * IDEMPOTENT: allaqachon tasniflangan yozuv qayta ishlanmaydi,
 * shuning uchun cron uni har soat qayta ko'rsa ham natija
 * o'zgarmaydi.
 */

const BATCH = 200;

export interface ReclassifyResult {
  scanned: number;
  archived: number;
  counts: Record<GapClassification, number>;
  runId: string | null;
  error: string | null;
}

export async function reclassifyKnowledgeGaps(options: {
  actorId?: string | null;
  /** Bir yurishda ko'pi bilan shuncha yozuv. */
  limit?: number;
  note?: string | null;
} = {}): Promise<ReclassifyResult> {
  const admin = createSupabaseAdminClient();
  const counts = emptyCounts();
  let scanned = 0;
  let archived = 0;

  const { data: run } = await admin
    .from("sales_gap_cleanup_runs")
    .insert({ actor_id: options.actorId ?? null, note: options.note ?? null })
    .select("id")
    .maybeSingle();
  const runId = (run?.id as string | undefined) ?? null;

  const limit = options.limit ?? 5000;

  try {
    while (scanned < limit) {
      /*
       * FAQAT TASNIFLANMAGANLAR.
       *
       * `classified_at is null` sharti idempotentlikni beradi:
       * ikkinchi yurish hech narsa qilmaydi va sanoq
       * ikkilanmaydi.
       */
      const { data, error } = await admin
        .from("sales_knowledge_gaps")
        .select("id, question, status")
        .is("classified_at", null)
        .order("created_at", { ascending: true })
        .limit(Math.min(BATCH, limit - scanned));

      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;

      for (const row of data) {
        const verdict = classifyHistoricalGap(row.question as string);
        counts[verdict.classification] += 1;
        scanned += 1;

        const update: Record<string, unknown> = {
          classification: verdict.classification,
          classification_reason: verdict.reason,
          classified_at: new Date().toISOString(),
          message_intent: verdict.intent,
          kind: verdict.kind,
        };

        /*
         * ARXIVLASH FAQAT OCHIQ YOZUVGA.
         *
         * Admin allaqachon javob bergan yoki yopgan yozuvga
         * tegilmaydi — uning holati ongli qaror edi.
         */
        if (verdict.archive && row.status === "open") {
          update.previous_status = row.status;
          update.status = "archived";
          archived += 1;
        }

        await admin.from("sales_knowledge_gaps").update(update).eq("id", row.id as string);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await admin
        .from("sales_gap_cleanup_runs")
        .update({ finished_at: new Date().toISOString(), scanned, counts, note: `XATO: ${message}` })
        .eq("id", runId);
    }
    return { scanned, archived, counts, runId, error: message };
  }

  if (runId) {
    await admin
      .from("sales_gap_cleanup_runs")
      .update({
        finished_at: new Date().toISOString(),
        scanned,
        counts: { ...counts, archived },
      })
      .eq("id", runId);
  }

  return { scanned, archived, counts, runId, error: null };
}

/** Tozalashni QAYTARADI — arxivlangan yozuvlar navbatga qaytadi. */
export async function undoReclassification(): Promise<{ restored: number }> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_knowledge_gaps")
    .update({ status: "open", previous_status: null })
    .eq("status", "archived")
    .not("previous_status", "is", null)
    .select("id");
  return { restored: data?.length ?? 0 };
}

/** Navbat va arxiv sanoqlari — panel va hisobot uchun. */
export async function gapCounts(): Promise<{
  open: number;
  archived: number;
  byClassification: Record<string, number>;
  escalationsOpen: number;
}> {
  const admin = createSupabaseAdminClient();

  const [{ count: open }, { count: archivedCount }, { data: rows }, { count: escalations }] =
    await Promise.all([
      admin
        .from("sales_knowledge_gaps")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      admin
        .from("sales_knowledge_gaps")
        .select("id", { count: "exact", head: true })
        .eq("status", "archived"),
      admin.from("sales_knowledge_gaps").select("classification"),
      admin
        .from("sales_case_escalations")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
    ]);

  const byClassification: Record<string, number> = {};
  for (const row of rows ?? []) {
    const key = (row.classification as string | null) ?? "tasniflanmagan";
    byClassification[key] = (byClassification[key] ?? 0) + 1;
  }

  return {
    open: open ?? 0,
    archived: archivedCount ?? 0,
    byClassification,
    escalationsOpen: escalations ?? 0,
  };
}
