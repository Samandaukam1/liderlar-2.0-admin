import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { runMiningPass, countMessages } from "./miner.ts";
import { detectConflicts, type ConflictCandidate } from "../knowledge-conflict.ts";
import { suggestFactKind } from "../knowledge-validity.ts";
import type { FaqCluster } from "./faq-cluster.ts";
import type { ObjectionCluster } from "./objection-mining.ts";
import type { StyleDatasetAnalysis } from "./style-dataset.ts";
import type { RunKind, RunStatus } from "./run-types.ts";

/**
 * O'RGANISH YUGURISHI — ADMIN BOSHLAYDI, SAHIFA YUKLASH EMAS (7-band).
 *
 * NEGA MUHIM: tahlil sahifa ochilganda hisoblansa, har yuklashda
 * 20 000 xabar qayta o'qilardi. Bu sekin, qimmat va — eng yomoni —
 * natija har safar biroz boshqacha bo'lardi, chunki oraliqda yangi
 * xabar kelishi mumkin.
 *
 * Endi natija YUGURISHGA bog'langan: u qachon, qanday qamrov bilan
 * hisoblangani saqlanadi va sahifa faqat SAQLANGANINI ko'rsatadi.
 *
 * TO'LIQ QAYTA QURISH O'ZI FAOLLASHMAYDI (43-band): yangi uslub
 * profili `draft` bo'lib qoladi va admin uni ko'rib faollashtiradi.
 */

/*
 * Turlar va yorliqlar SOF modulda (`run-types.ts`): admin
 * sahifasining klient komponenti ularni o'qiydi va bu fayl
 * `server-only`.
 */
export {
  RUN_STATUS_LABELS,
  RUN_KIND_LABELS,
  type RunKind,
  type RunStatus,
} from "./run-types.ts";

export interface StartRunResult {
  ok: boolean;
  runId?: string;
  error?: string;
}

/**
 * Yangi yugurish ochadi.
 *
 * BIR VAQTDA BITTA: `uq_sales_mining_run_active` unikal indeksi
 * ikkinchisini rad etadi. Ikkita parallel qazish bir xil
 * klasterni ikki marta yozardi va chastota ikki barobar
 * ko'rinardi.
 */
export async function startMiningRun(input: {
  kind: RunKind;
  actorId: string | null;
}): Promise<StartRunResult> {
  const admin = createSupabaseAdminClient();

  /*
   * INKREMENTAL YUGURISH SUV BELGISI (43-band).
   *
   * Oxirgi TUGAGAN yugurish qayergacha ko'rganini oladi.
   * To'liq qayta qurishda belgi YO'Q — hamma narsa qaytadan
   * ko'riladi.
   */
  let watermarkAt: string | null = null;
  if (input.kind === "incremental") {
    const { data: previous } = await admin
      .from("sales_mining_runs")
      .select("latest_message_at")
      .eq("status", "completed")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    watermarkAt = (previous?.latest_message_at as string | null) ?? null;
  }

  const { data, error } = await admin
    .from("sales_mining_runs")
    .insert({
      kind: input.kind,
      status: "queued",
      watermark_at: watermarkAt,
      created_by: input.actorId,
      coverage_status: "unknown",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Boshqa qazish yugurishi allaqachon ishlamoqda." };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, runId: data.id as string };
}

export interface AdvanceResult {
  ok: boolean;
  status: RunStatus;
  error?: string;
}

/**
 * Yugurishni bir qadam oldinga suradi.
 *
 * Bitta chaqiruv vaqt byudjeti doirasida ishlaydi. Tugamasa
 * yugurish `running` bo'lib qoladi va keyingi chaqiruv davom
 * ettiradi — kursor bazada saqlangan.
 */
export async function advanceMiningRun(runId: string): Promise<AdvanceResult> {
  const admin = createSupabaseAdminClient();

  const { data: run } = await admin
    .from("sales_mining_runs")
    .select("id, kind, status, watermark_at, cursor_last_message_at, cursor_conversation_id, started_at, current_batch")
    .eq("id", runId)
    .maybeSingle();

  if (!run) return { ok: false, status: "failed", error: "Yugurish topilmadi." };
  if (run.status === "cancelled") return { ok: true, status: "cancelled" };
  if (run.status === "completed") return { ok: true, status: "completed" };

  const startedAt = (run.started_at as string | null) ?? new Date().toISOString();
  await admin
    .from("sales_mining_runs")
    .update({ status: "running", started_at: startedAt })
    .eq("id", runId);

  const watermarkAt = (run.watermark_at as string | null) ?? null;

  try {
    const result = await runMiningPass({ runId, watermarkAt, now: new Date() });
    const { counters, failedBatches, exhausted, batchesProcessed, elapsedMs } = result.progress;

    const messagesDiscovered = await countMessages(watermarkAt);

    await persistResults(runId, result.faqClusters, result.objectionClusters, result.style);
    const conflicts = await detectAndRecordConflicts(runId);

    const finished = exhausted;
    const totalElapsed =
      Date.now() - Date.parse(startedAt) || elapsedMs;

    await admin
      .from("sales_mining_runs")
      .update({
        status: finished ? "completed" : "running",
        conversations_discovered: counters.conversationsDiscovered,
        conversations_processed: counters.conversationsProcessed,
        messages_discovered: messagesDiscovered,
        messages_processed: counters.messagesProcessed,
        incoming_count: counters.incoming,
        human_outbound_count: counters.humanOutbound,
        ai_outbound_count: counters.aiOutbound,
        system_count: counters.system,
        media_only_count: counters.mediaOnly,
        deleted_count: counters.deleted,
        skipped_count: counters.skipped,
        earliest_message_at: counters.earliestMessageAt,
        latest_message_at: counters.latestMessageAt,
        current_batch: ((run.current_batch as number) ?? 0) + batchesProcessed,
        failed_batches: failedBatches,
        cursor_last_message_at: result.progress.cursor?.lastMessageAt ?? null,
        cursor_conversation_id: result.progress.cursor?.conversationId ?? null,
        coverage_status: result.coverage.status,
        coverage_note: result.coverage.note,
        measured_rate_per_sec: result.eta.ratePerSecond,
        eta_seconds: result.eta.etaSeconds,
        duration_ms: totalElapsed,
        finished_at: finished ? new Date().toISOString() : null,
        faq_clusters: result.faqClusters.length,
        objection_clusters: result.objectionClusters.length,
        questions_found: result.faqClusters.reduce((sum, c) => sum + c.messageCount, 0),
        notes: [
          result.coverage.note,
          result.eta.note,
          `${conflicts} ta bilim ziddiyati aniqlandi.`,
        ],
      })
      .eq("id", runId);

    return { ok: true, status: finished ? "completed" : "running" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("sales_mining_runs")
      .update({
        status: "failed",
        error: message.slice(0, 500),
        finished_at: new Date().toISOString(),
        coverage_status: "partial",
        coverage_note: "Yugurish xato bilan tugadi — natijalar to‘liq emas.",
      })
      .eq("id", runId);
    return { ok: false, status: "failed", error: message };
  }
}

/* ----------------------------- natijani saqlash -------------------------- */

/**
 * FAQ, e'tiroz va uslub natijalarini saqlaydi.
 *
 * HAMMASI QORALAMA (14-band). Avtomatik tasdiqlash YO'Q: mijozga
 * aytiladigan faktni odam tasdiqlaydi.
 */
async function persistResults(
  runId: string,
  faqClusters: readonly FaqCluster[],
  objectionClusters: readonly ObjectionCluster[],
  style: StyleDatasetAnalysis,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  /* ------------------------------ FAQ ------------------------------- */
  for (const cluster of faqClusters) {
    /*
     * MAVJUD YOZUVNI TOPAMIZ VA SANOQNI YANGILAYMIZ.
     *
     * `upsert` ishlatilmaydi: tasdiqlangan javob bo'lsa, uni
     * ustidan yozib yubormaslik kerak. Sanoq yangilanadi,
     * javob va status TEGILMAYDI.
     */
    const { data: existing } = await admin
      .from("sales_faq")
      .select("id, status, answer_status")
      .eq("normalized_question", cluster.clusterKey)
      .maybeSingle();

    const payload = {
      canonical_question: cluster.canonicalQuestion.slice(0, 500),
      alternative_phrasings: cluster.variants,
      examples: cluster.examples,
      category: cluster.category,
      intent_key: cluster.intentKey,
      intent_kind: cluster.kind,
      message_count: cluster.messageCount,
      conversation_count: cluster.conversationCount,
      // Eski `frequency` ustuni saqlanadi — mavjud UI uni o'qiydi.
      // Unga SUHBAT soni yoziladi: xabar soni bitta mijozning
      // takrorini ko'paytirib ko'rsatardi.
      frequency: cluster.conversationCount,
      last_seen_at: cluster.lastSeenAt ?? now,
      last_run_id: runId,
    };

    if (existing) {
      await admin.from("sales_faq").update(payload).eq("id", existing.id as string);
    } else {
      await admin.from("sales_faq").insert({
        ...payload,
        normalized_question: cluster.clusterKey,
        // AI QAZIGANI HAR DOIM QORALAMA.
        status: "draft",
        approved: false,
        answer_status: "unanswered",
        source_type: "mined",
        first_seen_at: cluster.firstSeenAt ?? now,
        run_id: runId,
      });
    }
  }

  /* --------------------------- e'tirozlar --------------------------- */
  for (const cluster of objectionClusters) {
    const { data: existing } = await admin
      .from("sales_objections")
      .select("id")
      .eq("objection_kind", cluster.kind)
      .maybeSingle();

    const payload = {
      label: cluster.label,
      message_count: cluster.messageCount,
      conversation_count: cluster.conversationCount,
      examples: cluster.examples,
      // Strategiya — QANDAY javob berish. Fakt emas (18-band).
      strategy: cluster.strategy,
      last_seen_at: cluster.lastSeenAt ?? now,
      run_id: runId,
    };

    if (existing) {
      await admin.from("sales_objections").update(payload).eq("id", existing.id as string);
    } else {
      await admin.from("sales_objections").insert({
        ...payload,
        objection_kind: cluster.kind,
        status: "draft",
        first_seen_at: cluster.firstSeenAt ?? now,
      });
    }
  }

  /* ------------------------ uslub QORALAMASI ------------------------ */
  await persistStyleDraft(runId, style);
}

/**
 * Uslub profilini QORALAMA sifatida saqlaydi.
 *
 * FAOL PROFILGA TEGILMAYDI (22-band). Auditda ko'rilgan "hi" li
 * profil aynan shu himoya bo'lmagani uchun jonli botga tushgan edi:
 * qayta hisoblash faol yozuvni ustidan yozardi.
 */
async function persistStyleDraft(
  runId: string,
  style: StyleDatasetAnalysis,
): Promise<void> {
  const admin = createSupabaseAdminClient();

  if (style.humanMessageCount === 0) return;

  const { data: active } = await admin
    .from("sales_style_profiles")
    .select("id, profile")
    .eq("is_active", true)
    .maybeSingle();

  await admin.from("sales_style_profiles").insert({
    name: `Qoralama — ${new Date().toISOString().slice(0, 10)}`,
    // QAT'IY: yangi profil FAOL EMAS.
    is_active: false,
    status: "draft",
    sample_conversation_count: style.conversationCount,
    sample_message_count: style.humanMessageCount,
    human_message_count: style.humanMessageCount,
    excluded_message_count: style.excludedTotal,
    excluded_reasons: style.excluded,
    dataset_start_at: style.datasetStartAt,
    dataset_end_at: style.datasetEndAt,
    class_metrics: {
      overall: style.overall,
      classes: style.classes,
      signals: style.signals,
    },
    redacted_examples: style.recommendedExamples,
    previous_profile_id: (active?.id as string | null) ?? null,
    coverage_note:
      `${style.humanMessageCount} ta inson xabari o‘rganildi, ` +
      `${style.excludedTotal} tasi chiqarib tashlandi.`,
    run_id: runId,
    profile: {},
  });
}

/* --------------------------- bilim ziddiyatlari -------------------------- */

/**
 * Tasdiqlangan bilimlar ichidagi ziddiyatlarni topadi va yozadi.
 *
 * TOPILGAN YOZUVLAR `conflicted` deb BELGILANADI, ya'ni ular
 * avtonom javobdan chiqadi (10-band). O'chirilmaydi — admin
 * qaysi biri to'g'ri ekanini hal qiladi.
 */
async function detectAndRecordConflicts(runId: string): Promise<number> {
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("sales_knowledge")
    .select("id, question, answer, status")
    .eq("status", "approved")
    .is("archived_at", null)
    .limit(1000);

  const candidates: ConflictCandidate[] = (data ?? []).map((row) => ({
    id: row.id as string,
    question: (row.question as string | null) ?? null,
    answer: row.answer as string,
    status: row.status as string,
  }));

  const conflicts = detectConflicts(candidates);
  const now = new Date().toISOString();

  for (const conflict of conflicts) {
    const { data: existing } = await admin
      .from("sales_knowledge_conflicts")
      .select("id, status")
      .eq("topic_key", conflict.topicKey)
      .maybeSingle();

    if (existing) {
      // Hal qilingan ziddiyat QAYTA OCHILMAYDI: admin qaror
      // qilgan bo'lsa, keyingi yugurish uni bekor qilmasligi kerak.
      if ((existing.status as string) === "open") {
        await admin
          .from("sales_knowledge_conflicts")
          .update({
            members: conflict.members,
            member_count: conflict.members.length,
            detection_reason: conflict.reason,
            last_detected_at: now,
            run_id: runId,
          })
          .eq("id", existing.id as string);
      }
      continue;
    }

    await admin.from("sales_knowledge_conflicts").insert({
      topic_key: conflict.topicKey,
      topic_label: conflict.topicLabel,
      members: conflict.members,
      member_count: conflict.members.length,
      detection_reason: conflict.reason,
      status: "open",
      run_id: runId,
      first_detected_at: now,
      last_detected_at: now,
    });
  }

  /* --- bilim yozuvlarini belgilash --- */
  const openTopics = conflicts.map((conflict) => conflict.topicKey);
  const conflictedIds = new Set(
    conflicts.flatMap((conflict) => conflict.members.map((member) => member.id)),
  );

  if (conflictedIds.size > 0) {
    await admin
      .from("sales_knowledge")
      .update({ conflict_status: "conflicted", conflict_group: openTopics[0] ?? null })
      .in("id", [...conflictedIds]);
  }

  /*
   * TASNIFLANMAGAN BILIMGA TUR TAKLIF QILISH.
   *
   * Avtomatik `permanent_fact` HECH QACHON qo'yilmaydi — faqat
   * "bu muddatli taklif ko'rinadi" yoki "bu bajariladigan va'da
   * ko'rinadi" degan taklif. Qolgani `unclassified` bo'lib
   * qoladi va adminda ko'rinadi.
   */
  for (const candidate of candidates) {
    const suggested = suggestFactKind(candidate.answer);
    if (suggested === "unclassified") continue;
    await admin
      .from("sales_knowledge")
      .update({ fact_kind: suggested })
      .eq("id", candidate.id)
      .eq("fact_kind", "unclassified");
  }

  return conflicts.length;
}

/* ------------------------------ faollashtirish --------------------------- */

/**
 * Uslub qoralamasini FAOLLASHTIRADI — faqat admin qo'li bilan.
 *
 * Eski faol profil `archived` bo'ladi, o'chirilmaydi: qaytarish
 * kerak bo'lsa u joyida turadi.
 */
export async function activateStyleProfile(input: {
  profileId: string;
  actorId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = createSupabaseAdminClient();

  const { data: profile } = await admin
    .from("sales_style_profiles")
    .select("id, status")
    .eq("id", input.profileId)
    .maybeSingle();

  if (!profile) return { ok: false, error: "Profil topilmadi." };
  if ((profile.status as string) === "active") return { ok: true };

  // Avval eskisini bo'shatamiz: `uq_sales_style_profiles_active`
  // bir vaqtda bitta faol profilga ruxsat beradi.
  await admin
    .from("sales_style_profiles")
    .update({ is_active: false, status: "archived" })
    .eq("is_active", true);

  const { error } = await admin
    .from("sales_style_profiles")
    .update({
      is_active: true,
      status: "active",
      activated_by: input.actorId,
      activated_at: new Date().toISOString(),
    })
    .eq("id", input.profileId);

  if (error) return { ok: false, error: error.message };

  await logAudit({
    actorId: input.actorId,
    action: "sales.style.activate",
    entityType: "sales_style_profile",
    entityId: input.profileId,
    severity: "warning",
  });

  return { ok: true };
}
