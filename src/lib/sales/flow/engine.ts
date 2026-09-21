import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { createIntakeWithLink } from "@/lib/intake/intake-link-service";
import { buildIntakeBaseUrl } from "@/lib/intake/intake-base-url";
import { getSalesSettings } from "../settings.ts";
import { getConnection } from "../repository.ts";
import { generateTestReply } from "../test-chat.ts";
import { sendSalesMessage } from "../telegram-sales-api.ts";
import { classifyReply, isPaymentEvidenceType } from "./classify.ts";
import { classifyAttachment } from "./attachment-intent.ts";
import { validateFullName } from "./full-name.ts";
import {
  authorizeOutbound,
  isCoverageRefusal,
  type OutboundRefusalReason,
} from "./outbound-guard.ts";
import { FOLLOWUP_TEMPLATES, getTemplate } from "./templates.ts";
import {
  isForwardTransition,
  isSalesStage,
  resolveTransition,
  type ConversationEntry,
  TERMINAL_STAGES,
  type ReplyIntent,
  type SalesStage,
} from "./stages.ts";
import { detectObjections, mergeObjections } from "./objections.ts";
import { computeLeadScore, type LeadTemperature } from "./lead-score.ts";
import { detectOptOut, OPT_OUT_REPLY } from "./optout.ts";
import { detectHandoff, buildHandoffSummary, type HandoffTrigger } from "./handoff.ts";
import { detectMinor } from "./minor.ts";
import { canDetectReferral, detectReferral, mentionsMoney } from "./referral.ts";
import {
  classifyMessageIntent,
  pendingActionForStage,
  type IntentResult,
} from "./message-intent.ts";
import { decideKnowledgeGap } from "./knowledge-gap-gate.ts";
import { buildGapKey } from "../gaps/gap-key.ts";
import { buildConversationalReply } from "./conversational-reply.ts";
import { answerStatusQuestion, paymentStateFromColumn } from "./status-answer.ts";
import {
  categoryForObject,
  createCaseEscalation,
  escalationAcknowledgement,
  NO_ESCALATION_REPLY,
} from "./case-escalation.ts";
import { buildFallback, type FallbackReason } from "./fallback.ts";
import { newRolloutBucket, type RolloutSettings } from "./rollout.ts";
import { normalizeForMatch } from "../text-normalize.ts";
import { buildCorrectionInstruction, checkReplyQuality } from "./reply-quality.ts";
import { buildAlreadySaidBlock } from "./repetition.ts";
import { loadConversationTimeline } from "../timeline.ts";
import {
  assistantTexts,
  listExplainedTemplateKeys,
  toModelTurns,
} from "../timeline-merge.ts";
import { getCommercialFacts } from "../commercial.ts";
import { buildCommercialBlock } from "../commercial-facts.ts";
import {
  benefitsAlreadySent,
  CANONICAL_BENEFITS_TEMPLATE_KEY,
  CANONICAL_BENEFITS_TEXT,
  isGeneralBenefitsQuestion,
} from "./canonical-benefits.ts";
import { enqueueJob } from "../queue/queue-store.ts";
import {
  applyMemoryUpdate,
  parseMemory,
  type ConversationMemory,
} from "../memory/conversation-memory.ts";
import { buildMemoryBlock, verifiedFactTextsFrom } from "../memory/memory-block.ts";
import { buildRollingSummary, RECENT_WINDOW } from "../memory/rolling-summary.ts";
import { mineQuestion } from "../mining/question-mining.ts";
import { redactPii } from "../redact.ts";
import type { PaymentState } from "../memory/conversation-memory.ts";
import { decideGreeting, greetingInstruction, startsWithGreeting, stripGreeting } from "./greeting-policy.ts";

/**
 * SOTUV OQIMI DVIGATELI.
 *
 * Kiruvchi xabarga javoban: niyatni aniqlaydi, bosqichni suradi,
 * shablonlarni yuboradi, follow-up rejalashtiradi va eskirganini
 * bekor qiladi.
 *
 * IKKI HIMOYA HAR YUBORISHDA:
 *   1. `authorizeOutbound` — sozlama, inson nazorati, bosqich va
 *      Telegram huquqi tekshiriladi;
 *   2. atomik QULF — bir suhbatni ikki worker bir vaqtda ishlamaydi,
 *      shuning uchun takroriy Telegram update ikkinchi javob yubormaydi.
 */

/** Qulf shuncha vaqtda o'z-o'zidan bo'shaydi (worker o'lib qolsa). */
const LOCK_TTL_MS = 2 * 60 * 1000;

/* -------------------------------- qulf ---------------------------------- */

/**
 * Suhbatni atomik da'vo qiladi.
 *
 * Yagona UPDATE: shart bajarilmasa qator qaytmaydi. Avval o'qib,
 * keyin yozadigan variant poyga holatida ikki workerga ham "bo'sh"
 * deb ko'rinardi va mijoz ikkita bir xil xabar olardi.
 */
async function claimConversation(conversationId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const token = randomUUID();
  const now = new Date();

  const { data } = await admin
    .from("sales_conversations")
    .update({
      lock_token: token,
      lock_expires_at: new Date(now.getTime() + LOCK_TTL_MS).toISOString(),
    })
    .eq("id", conversationId)
    .or(`lock_token.is.null,lock_expires_at.lt.${now.toISOString()}`)
    .select("id");

  return data && data.length > 0 ? token : null;
}

async function releaseConversation(conversationId: string, token: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_conversations")
    .update({ lock_token: null, lock_expires_at: null })
    .eq("id", conversationId)
    .eq("lock_token", token);
}

/* ------------------------------ suhbat holati ---------------------------- */

interface FlowConversation {
  id: string;
  businessConnectionId: string;
  chatId: number;
  stage: SalesStage;
  aiEnabled: boolean;
  customerFullName: string | null;
  intakeId: string | null;
  paymentStatus: string;
  /** 0.3: sotuv aqli uchun holat. */
  objections: string[];
  leadScore: number;
  leadScoreReasons: string[];
  leadTemperature: LeadTemperature;
  optedOut: boolean;
  isMinor: boolean;
  rolloutBucket: number | null;
  /* --- 2-faza: tuzilmali xotira va salomlashish sessiyasi --- */
  memory: ConversationMemory;
  greetedAt: string | null;
  greetingSessionStartedAt: string | null;
  humanRequiredAt: string | null;
  /*
   * Suhbatni kim boshlagan. Bu ssenariyning BOSHLANISHINI
   * belgilaydi: o'zi yozgan odamga "Siz ariza qoldirgansiz,
   * shunaqami?" deb so'rash xato bo'lardi.
   */
  entry: ConversationEntry;
  /*
   * Tanish nomidan kelgan bo'lsa — manba kaliti.
   *
   * SUHBAT QATORIDA saqlanadi, xabarda emas: odam tanish nomini
   * BIR MARTA, birinchi xabarda aytadi. Keyingi xabarlarida u
   * yo'q va har safar matndan qidirilsa, qoida ikkinchi
   * xabardayoq kuchini yo'qotardi.
   */
  referralSource: string | null;
}

async function loadConversation(conversationId: string): Promise<FlowConversation | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_conversations")
    .select(
      "id, business_connection_id, chat_id, sales_stage, ai_enabled, customer_full_name, " +
        "intake_id, payment_status, objections, lead_score, lead_score_reasons, " +
        "lead_temperature, opted_out_at, is_minor, rollout_bucket, " +
        "memory, greeted_at, greeting_session_started_at, human_required_at, entry, referral_source",
    )
    .eq("id", conversationId)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  const stage = row.sales_stage as string;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  return {
    id: row.id as string,
    businessConnectionId: row.business_connection_id as string,
    chatId: row.chat_id as number,
    stage: isSalesStage(stage) ? stage : "new",
    aiEnabled: row.ai_enabled !== false,
    customerFullName: (row.customer_full_name as string | null) ?? null,
    intakeId: (row.intake_id as string | null) ?? null,
    paymentStatus: (row.payment_status as string) ?? "none",
    objections: strings(row.objections),
    leadScore: typeof row.lead_score === "number" ? row.lead_score : 0,
    leadScoreReasons: strings(row.lead_score_reasons),
    leadTemperature: (row.lead_temperature as LeadTemperature) ?? "cold",
    // Sana bor — chiqqan. Bayroq emas, sana: qachon chiqqani ham kerak.
    optedOut: row.opted_out_at != null,
    isMinor: row.is_minor === true,
    rolloutBucket: typeof row.rollout_bucket === "number" ? row.rollout_bucket : null,
    /*
     * XOTIRA (24-band). Nosoz qiymat javobni to'xtatmaydi:
     * `parseMemory()` bo'sh xotira qaytaradi va bot holatni
     * qaytadan aniqlaydi. Javobsiz qolishdan bu yaxshiroq.
     */
    memory: parseMemory(row.memory),
    greetedAt: (row.greeted_at as string | null) ?? null,
    greetingSessionStartedAt: (row.greeting_session_started_at as string | null) ?? null,
    humanRequiredAt: (row.human_required_at as string | null) ?? null,
    /*
     * Noma'lum qiymat "outbound" deb qabul qilinadi.
     *
     * Yangi xulqni taxminga asoslab yoqish, eskisini
     * qoldirishdan xavfliroq: noto'g'ri ssenariy mijozga
     * darhol ko'rinadi.
     */
    entry: row.entry === "inbound" ? "inbound" : "outbound",
    referralSource: (row.referral_source as string | null) ?? null,
  };
}

/* ------------------------------- yuborish -------------------------------- */

/**
 * Yuborish natijasi (29-band).
 *
 * BESH HOLAT, va ular ATAYLAB ajratilgan:
 *
 *   · `sent`        — Telegram qabul qildi;
 *   · `refused`     — SHU SUHBATDA ataylab jim qoldik (inson
 *                     qo'lga olgan, mijoz opt-out qilgan). Holat
 *                     haqiqiy, bosqich o'zgarmaydi;
 *   · `undelivered` — sozlama yoki chiqarish qamrovi to'sdi.
 *                     Mijoz uchun bu hech narsa sodir
 *                     bo'lmagani bilan bir xil;
 *   · `failed`      — Telegram ANIQ xato qaytardi, mijoz olmadi;
 *   · `unknown`     — timeout/uzilish. Yetkazilgani NOMA'LUM.
 *
 * `refused` va `undelivered` ni aralashtirish JONLI TIZIMDA xato
 * berdi: rollout to'sgan uchta suhbat `new -> offer_sent` ga
 * o'tib qolgan, mijozlar esa salomlashuvni ham olmagan edi.
 * `failed` va `unknown` ni aralashtirish esa boshqa tomondan
 * qimmat: birinchisida bosqichni oldinga surish yolg'on holat
 * yaratadi, ikkinchisida qayta yuborish IKKINCHI nusxani
 * jo'natadi.
 */
export type SendOutcome = "sent" | "refused" | "undelivered" | "failed" | "unknown";

export interface SentMessage {
  templateKey: string | null;
  body: string;
  kind: "template" | "knowledge_reply" | "followup";
  simulated: boolean;
  telegramMessageId: number | null;
}

export interface FlowRunResult {
  conversationId: string;
  intent: ReplyIntent | null;
  /**
   * Xabarning MULOQOT niyati (greeting, thanks, status_question...).
   *
   * Jurnalga chiqadi — mijoz matni EMAS, faqat tasnif (37-band).
   * Ishlab turgan tizimda "javobsiz savollar yana ifloslanyaptimi"
   * degan savolga shu maydon javob beradi.
   */
  messageIntent: string | null;
  /** Bo'shliq darvozasining qarori: knowledge_gap / case_escalation / none. */
  gapDecision: string | null;
  stageBefore: SalesStage;
  stageAfter: SalesStage;
  sent: SentMessage[];
  /** Nega yuborilmadi — diagnostika uchun. */
  refusals: OutboundRefusalReason[];
  /** Rejalashtirilgan follow-up turlari. */
  scheduledFollowups: string[];
  cancelledFollowups: number;
  /** Anketa havolasi yaratilgan bo'lsa. */
  intakeId: string | null;
  notes: string[];
}

interface SendContext {
  conversation: FlowConversation;
  stage: SalesStage;
  /**
   * Joriy xabarning turi (text, photo, document...).
   *
   * Niyat aniqlashda kerak: "Mana" so'zining ma'nosi rasm
   * biriktirilganiga qarab butunlay o'zgaradi (27-band).
   */
  currentMessageType: string;
  autoReplyEnabled: boolean;
  connectionEnabled: boolean;
  connectionCanReply: boolean;
  simulated: boolean;
  rollout: RolloutSettings;
  /**
   * Joriy kiruvchi xabar — tarixdan CHIQARIB TASHLANADI.
   *
   * U bazaga allaqachon yozilgan, keyin esa generatorga yana
   * `message` sifatida beriladi. Chiqarilmasa, savol modelga ikki
   * marta borardi va model uni takror deb o'ylab, boshqacha javob
   * berishga urinardi.
   */
  currentMessageId: string | null;
  result: FlowRunResult;
}

/** Bitta xabar yuboradi — ruxsat, jurnal va xato bilan birga. */
async function send(
  context: SendContext,
  input: {
    body: string;
    kind: "template" | "knowledge_reply" | "followup";
    templateKey: string | null;
    expectedStages: readonly SalesStage[];
    /**
     * JURNALGA yoziladigan matn, mijozga ketadigan matndan boshqa
     * bo'lsa (33-band).
     *
     * Yagona ishlatilishi — anketa havolasi: mijoz TO'LIQ havolani
     * olishi shart, lekin xom token `sales_outbound_log.body` ga
     * tushmasligi kerak. U yerda havola redaksiyalangan shaklda
     * turadi va `intake_link_prefix` orqali topiladi.
     */
    logBody?: string;
  },
): Promise<SendOutcome> {
  const decision = authorizeOutbound({
    conversationId: context.conversation.id,
    businessConnectionId: context.conversation.businessConnectionId,
    chatId: context.conversation.chatId,
    stage: context.stage,
    expectedStages: input.expectedStages,
    kind: input.kind,
    templateKey: input.templateKey,
    body: input.body,
    autoReplyEnabled: context.autoReplyEnabled,
    aiEnabled: context.conversation.aiEnabled,
    connectionEnabled: context.connectionEnabled,
    connectionCanReply: context.connectionCanReply,
    simulated: context.simulated,
    rollout: context.rollout,
    rolloutBucket: context.conversation.rolloutBucket,
    optedOut: context.conversation.optedOut,
    referral: context.conversation.referralSource != null,
  });

  if (!decision.allowed) {
    if (!context.result.refusals.includes(decision.reason)) {
      context.result.refusals.push(decision.reason);
    }
    // Qamrov to'sgan bo'lsa — bu "jim qolish qarori" emas,
    // YETKAZILMAGAN xabar. Bosqich shunga qarab hal qilinadi.
    return isCoverageRefusal(decision.reason) ? "undelivered" : "refused";
  }

  let telegramMessageId: number | null = null;
  let error: string | null = null;
  // Uzilish/timeout ANIQ xatodan ajratiladi: birinchisida xabar
  // yetgan bo'lishi MUMKIN, ikkinchisida aniq yetmagan.
  let deliveryUnknown = false;
  try {
    const sendResult = await sendSalesMessage(decision.authorization, input.body);
    telegramMessageId = sendResult.telegramMessageId;
    if (!sendResult.ok) error = sendResult.error;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    deliveryUnknown = /timeout|aborted|ETIMEDOUT|ECONNRESET|fetch failed/i.test(error);
  }

  // Yuborilgan (yoki urinilgan) HAR xabar jurnalga tushadi.
  const admin = createSupabaseAdminClient();
  await admin.from("sales_outbound_log").insert({
    conversation_id: context.conversation.id,
    kind: input.kind,
    template_key: input.templateKey,
    body: input.logBody ?? input.body,
    stage_before: context.result.stageBefore,
    stage_after: context.stage,
    telegram_message_id: telegramMessageId,
    simulated: decision.authorization.simulated,
    error,
  });

  if (error) {
    if (deliveryUnknown) {
      context.result.notes.push(
        `yetkazilgani NOMA’LUM (qayta yuborilmadi): ${error}`,
      );
      return "unknown";
    }
    context.result.notes.push(`yuborilmadi: ${error}`);
    return "failed";
  }

  context.result.sent.push({
    templateKey: input.templateKey,
    body: input.body,
    kind: input.kind,
    simulated: decision.authorization.simulated,
    telegramMessageId,
  });

  /*
   * BIRINCHI JAVOB VAQTI — konversiyaning eng kuchli bashoratchisi.
   *
   * `is null` sharti bilan: faqat birinchi marta yoziladi va keyingi
   * yuzlab xabar uni surib yubormaydi.
   */
  if (!decision.authorization.simulated) {
    await admin
      .from("sales_conversations")
      .update({ first_response_at: new Date().toISOString() })
      .eq("id", context.conversation.id)
      .is("first_response_at", null);

    /*
     * SALOMLASHISH SESSIYASI (23-band).
     *
     * Javobda salom bo'lsa, sessiya SHU YERDA belgilanadi.
     * Keyingi javobda `decideGreeting()` buni ko'radi va
     * qayta salomlashishni taqiqlaydi. Jurnalga emas, suhbat
     * qatoriga yoziladi: jurnal kesilishi mumkin, holat esa
     * suhbat bilan yashaydi.
     */
    if (startsWithGreeting(input.body)) {
      const nowIso = new Date().toISOString();
      context.conversation.greetedAt = nowIso;
      await admin
        .from("sales_conversations")
        .update({
          greeted_at: nowIso,
          greeting_session_started_at:
            context.conversation.greetingSessionStartedAt ?? nowIso,
        })
        .eq("id", context.conversation.id);
    }
  }
  return "sent";
}

/**
 * Suhbat xotirasini saqlaydi.
 *
 * Har javobdan KEYIN chaqiriladi. Xotira yozilmasa javob
 * baribir ketgan — shuning uchun xato javobni to'xtatmaydi,
 * faqat qayd etiladi.
 */
async function persistMemory(
  conversationId: string,
  memory: ConversationMemory,
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin
      .from("sales_conversations")
      .update({
        memory: memory as unknown as Record<string, unknown>,
        memory_updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
  } catch (err) {
    console.error("SALES_MEMORY_PERSIST_FAILED", {
      conversationId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Kuzatilgan signallardan xotirani yangilaydi va saqlaydi.
 *
 * BITTA JOY: xotira o'nlab tarmoqda alohida yangilansa, bittasi
 * esdan chiqishi muqarrar va aynan o'sha holat yo'qolardi.
 */
async function syncMemory(
  context: SendContext,
  update: Parameters<typeof applyMemoryUpdate>[1],
): Promise<void> {
  const next = applyMemoryUpdate(context.conversation.memory, update);
  context.conversation.memory = next;
  if (!context.simulated) await persistMemory(context.conversation.id, next);
}

/**
 * Suhbat qatoridagi to'lov holatini xotira holatiga moslaydi.
 *
 * Ikki nom tizimi ataylab: jadval ustuni eski qiymatlarni saqlaydi
 * (`paid`), xotira esa 2-fazaning aniqroq holatlarini ishlatadi
 * (30-band). Moslash BITTA joyda bo'lsin.
 */
function mapPaymentStatus(raw: string): PaymentState | undefined {
  switch (raw) {
    case "requested": return "requested";
    case "evidence_received": return "evidence_received";
    case "under_review": return "under_review";
    // `paid` eski nom — u vakolatli tasdiqdan kelgan, shuning uchun
    // `confirmed` ga moslanadi. Lekin bu yerda AVTORIZATSIYA
    // berilmaydi: `advancePaymentState()` uni faqat oldinga siljishi
    // sifatida qabul qiladi.
    case "paid":
    case "confirmed": return "confirmed";
    case "rejected": return "rejected";
    default: return undefined;
  }
}

/* ------------------------------- follow-up ------------------------------- */

/**
 * Kutilayotgan follow-up'larni bekor qiladi.
 *
 * Mijoz 7 daqiqadan oldin javob bersa, "Tanishib chiqdingizmi?" endi
 * o'rinsiz — u yuborilmasligi kerak. Bekor qilish har kiruvchi
 * xabarda, javob berilgan-berilmaganidan qat'i nazar bajariladi.
 */
export async function cancelPendingFollowups(
  conversationId: string,
  reason: string,
): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_followups")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason.slice(0, 200),
    })
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .select("id");
  return data?.length ?? 0;
}

async function scheduleFollowup(
  conversationId: string,
  input: { type: string; delayMinutes: number; expectedStage: SalesStage },
): Promise<boolean> {
  const templateKey = FOLLOWUP_TEMPLATES[input.type];
  if (!templateKey) return false;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("sales_followups").insert({
    conversation_id: conversationId,
    followup_type: input.type,
    template_key: templateKey,
    // Yuborish oldidan solishtiriladi: suhbat oldinga ketgan bo'lsa
    // eskirgan follow-up jim o'tkazib yuboriladi.
    expected_stage: input.expectedStage,
    scheduled_at: new Date(Date.now() + input.delayMinutes * 60_000).toISOString(),
    status: "pending",
  });
  // Unikal indeks tufayli takroriy rejalashtirish xato beradi — bu
  // kutilgan holat va yugurishni to'xtatmaydi.
  return !error;
}

/* ------------------------------ bosqich yozuvi --------------------------- */

async function moveStage(
  conversation: FlowConversation,
  to: SalesStage,
  context: { intent: ReplyIntent | null; messageId: string | null; actorId?: string | null },
  extra: Record<string, unknown> = {},
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("sales_conversations")
    .update({ sales_stage: to, stage_updated_at: new Date().toISOString(), ...extra })
    .eq("id", conversation.id);

  await admin.from("sales_stage_transitions").insert({
    conversation_id: conversation.id,
    from_stage: conversation.stage,
    to_stage: to,
    reply_intent: context.intent,
    trigger_message_id: context.messageId,
    actor: context.actorId ?? null,
  });
}

/* ================================ DVIGATEL =============================== */

export interface HandleMessageInput {
  conversationId: string;
  messageId: string | null;
  text: string | null;
  messageType: string;
  /** Sinov rejimi: Telegram'ga chiqmaydi, qolgan mantiq bir xil. */
  simulated?: boolean;
}

export async function handleIncomingMessage(
  input: HandleMessageInput,
): Promise<FlowRunResult | null> {
  const token = await claimConversation(input.conversationId);

  /*
   * QULF BAND — ISH YO'QOLMAYDI (2-faza, 27-band).
   *
   * ILGARI bu yerda `return null` turardi va webhook 200 berardi.
   * Ya'ni xabar bazaga yozilgan, lekin unga JAVOB BERISH ishi
   * jimgina yo'qolardi. Mijoz ketma-ket uch savol yozsa —
   * juda oddiy holat — ikkinchisi va uchinchisi qulfga urilib,
   * hech qachon javob olmasligi mumkin edi.
   *
   * Endi ish bardoshli navbatga tushadi va cron uni oladi.
   * Navbat bazada, shuning uchun funksiya o'lsa ham qoladi.
   */
  if (!token) {
    if (input.simulated === true) return null;
    try {
      const { duplicate } = await enqueueJob({
        conversationId: input.conversationId,
        messageId: input.messageId,
        kind: "reply",
        reason: "suhbat qulfi band edi",
      });
      if (!duplicate) {
        await logAudit({
          actorId: null,
          action: "sales.job.queued",
          entityType: "sales_conversation",
          entityId: input.conversationId,
          metadata: { reason: "lock_busy" },
        });
      }
    } catch (err) {
      // Navbatga qo'yish ham ishlamasa — bu jiddiy, lekin webhook
      // 500 qaytarsa Telegram update'ni qayta yuboraveradi va
      // xabar ikki marta saqlanardi. Xatoni qayd etib, 200 beramiz.
      console.error("SALES_ENQUEUE_FAILED", {
        conversationId: input.conversationId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }

  try {
    return await runFlow(input);
  } finally {
    await releaseConversation(input.conversationId, token);
  }
}

/**
 * Navbatdagi ishni bajaradi — cron shu funksiyani chaqiradi.
 *
 * Qulf shu yerda ham olinadi: navbat "bitta suhbat, bitta ish"
 * qoidasini ta'minlaydi, lekin webhook bilan poyga bo'lishi
 * mumkin. Qulf olinmasa ish `waiting` bo'lib qaytadi va keyingi
 * tikda qayta urinadi — YO'QOLMAYDI.
 */
export async function runQueuedJob(input: HandleMessageInput): Promise<{
  result: FlowRunResult | null;
  lockBusy: boolean;
}> {
  const token = await claimConversation(input.conversationId);
  if (!token) return { result: null, lockBusy: true };

  try {
    return { result: await runFlow(input), lockBusy: false };
  } finally {
    await releaseConversation(input.conversationId, token);
  }
}

/**
 * Oqimni bajaradi va JIM QOLISH SABABINI suhbat qatoriga yozadi.
 *
 * NEGA ALOHIDA QATLAM: rad etish sababi ilgari faqat server
 * log'ida qolardi. Admin panelda "avto-javob yoqiq" deb turardi,
 * bot esa jim edi va sababni topishning yagona yo'li Vercel
 * log'ini o'qish edi. Aynan shu sabab jonli tizimda bir necha kun
 * sezilmay qoldi: uchta mijozga `rollout_not_allowlisted` sababli
 * hech narsa yuborilmagan, panelda esa hech qanday belgi yo'q edi.
 *
 * Sabab endi suhbat qatorida turadi — suhbat sahifasi uni
 * ko'rsatadi va tuzatish tugmasi yonida bo'ladi.
 */
async function runFlow(input: HandleMessageInput): Promise<FlowRunResult | null> {
  const result = await runFlowSteps(input);
  if (result && input.simulated !== true) {
    await recordCoverageRefusal(input.conversationId, result);
    await recordMessageClassification(input.messageId, result);
  }
  return result;
}

/**
 * XABAR TASNIFINI SAQLAYDI — O'LCHOV UCHUN (31-band).
 *
 * Eng muhim ko'rsatkich — YOLG'ON JAVOBSIZLIK ULUSHI: oddiy
 * muloqot xabarlarining qanchasi bo'shliqqa tushyapti. Tasnif
 * saqlanmasa, bu savolga faqat taxmin bilan javob berilardi.
 *
 * MATN SAQLANMAYDI — u allaqachon o'z jadvalida (37-band).
 */
async function recordMessageClassification(
  messageId: string | null,
  result: FlowRunResult,
): Promise<void> {
  if (!messageId || result.messageIntent == null) return;
  try {
    await adminClient()
      .from("sales_messages")
      .update({
        message_intent: result.messageIntent,
        gap_decision: result.gapDecision ?? "none",
      })
      .eq("id", messageId);
  } catch (err) {
    // O'lchov sotuv oqimini buzmasligi kerak.
    console.error("SALES_METRIC_WRITE_FAILED", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function recordCoverageRefusal(
  conversationId: string,
  result: FlowRunResult,
): Promise<void> {
  const blocked = result.refusals.find((reason) => isCoverageRefusal(reason));
  const admin = createSupabaseAdminClient();

  try {
    if (blocked) {
      await admin
        .from("sales_conversations")
        .update({
          last_refusal_reason: blocked,
          last_refusal_at: new Date().toISOString(),
        })
        .eq("id", conversationId);
      return;
    }

    // Javob ketdi — eski ogohlantirish o'z-o'zidan o'chadi.
    // `not is null` sharti keraksiz yozishning oldini oladi.
    if (result.sent.length > 0) {
      await admin
        .from("sales_conversations")
        .update({ last_refusal_reason: null, last_refusal_at: null })
        .eq("id", conversationId)
        .not("last_refusal_reason", "is", null);
    }
  } catch (err) {
    // Bu faqat KO'RINUVCHANLIK. Yozilmasa ham sotuv oqimi
    // buzilmasligi kerak.
    console.error("SALES_REFUSAL_RECORD_FAILED", {
      conversationId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runFlowSteps(input: HandleMessageInput): Promise<FlowRunResult | null> {
  const conversation = await loadConversation(input.conversationId);
  if (!conversation) return null;

  const settings = await getSalesSettings();
  const connection = await getConnection(conversation.businessConnectionId);
  const simulated = input.simulated === true;

  const result: FlowRunResult = {
    conversationId: conversation.id,
    intent: null,
    messageIntent: null,
    gapDecision: null,
    stageBefore: conversation.stage,
    stageAfter: conversation.stage,
    sent: [],
    refusals: [],
    scheduledFollowups: [],
    cancelledFollowups: 0,
    intakeId: conversation.intakeId,
    notes: [],
  };

  // INSON NAZORATI eng birinchi: AI o'chirilgan bo'lsa hech narsa
  // qilinmaydi — hatto follow-up ham bekor qilinmaydi, chunki inson
  // ularni o'zi boshqaradi.
  if (!conversation.aiEnabled) {
    result.refusals.push("human_takeover");
    return result;
  }

  // Mijoz javob berdi — kutilayotgan follow-up endi o'rinsiz.
  result.cancelledFollowups = await cancelPendingFollowups(
    conversation.id,
    "mijoz javob berdi",
  );

  /*
   * FOIZLI CHIQARISH UCHUN BARQAROR RAQAM.
   *
   * Bir marta beriladi va o'zgarmaydi. Har xabarda tasodif olinsa,
   * bitta mijoz birinchi xabariga javob olib, ikkinchisiga olmay
   * qolardi — texnik nosozlikdan ham yomonroq taassurot.
   */
  if (conversation.rolloutBucket == null) {
    conversation.rolloutBucket = newRolloutBucket();
    await adminClient()
      .from("sales_conversations")
      .update({ rollout_bucket: conversation.rolloutBucket })
      .eq("id", conversation.id)
      .is("rollout_bucket", null);
  }

  const context: SendContext = {
    conversation,
    stage: conversation.stage,
    autoReplyEnabled: settings.flow.autoReplyEnabled,
    connectionEnabled: connection?.isEnabled ?? false,
    connectionCanReply: connection?.canReply ?? false,
    simulated,
    rollout: settings.rollout,
    currentMessageId: input.messageId,
    currentMessageType: input.messageType ?? "text",
    result,
  };

  /* ------------------------------ OPT-OUT ------------------------------- */
  /*
   * "Boshqa yozmang" — birinchi tekshiriladi va suhbat shu yerda
   * tugaydi. Sababini so'rash, qaytarishga urinish, "bir daqiqa
   * vaqtingiz bo'lsa" — hech biri yo'q (14-band).
   */
  const optOut = detectOptOut(input.text);
  if (optOut.optedOut) {
    await adminClient()
      .from("sales_conversations")
      .update({
        opted_out_at: new Date().toISOString(),
        opt_out_reason: optOut.matched,
        lead_temperature: "cold",
      })
      .eq("id", conversation.id);

    // Xayrlashuv xabari opt-out YOZILISHIDAN OLDINGI holat bilan
    // yuboriladi: aks holda o'zimiz qo'ygan bayroq o'z javobimizni
    // bloklab, mijoz javobsiz qolardi.
    await send(context, {
      body: OPT_OUT_REPLY,
      kind: "template",
      templateKey: "opt_out",
      expectedStages: [],
    });

    result.cancelledFollowups += await cancelPendingFollowups(conversation.id, "mijoz opt-out");
    result.notes.push(`opt-out: ${optOut.matched}`);
    conversation.optedOut = true;
    // Opt-out XOTIRAGA ham yoziladi: u xabar oynasidan chiqib
    // ketmasligi va keyingi har bir qarorda ko'rinishi kerak.
    await syncMemory(context, { optOut: true, leadTemperature: "cold" });
    return result;
  }

  /* -------------------------- ODAMGA O'TKAZISH -------------------------- */
  const handoff = detectHandoff(input.text);
  if (handoff) {
    await escalateToHuman(context, handoff.trigger, input.text);
    result.notes.push(`odamga o‘tkazildi: ${handoff.trigger} (${handoff.matched})`);
    await syncMemory(context, { humanTakeover: true });
    return result;
  }

  /* ------------------------ IMTIYOZLI YO'NALISH ------------------------- */
  /*
   * TANISH NOMIDAN KELGAN ODAM.
   *
   * O'tkazish va opt-out'dan KEYIN, lekin ssenariy qarorlaridan
   * OLDIN: bu bayroq o'tish jadvalini ham, yuborish darvozasini
   * ham o'zgartiradi, shuning uchun u shu xabarning o'zida
   * kuchga kirishi kerak — keyingi xabarda emas.
   *
   * BIR MARTA YOZILADI. Odam tanish nomini birinchi xabarda
   * aytadi; keyin uni qayta aytmaydi. Agar bayroq har xabarda
   * qayta hisoblansa, ikkinchi xabardayoq o'chib ketardi va
   * mijozga to'lov ma'lumoti ketib qolardi.
   */
  if (conversation.referralSource == null && canDetectReferral(conversation.stage)) {
    const referral = detectReferral(input.text);
    if (referral) {
      conversation.referralSource = referral.source;
      await adminClient()
        .from("sales_conversations")
        .update({
          referral_source: referral.source,
          referral_matched_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .is("referral_source", null);
      result.notes.push(`imtiyozli yo‘nalish: ${referral.label} (${referral.matched})`);
    }
  }

  /* ---------------------- e'tiroz, yosh, harorat ------------------------ */
  const detectedObjections = detectObjections(input.text);
  const objections = mergeObjections(conversation.objections, detectedObjections);

  const minor = detectMinor(input.text);
  const isMinor = conversation.isMinor || minor.isMinor;

  const score = computeLeadScore({
    stage: conversation.stage,
    text: input.text,
    previousScore: conversation.leadScore,
    previousReasons: conversation.leadScoreReasons,
    hasPaymentEvidence: conversation.paymentStatus === "evidence_received",
    unansweredFollowups: await countUnansweredFollowups(conversation.id),
    optedOut: false,
  });

  conversation.objections = objections;
  conversation.isMinor = isMinor;
  conversation.leadScore = score.score;
  conversation.leadTemperature = score.temperature;
  conversation.leadScoreReasons = score.reasons;

  await adminClient()
    .from("sales_conversations")
    .update({
      objections,
      lead_score: score.score,
      lead_temperature: score.temperature,
      lead_score_reasons: score.reasons,
      ...(isMinor ? { is_minor: true, minor_signal: minor.signal } : {}),
    })
    .eq("id", conversation.id);

  if (detectedObjections.length > 0) {
    result.notes.push(`e’tiroz: ${detectedObjections.map((o) => o.kind).join(", ")}`);
  }

  /*
   * XOTIRANI YANGILASH (24–26-band).
   *
   * Mijozning savoli JAVOBSIZLAR ro'yxatiga qo'shiladi va javob
   * berilganda olib tashlanadi. Shu sabab bot "siz so'ragan edingiz"
   * ni eslaydi va bir savolni ikki marta so'ramaydi.
   */
  const minedQuestion = mineQuestion(input.text);
  await syncMemory(context, {
    stage: conversation.stage,
    objections,
    leadTemperature: score.temperature,
    leadScoreReasons: score.reasons,
    fullName: conversation.customerFullName,
    paymentStatus: mapPaymentStatus(conversation.paymentStatus),
    /*
     * `payment_status = 'paid'` jadvalga FAQAT `confirmPayment()`
     * orqali yoziladi, ya'ni u allaqachon vakolatli qaror. Shuning
     * uchun xotiraga ko'chirishda ham vakolatli deb belgilanadi —
     * aks holda `advancePaymentState()` uni rad etardi va to'lagan
     * mijoz xotirada "to'lamagan" bo'lib qolardi.
     */
    paymentAuthorized:
      conversation.paymentStatus === "paid" || conversation.paymentStatus === "confirmed",
    intakeStatus: conversation.intakeId ? "link_sent" : undefined,
    pendingQuestion:
      minedQuestion && input.text
        ? {
            // XOM MATN EMAS: xotira modelga boradi, shuning uchun
            // undagi telefon/karta redaksiyadan o'tishi shart (32-band).
            text: redactPii(input.text).text.slice(0, 200),
            askedAt: new Date().toISOString(),
            intentKey: minedQuestion.intentKey,
          }
        : undefined,
  });

  /* --------------------------- niyat aniqlash --------------------------- */
  let intent: ReplyIntent;
  /*
   * BIRIKMA — SO'ROQSIZ CHEK EMAS (master spec 6-band).
   *
   * Webhook allaqachon tasniflagan; bu yerda xuddi shu qoida
   * qo'llanadi, ya'ni ikkala yo'l bir xil qaror qabul qiladi.
   * Portret yuborgan mijozni to'lov bosqichiga surish — voronkani
   * buzadi va mijozga to'lov kelgandek javob berilishiga olib keladi.
   */
  if (isPaymentEvidenceType(input.messageType)) {
    const attachment = classifyAttachment({
      messageType: input.messageType,
      caption: input.text,
      stage: conversation.stage,
      paymentStatus: conversation.paymentStatus,
    });
    result.notes.push(`birikma: ${attachment.kind} (${attachment.reason})`);
    intent = attachment.treatAsPayment ? "payment_evidence" : "other";
  } else if (conversation.stage === "need_full_name") {
    // Bu bosqichda har qanday matn F.I.Sh. bo'lishga da'vogar.
    intent = validateFullName(input.text).ok ? "full_name" : "other";
  } else {
    intent = classifyReply(input.text).intent;
  }
  result.intent = intent;

  /* ---------------------------- o‘tish qidirish -------------------------- */
  const transition = resolveTransition(
    conversation.stage,
    intent,
    conversation.entry,
    conversation.referralSource != null,
  );

  if (!transition) {
    // Ssenariyda javobi yo'q — bilim bazasidan javob beramiz.
    //
    // `other` HAM shu yerga tushadi, ataylab: e'tiroz ("qimmat ekan")
    // savol belgisisiz yoziladi va `question` deb tasniflanmaydi. Uni
    // chetlab o'tsak, mijoz e'tiroz bildirganda JIM QOLARDIK — sotuv
    // suhbatida eng yomon javob shu. Bilim topilmasa baribir jim
    // qolamiz, lekin bu endi "bilmayman" qarori, "qaramadim" emas.
    if (TERMINAL_STAGES.includes(conversation.stage)) {
      /*
       * SSENARIY TUGAGAN, LEKIN MIJOZ YOZDI.
       *
       * Ilgari bu yerda jim qolinardi. To'lagan odam "rahmat" yoki
       * "qachon chiqadi?" deb yozsa javobsiz qolardi — bu xizmat
       * ko'rsatishning eng yomon nuqtasi, chunki u allaqachon pul
       * to'lagan. Endi bilim bazasidan javob beriladi; u ham
       * bo'lmasa — fallback.
       */
      await answerFromKnowledge(context, input.text ?? "", "terminal_stage");
    } else {
      await answerFromKnowledge(context, input.text ?? "", "no_transition");
    }
    return result;
  }

  // IDEMPOTENTLIK: bosqich faqat OLDINGA suriladi.
  //
  // ISTISNO — o'z-o'ziga qaytish. `need_full_name -> need_full_name`
  // bosqich sakrashi emas, QAYTA SO'RASH ("To'liq F.I.Sh.ingizni yozib
  // yuboring"). Uni bloklasak, mijoz bitta so'z yuborganda javobsiz
  // qolardi va ssenariy shu yerda to'xtab qolardi.
  const isRePrompt = transition.to === conversation.stage;
  if (!isRePrompt && !isForwardTransition(conversation.stage, transition.to)) {
    result.notes.push("bosqich allaqachon o‘tilgan — takroriy o‘tish qilinmadi");
    // Bosqich takrorlanmaydi, LEKIN mijoz javobsiz qolmaydi: u
    // nimadir yozdi va javob kutyapti (3-band).
    await answerFromKnowledge(context, input.text ?? "", "no_transition");
    return result;
  }

  /* ------------------------- maxsus qadam: anketa ------------------------ */
  let extraFields: Record<string, unknown> = {};
  let intakeLink: string | null = null;

  if (transition.action === "request_intake_link") {
    const name = validateFullName(input.text);
    if (!name.ok) {
      result.notes.push("F.I.Sh. yetarli emas — havola yaratilmadi");
      // Mijoz bitta so'z yuborgan bo'lishi mumkin — qayta so'raymiz,
      // jim qolmaymiz.
      const template = getTemplate("request_full_name_again");
      if (template) {
        await send(context, {
          body: template.body,
          kind: "template",
          templateKey: "request_full_name_again",
          expectedStages: [],
        });
      }
      return result;
    }

    const created = await createIntakeWithLink({
      fullName: name.fullName,
      gender: name.gender,
      actorId: null,
      baseUrl: await buildIntakeBaseUrl(),
      origin: "ai_sales_bot",
    });

    if (!created.ok || !created.link) {
      result.notes.push(`anketa yaratilmadi: ${created.error ?? "noma’lum xato"}`);
      // Texnik nosozlik — mijozning aybi emas va u buni bilishi shart
      // emas, lekin javobsiz ham qolmasligi kerak. Odam aralashadi.
      await sendFallback(context, "generation_failed");
      await escalateToHuman(context, "technical_failure", input.text);
      return result;
    }

    intakeLink = created.link;
    result.intakeId = created.intakeId ?? null;
    extraFields = {
      customer_full_name: name.fullName,
      intake_id: created.intakeId,
      // Xom havola SAQLANMAYDI — faqat prefiks, mavjud anketa tizimidagi kabi.
      intake_link_prefix: created.prefix,
      intake_link_expires_at: created.expiresAt,
    };
  }

  /* ---------------------------- bosqichni surish ------------------------- */
  // Qayta so'rashda bosqich o'zgarmaydi — tarixga bo'sh o'tish yozilmaydi.
  if (!isRePrompt) {
    await moveStage(conversation, transition.to, { intent, messageId: input.messageId }, extraFields);
  }
  context.stage = transition.to;
  conversation.stage = transition.to;
  result.stageAfter = transition.to;

  /* ------------------------- shablonlarni yuborish ----------------------- */
  // Havola shablondan OLDIN yuboriladi: ko'rsatma havolaga tegishli.
  const outcomes: SendOutcome[] = [];

  if (intakeLink) {
    outcomes.push(
      await send(context, {
        body: intakeLink,
        kind: "template",
        templateKey: null,
        expectedStages: [transition.to],
        // Mijoz to'liq havolani oladi; jurnalda token qolmaydi.
        logBody: redactPii(intakeLink).text,
      }),
    );
    await syncMemory(context, { intakeStatus: "link_sent" });
  }

  for (const key of transition.templates) {
    const template = getTemplate(key);
    if (!template) {
      result.notes.push(`shablon topilmadi: ${key}`);
      continue;
    }
    outcomes.push(
      await send(context, {
        body: template.body,
        kind: "template",
        templateKey: key,
        expectedStages: [transition.to],
      }),
    );
  }

  /* ------------------ YETKAZILMAGAN BOSQICH ORQAGA QAYTADI --------------- */
  /*
   * 29-BAND: "Do not falsely advance stage before delivery is known."
   *
   * Bosqich yuborishdan OLDIN suriladi — bu ataylab, chunki
   * `send()` avtorizatsiyasi yangi bosqichni kutadi. Lekin
   * Telegram ANIQ xato qaytarsa, mijoz hech narsa olmagan:
   * u hali eski bosqichda turibdi. Bosqichni oldinga qoldirish
   * suhbatni mijoz ko'rmagan holatga o'tkazardi va keyingi
   * xabari butunlay boshqa ma'noda talqin qilinardi.
   *
   * FAQAT ANIQ XATODA qaytariladi:
   *   · `refused` — biz ataylab jim qoldik, holat haqiqiy;
   *   · `unknown` — xabar yetgan bo'lishi MUMKIN, qaytarish ham,
   *     qayta yuborish ham xato bo'lardi. Qayd etiladi va odam
   *     ko'radi.
   */
  const attempted = outcomes.filter((outcome) => outcome !== "refused");
  const anyUnknown = attempted.some((outcome) => outcome === "unknown");
  /*
   * `undelivered` ham shu yerga qo'shildi. Ilgari faqat
   * `failed` qaytarardi va qamrov to'sgan suhbat bosqichi
   * oldinga surilib qolardi: jonli tizimda uchta suhbat
   * `new -> offer_sent` ga o'tgan, lekin mijozlar hech narsa
   * olmagan edi. Ro'yxat to'g'rilangandan keyin ham ular
   * salomlashuvni olmasdi — ssenariy o'rtasidan boshlanardi.
   */
  const allUndelivered =
    attempted.length > 0 &&
    attempted.every((outcome) => outcome === "failed" || outcome === "undelivered");

  if (allUndelivered && !isRePrompt) {
    await moveStage(
      { ...conversation, stage: transition.to },
      result.stageBefore,
      { intent, messageId: input.messageId },
    );
    conversation.stage = result.stageBefore;
    context.stage = result.stageBefore;
    result.stageAfter = result.stageBefore;
    result.notes.push(
      `yetkazilmadi — bosqich ${transition.to} dan ${result.stageBefore} ga qaytarildi`,
    );
    // Yetkazilmagan qadam uchun eslatma rejalashtirilmaydi: u
    // mijoz ko'rmagan xabarga javob so'ragan bo'lardi.
    return result;
  }

  if (anyUnknown) {
    result.notes.push(
      "yetkazilgani noma’lum — bosqich qoldirildi, qayta yuborilmadi, tekshiruv kerak",
    );
  }

  /* --------------------------- follow-up rejasi -------------------------- */
  if (transition.followup) {
    const minutes = followupMinutes(transition.followup.type, settings.flow, transition.followup.delayMinutes);
    const ok = await scheduleFollowup(conversation.id, {
      type: transition.followup.type,
      delayMinutes: minutes,
      expectedStage: transition.to,
    });
    if (ok) result.scheduledFollowups.push(transition.followup.type);
  }

  return result;
}

/** Kechikish sozlamadan; jadvaldagi qiymat — zaxira. */
function followupMinutes(
  type: string,
  flow: { followupOfferReviewMinutes: number; followupArticleDecisionMinutes: number; followupLaterMinutes: number },
  fallback: number,
): number {
  if (type === "offer_review") return flow.followupOfferReviewMinutes;
  if (type === "article_decision") return flow.followupArticleDecisionMinutes;
  if (type === "article_decision_later") return flow.followupLaterMinutes;
  return fallback;
}

/* --------------------------- bilim bilan javob --------------------------- */

/** Qisqa yordamchi — bu faylda Supabase klienti ko'p joyda kerak. */
function adminClient() {
  return createSupabaseAdminClient();
}

/**
 * Ssenariydan tashqari savolga javob.
 *
 * FAQAT TASDIQLANGAN bilim ishlatiladi va FAKT O'YLAB TOPILMAYDI.
 * Lekin — 3-band — JIM HAM QOLINMAYDI.
 *
 * OLDIN QANDAY EDI: bilim topilmasa yoki model raqam to'qisa,
 * funksiya `return` qilardi va mijoz javobsiz qolardi. Texnik
 * jihatdan xavfsiz, sotuvda halokatli: mijoz savol berib javob
 * olmaydi va ketadi. U bizning ehtiyotkorligimizni ko'rmaydi —
 * e'tiborsizlikni ko'radi.
 *
 * ENDI: bilim yo'q bo'lsa AI buni TAN OLADI, aniqlashtirishni
 * va'da qiladi va savol yozib qo'yiladi (`sales_knowledge_gaps`),
 * ya'ni keyingi safar javob bo'ladi.
 */
async function answerFromKnowledge(
  context: SendContext,
  question: string,
  silentReason: FallbackReason,
): Promise<void> {
  const trimmed = question.trim();

  /* ===================================================================== *
   * QATLAM 1 — BU XABAR UMUMAN SAVOLMI? (2-band)
   *
   * ILDIZ SABAB shu yerda edi: bu tekshiruv YO'Q edi. Har qanday
   * xabar to'g'ridan-to'g'ri bilim bazasiga borardi, bilim
   * topilmasdi va savol "Javobsiz savollar" ga yozilardi. Shu
   * tufayli u yerga "Hop", "Rahmat", ".", odam ismlari tushdi.
   *
   * Tasniflash SOF va ARZON: "Rahmat" uchun model chaqirilmaydi
   * (36-band).
   * ===================================================================== */
  const pendingAction = pendingActionForStage(context.stage);
  const intent = classifyMessageIntent(trimmed, {
    stage: context.stage,
    pendingUserAction: pendingAction,
    hasAttachment: isPaymentEvidenceType(context.currentMessageType),
    hasHistory:
      context.conversation.greetedAt != null || context.result.stageBefore !== "new",
  });
  context.result.notes.push(`niyat: ${intent.intent} (${intent.matched ?? "—"})`);
  context.result.messageIntent = intent.intent;

  /* --------- QATLAM 2 — oddiy muloqot: bilim ham, model ham yo'q ------- */
  if (!intent.needsKnowledge && !intent.needsSystemState) {
    const reply = buildConversationalReply({
      intent: intent.intent,
      pendingUserAction: pendingAction,
      hasHistory: context.conversation.greetedAt != null,
      alreadyGreeted: context.conversation.greetedAt != null,
    });

    if (reply) {
      await send(context, {
        body: reply,
        kind: "knowledge_reply",
        templateKey: null,
        expectedStages: [],
      });
    } else {
      // "." ga javob yozish suhbatni g'alati qiladi.
      context.result.notes.push("mazmunsiz xabar — javob yozilmadi");
    }
    return;
  }

  /* ------- QATLAM 3 — holat savoli: javob MIJOZNING yozuvidan -------- */
  if (intent.needsSystemState) {
    await answerFromSystemState(context, intent, trimmed);
    return;
  }

  /*
   * KANONIK FOYDALAR MATNI (12-band).
   *
   * Mijoz umumiy "menga nima beradi?" savolini bersa, rasmiy matn
   * AYNAN shu holida ketadi — modelga qayta yozdirilmaydi: unda
   * oferta havolasi va o'n to'rtta aniq va'da bor, va har safar
   * boshqacha yozilsa bu har safar boshqacha va'da demakdir.
   *
   * BIR MARTA. Mijoz keyin yana so'rasa, butun matn qayta kelmaydi:
   * uch yarim ming belgilik xabarni ikkinchi marta o'qish hech kim
   * qilmaydigan ish va uni yuborish "men sizni tinglamadim" degan
   * xabar beradi. O'rniga aniq savoliga qisqa javob boradi.
   */
  if (isGeneralBenefitsQuestion(trimmed)) {
    const sentSoFar = await loadRecentHistory(context.conversation.id, context.currentMessageId);
    if (!benefitsAlreadySent(sentSoFar.explainedTemplates)) {
      await send(context, {
        body: CANONICAL_BENEFITS_TEXT,
        kind: "template",
        templateKey: CANONICAL_BENEFITS_TEMPLATE_KEY,
        expectedStages: [],
      });
      return;
    }
    context.result.notes.push("kanonik foydalar allaqachon yuborilgan — qisqa javob");
  }

  /*
   * Eski `isFillerMessage` darvozasi shu yerda turardi. U yigirmata
   * aniq so'zdan iborat edi va "hop", "rahmat", "tanishib chiqdim",
   * "хоп", "." — hech birini tutmasdi. Endi uning o'rnida
   * muloqot niyati qatlami turibdi (2-band).
   */

  const timeline = await loadRecentHistory(
    context.conversation.id,
    context.currentMessageId,
    context.conversation.memory,
  );
  const history = timeline.turns;

  /*
   * SUHBAT KONTEKSTI — javobdan OLDIN quriladi (4- va 10-band).
   *
   * Ikki blok modelga qo'shiladi:
   *   · TIJORIY FAKTLAR — narx va muddat YAGONA manbadan. Bilim
   *     bazasidagi eski narx yozuvi bo'lsa ham, haqiqiy qiymat shu
   *     yerdan keladi.
   *   · ALLAQACHON AYTILGANLAR — model o'zi ham takrorlamaslikka
   *     harakat qilsin. Takror tekshiruvi shunda OXIRGI himoya bo'lib
   *     qoladi, birinchisi emas: bloklangan javob mijozni kuttiradi.
   */
  const commercialFacts = await getCommercialFacts();
  const commercial = buildCommercialBlock(commercialFacts);
  const alreadySaid = buildAlreadySaidBlock(timeline.assistantTexts);

  /*
   * SALOMLASHISH — SUHBAT HOLATI, USLUB EMAS (23-band).
   *
   * Uslub profili "salomlashish ulushi 42%" deb hisoblab, modelga
   * HAR javobda salomlashishni buyurardi. Bot jurnalidagi ketma-ket
   * besh javobning hammasi salom bilan boshlangan. Endi qaror
   * suhbat sessiyasidan chiqadi; uslub faqat QANDAY salomlashishni
   * aytadi.
   */
  const greeting = decideGreeting(
    {
      greetedAt: context.conversation.greetedAt,
      sessionStartedAt: context.conversation.greetingSessionStartedAt,
      lastCustomerMessageAt: null,
    },
    new Date(),
  );

  /*
   * TUZILMALI XOTIRA (24–26-band).
   *
   * Bu blok xabar oynasidan QAT'IY NAZAR beriladi: suhbat 100
   * xabarga yetsa ham, to'lov tasdiqlangani va javobsiz savol
   * kontekstdan chiqib ketmaydi.
   */
  const memoryBlock = buildMemoryBlock({
    memory: context.conversation.memory,
    stage: context.stage,
    summary: timeline.summary,
    greetingInstruction: greetingInstruction(greeting, null),
  });

  /*
   * IMTIYOZLI SUHBATDA NARX BLOKI MODELGA BERILMAYDI.
   *
   * Pastdagi tekshiruv narx aytilgan javobni baribir to'sadi,
   * lekin modelga narxni umuman bermaslik arzonroq: aks holda
   * har savolda javob yaratiladi, to'siladi va o'rniga boshqa
   * xabar ketadi — mijoz esa kutib turadi.
   */
  const referralConversation = context.conversation.referralSource != null;

  const extraContext = [memoryBlock, referralConversation ? "" : commercial, alreadySaid]
    .filter((block) => block !== "")
    .join("\n\n");

  /*
   * FAKT MANBALARI raqam tekshiruvi uchun. Tijoriy sozlama SHU
   * YERGA kiradi — narx bilim bazasida eskirgan bo'lsa ham,
   * joriy qiymat bloklanmasligi kerak.
   */
  const verifiedFactTexts = [commercial, ...verifiedFactTextsFrom(context.conversation.memory)];

  let reply: Awaited<ReturnType<typeof generateTestReply>>;
  try {
    reply = await generateTestReply({
      message: trimmed,
      history,
      actorId: null,
      extraContext,
      verifiedFactTexts,
    });
  } catch (err) {
    // Model yiqildi yoki timeout. Mijoz buni bilishi shart emas.
    context.result.notes.push(
      `model xatosi: ${err instanceof Error ? err.message : String(err)}`,
    );
    await sendFallback(context, "generation_failed");
    return;
  }

  if (reply.diagnostics.missingKnowledge) {
    /*
     * DARVOZA (6-band): bo'shliq YOZILISHI shart emas.
     *
     * Bu yerga faqat bilim savollari yetib keladi, lekin
     * ular ham har doim qayta ishlatiladigan bo'shliq emas.
     */
    const gap = await recordGapIfGenuine(context, intent, trimmed, reply.reply);
    context.result.notes.push("MISSING_KNOWLEDGE — fallback yuborildi");
    // Va'da FAQAT topshiriq yaratilgan bo'lsa beriladi (12-band).
    await sendFallback(context, "missing_knowledge", gap.escalated);
    return;
  }

  if (reply.diagnostics.unsupportedNumbers.length > 0) {
    context.result.notes.push(
      `javobda manbada yo‘q son (${reply.diagnostics.unsupportedNumbers.join(", ")})`,
    );
    await recordGapIfGenuine(context, intent, trimmed, reply.reply);
    await sendFallback(context, "unsupported_numbers");
    return;
  }

  const previousReplies = timeline.assistantTexts;

  const discountApproved = reply.diagnostics.sources.some((source) =>
    normalizeForMatch(`${source.title} ${source.body}`).includes("chegirma"),
  );

  const runQuality = (body: string) =>
    checkReplyQuality({
      body,
      unsupportedNumbers: reply.diagnostics.unsupportedNumbers,
      discountApproved,
      paymentStatus: context.conversation.paymentStatus,
      previousAssistantMessages: previousReplies,
    });

  let quality = runQuality(reply.reply);

  /*
   * BIR MARTA QAYTA YARATISH (31-band).
   *
   * Til yoki takror buzilgan bo'lsa, javobning MAZMUNI odatda
   * to'g'ri — faqat ifodasi xato. Bunday holatda darhol fallbackka
   * o'tish mijozga foydali javobni yo'qotardi. Shuning uchun bir
   * marta tuzatish ko'rsatmasi bilan qayta so'raymiz.
   *
   * FAQAT BIR MARTA: ikkinchi urinish ham yiqilsa, model bu savolni
   * uddalay olmayapti degani. Cheksiz urinish ham pul sarflaydi,
   * ham mijozni kuttiradi.
   */
  if (!quality.ok) {
    context.result.notes.push(`sifat darvozasi: ${quality.blocked.join(", ")}`);
    const correction = buildCorrectionInstruction(quality.blocked);
    try {
      const retry = await generateTestReply({
        message: `${trimmed}\n\n${correction}`,
        history,
        actorId: null,
        extraContext,
      });
      if (retry.diagnostics.unsupportedNumbers.length === 0) {
        const retryQuality = runQuality(retry.reply);
        if (retryQuality.ok) {
          reply = retry;
          quality = retryQuality;
          context.result.notes.push("qayta yaratish muvaffaqiyatli");
        }
      }
    } catch (err) {
      context.result.notes.push(
        `qayta yaratish yiqildi: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!quality.ok) {
    // Ikkinchi urinish ham o'tmadi. Bu javob mijozga KETMAYDI.
    await sendFallback(context, "low_confidence");
    await escalateToHuman(context, "repeated_misunderstanding", question);
    return;
  }
  if (quality.warnings.length > 0) {
    context.result.notes.push(`ogohlantirish: ${quality.warnings.join(", ")}`);
  }

  /*
   * TAKRORIY SALOMLASHISHNI OLIB TASHLASH — OXIRGI TO'SIQ (23-band).
   *
   * Promt "qayta salomlashma" deydi, lekin model ba'zan baribir
   * salom bilan boshlaydi — ayniqsa uslub namunalarida salom ko'p
   * bo'lsa. Butun javobni bloklash mazmunli javobni yo'qotardi,
   * shuning uchun faqat salom qismi kesiladi.
   */
  let body = reply.reply;
  if (!greeting.shouldGreet && startsWithGreeting(body)) {
    body = stripGreeting(body);
    context.result.notes.push("takroriy salomlashish olib tashlandi");
  }

  /*
   * OXIRGI TO'SIQ: IMTIYOZLI SUHBATDA PUL GAPI.
   *
   * Shablonlar kalit bo'yicha to'silgan, lekin bu javobni MODEL
   * yozgan va unda kalit yo'q. Bilim bazasida narx haqidagi
   * yozuvlar bor, shuning uchun savol boshqacha qo'yilsa javob
   * narxni aytib qo'yishi mumkin edi.
   *
   * Javob TASHLANADI va o'rniga tayyor matn ketadi — mijoz
   * javobsiz qolmaydi va suhbat ismga qarab davom etadi.
   */
  if (referralConversation && mentionsMoney(body)) {
    context.result.notes.push("imtiyozli suhbat: pul haqidagi javob to‘xtatildi");
    const template = getTemplate("referral_no_payment_reply");
    if (template) {
      await send(context, {
        body: template.body,
        kind: "template",
        templateKey: "referral_no_payment_reply",
        expectedStages: [],
      });
    }
    return;
  }

  const outcome = await send(context, {
    body,
    kind: "knowledge_reply",
    templateKey: null,
    // Bilim javobi har bosqichda mumkin.
    expectedStages: [],
  });
  const sent = outcome === "sent";

  // Yuborilmagan bo'lsa sabab `refusals` da — u yerda sozlama yoki
  // rollout turadi va fallback ham o'sha to'siqqa urilardi.
  if (!sent) context.result.notes.push(`bilim javobi yuborilmadi (${silentReason})`);

  /*
   * JAVOB BERILGAN SAVOL XOTIRADAN CHIQADI.
   *
   * Aks holda u "javobsiz savol" bo'lib qolardi va bot keyingi
   * javobda ham unga qaytaverardi.
   */
  if (sent) {
    const answered = mineQuestion(trimmed);
    await syncMemory(context, {
      resolvedQuestionIntent: answered?.intentKey ?? null,
      answeredTopic: answered?.intentKey ?? undefined,
    });
  }
}

/**
 * Fallback yuboradi va nechta yuborilganini hisoblaydi.
 *
 * Hisob kerak: uchinchisidan keyin AI o'zi tuzata olmasligi aniq va
 * suhbat odamga o'tadi. "Tekshirib yozaman" degan va'dani cheksiz
 * takrorlash aldashdan farq qilmaydi.
 */
async function sendFallback(
  context: SendContext,
  reason: FallbackReason,
  escalated = false,
): Promise<void> {
  const previous = await countFallbacks(context.conversation.id);
  const fallback = buildFallback({
    reason,
    stage: context.stage,
    previousFallbackCount: previous,
    isMinor: context.conversation.isMinor,
    escalated,
  });

  await send(context, {
    body: fallback.body,
    kind: "knowledge_reply",
    templateKey: `fallback:${reason}`,
    expectedStages: [],
  });

  if (fallback.requiresHuman) {
    await escalateToHuman(context, "repeated_misunderstanding", null);
  }
}

/** Shu suhbatda ilgari nechta fallback ketgan. */
async function countFallbacks(conversationId: string): Promise<number> {
  const { count } = await adminClient()
    .from("sales_outbound_log")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .like("template_key", "fallback:%");
  return count ?? 0;
}

async function countUnansweredFollowups(conversationId: string): Promise<number> {
  const { count } = await adminClient()
    .from("sales_followups")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("status", "sent");
  return count ?? 0;
}

/* ---------------------------- odamga o'tkazish --------------------------- */

/**
 * Suhbatni odamga topshiradi.
 *
 * IKKI ISH: AI shu suhbatda jim bo'ladi (`ai_enabled = false`) va
 * KOORDINATOR UCHUN XULOSA yoziladi. Xulosasiz o'tkazish odamni
 * nolga qaytaradi — u butun yozishmani o'qib chiqishi kerak bo'lardi.
 */
async function escalateToHuman(
  context: SendContext,
  trigger: HandoffTrigger,
  lastQuestion: string | null,
): Promise<void> {
  const conversation = context.conversation;
  const summary = buildHandoffSummary({
    customerName: conversation.customerFullName,
    region: null,
    stage: context.stage,
    temperature: conversation.leadTemperature,
    objections: conversation.objections,
    explained: await listExplainedTopics(conversation.id),
    lastCustomerQuestion: lastQuestion,
    trigger,
    paymentStatus: conversation.paymentStatus,
    intakeSubmitted: conversation.intakeId != null,
  });

  await adminClient()
    .from("sales_conversations")
    .update({
      ai_enabled: false,
      human_required_at: new Date().toISOString(),
      human_required_reason: trigger,
      handoff_reason: trigger,
      handoff_summary: summary,
    })
    .eq("id", conversation.id);

  conversation.aiEnabled = false;
  context.result.notes.push(`human_required: ${trigger}`);

  await logAudit({
    actorId: null,
    action: "sales.human_handoff",
    entityType: "sales_conversation",
    entityId: conversation.id,
    severity: "warning",
    metadata: { trigger, stage: context.stage },
  });
}

/** AI qaysi mavzularni allaqachon tushuntirgan — takrorlamaslik uchun. */
async function listExplainedTopics(conversationId: string): Promise<string[]> {
  const { data } = await adminClient()
    .from("sales_outbound_log")
    .select("template_key")
    .eq("conversation_id", conversationId)
    .not("template_key", "is", null)
    .limit(50);

  const keys = new Set<string>();
  for (const row of data ?? []) {
    const key = row.template_key as string | null;
    if (key && !key.startsWith("fallback:")) keys.add(key);
  }
  return [...keys];
}

/* --------------------------- bilim bo'shliqlari -------------------------- */

/**
 * HOLAT SAVOLIGA JAVOB — TASDIQLANGAN YOZUVDAN (28-band).
 *
 * "To'lovim tushdimi?" degan savolning javobi bilim bazasida
 * yo'q va bo'lishi ham kerak emas. Tizim bilsa — aytadi;
 * bilmasa — TAXMIN QILMAYDI, odamga topshiriq yaratadi.
 */
async function answerFromSystemState(
  context: SendContext,
  intent: IntentResult,
  question: string,
): Promise<void> {
  const status = answerStatusQuestion(intent.referencedObject, {
    /*
     * JADVAL USTUNI — XOTIRA EMAS.
     *
     * Xotiradagi `paymentStatus` modelning xulosasi bo'lishi
     * mumkin; jadval ustuni esa chek kelgani va admin
     * tasdiqlaganidan yoziladi (16-band).
     */
    payment: paymentStateFromColumn(context.conversation.paymentStatus),
    intakeCreated: context.conversation.intakeId != null,
    intake: context.conversation.memory.intakeStatus,
  });

  if (status.answer) {
    context.result.notes.push(`holat javobi: ${intent.referencedObject}`);
    await send(context, {
      body: status.answer,
      kind: "knowledge_reply",
      templateKey: null,
      expectedStages: [],
    });
    return;
  }

  /*
   * TASDIQLANGAN JAVOB YO'Q — ODAMGA TOPSHIRIQ.
   *
   * Bu savol bilim bo'shlig'i EMAS (7-band): javob har
   * mijozda boshqacha. Uni bilim bazasiga yozish keyingi
   * mijozga noto'g'ri javob berilishiga olib kelardi.
   */
  const category = categoryForObject(intent.referencedObject);
  const escalation = await createCaseEscalation({
    conversationId: context.conversation.id,
    messageId: context.currentMessageId,
    category,
    question,
    reason: status.reason || "mijozning holati tizimdan aniqlanmadi",
    contextSummary: `Bosqich: ${context.stage}. To'lov: ${context.conversation.paymentStatus}.`,
  });

  /*
   * VA'DA FAQAT TOPSHIRIQ YARATILGANDAN KEYIN (12-band).
   *
   * Ilgari bot har holatda "tekshirib xabar beraman" derdi va
   * orqada hech narsa yaratilmasdi — ya'ni va'da bajarilmasdi.
   */
  const body = escalation.created
    ? escalationAcknowledgement(category)
    : NO_ESCALATION_REPLY;

  context.result.notes.push(
    escalation.created
      ? `topshiriq yaratildi: ${category}${escalation.duplicate ? " (ochiq topshiriq bor edi)" : ""}`
      : "topshiriq YARATILMADI — va'da berilmadi",
  );

  await send(context, {
    body,
    kind: "knowledge_reply",
    templateKey: null,
    expectedStages: [],
  });
}

/**
 * Bo'shliqni FAQAT haqiqiy bo'lsa yozadi (6-band).
 *
 * Darvoza sof modulda; bu yerda faqat qarorning bajarilishi.
 */
async function recordGapIfGenuine(
  context: SendContext,
  intent: IntentResult,
  question: string,
  aiFallback: string | null,
): Promise<{ escalated: boolean }> {
  const gate = decideKnowledgeGap({
    intent,
    modelFoundNoKnowledge: true,
    text: question,
    // Model tarixni ko'rib turib bilim topmadi — demak suhbatda
    // ham javob yo'q edi.
    answeredInConversation: false,
  });

  context.result.notes.push(`bo‘shliq qarori: ${gate.decision} (${gate.reason})`);
  context.result.gapDecision = gate.decision;

  if (gate.decision === "none") return { escalated: false };

  if (gate.decision === "knowledge_gap") {
    await recordKnowledgeGap(context.conversation.id, question, aiFallback, intent);
  }

  /*
   * MIJOZ HAM JAVOBSIZ QOLMASLIGI KERAK.
   *
   * Bilim bo'shlig'i ro'yxati — BIZNING ichki navbatimiz; u
   * mijozga javob bermaydi. Shuning uchun haqiqiy savol
   * kelganda odam uchun ham topshiriq yaratiladi va bot
   * "yo'naltirdim" deyishga aynan shundan keyin haqli
   * bo'ladi (12-band).
   *
   * Ro'yxat shishib ketmaydi: bir suhbatda bir turdagi OCHIQ
   * topshiriq bitta bo'ladi (qisman unikal indeks).
   */
  const escalation = await createCaseEscalation({
    conversationId: context.conversation.id,
    messageId: context.currentMessageId,
    category:
      gate.decision === "knowledge_gap"
        ? "unknown_business_fact"
        : categoryForObject(intent.referencedObject),
    question,
    reason: gate.reason,
    contextSummary: `Bosqich: ${context.stage}.`,
  });

  return { escalated: escalation.created };
}

/**
 * Javobsiz qolgan savolni yozib qo'yadi (25-band).
 *
 * MODEL TAXMINI BILIM EMAS: bu yerga faqat SAVOL va AI nima
 * deganini yoziladi. Javobni odam yozadi va tasdiqlaydi.
 *
 * Bir savol — bir qator: takror kelganda `ask_count` oshadi, ya'ni
 * "eng ko'p so'ralgan javobsiz savol" degan ro'yxat o'zi paydo bo'ladi.
 */
async function recordKnowledgeGap(
  conversationId: string,
  question: string,
  aiFallback: string | null,
  intent: IntentResult,
): Promise<void> {
  /*
   * KALIT MA'NOGA KO'RA (29-band): "narxi qancha?" va "necha
   * pul?" bitta bo'shliq. Ilgari ular ikki qator bo'lardi va
   * admin bitta savolga ikki marta javob yozardi.
   */
  const normalized = buildGapKey(question, intent.intent);
  if (normalized === "") return;

  const admin = adminClient();
  const now = new Date().toISOString();

  const { data: existing } = await admin
    .from("sales_knowledge_gaps")
    .select("id, ask_count, example_contexts")
    .eq("normalized_question", normalized)
    .maybeSingle();

  if (existing) {
    const contexts = Array.isArray(existing.example_contexts)
      ? (existing.example_contexts as unknown[])
      : [];
    await admin
      .from("sales_knowledge_gaps")
      .update({
        ask_count: ((existing.ask_count as number) ?? 1) + 1,
        last_asked_at: now,
        last_conversation_id: conversationId,
        // Oxirgi 5 ta namuna yetarli: ko'proq saqlash qatorni
        // shishiradi va hech kim o'qimaydi.
        example_contexts: [
          ...contexts.slice(-4),
          { at: now, question: redactPii(question).text.slice(0, 500) },
        ],
      })
      .eq("id", existing.id as string);
    return;
  }

  /*
   * SAVOL MATNI REDAKSIYADAN O'TADI (34- va 37-band).
   *
   * Bu qator panelda ko'rinadi va admin uni bilim bazasiga
   * ko'chirishi mumkin. Mijoz savolining ichida karta yoki
   * telefon raqami bo'lsa, u global bilimga tushib ketardi.
   */
  const safeQuestion = redactPii(question).text.slice(0, 1000);

  await admin.from("sales_knowledge_gaps").insert({
    normalized_question: normalized,
    question: safeQuestion,
    // Panel qaysi niyat bilan kelganini ko'rsatadi va yangi
    // ifloslanish paydo bo'lsa darhol seziladi.
    message_intent: intent.intent,
    kind: "global",
    classification: "real_knowledge_gap",
    classification_reason: "darvozadan o‘tgan haqiqiy savol",
    classified_at: now,
    last_conversation_id: conversationId,
    ai_fallback: aiFallback?.slice(0, 1000) ?? null,
    example_contexts: [{ at: now, question: safeQuestion }],
  });
}

/**
 * Suhbat tarixi — YAGONA TIMELINE dan (master spec 1-band).
 *
 * Ilgari bu funksiya faqat `sales_messages` ni o'qirdi va AI
 * javoblari (`sales_outbound_log` da) kontekstga UMUMAN tushmasdi.
 * Natijada takror tekshiruvi bo'sh ro'yxat olardi — ya'ni u hech
 * qachon ishlamagan.
 */
async function loadRecentHistory(
  conversationId: string,
  excludeMessageId: string | null = null,
  memory: ConversationMemory | null = null,
): Promise<{
  turns: Array<{ role: "customer" | "assistant"; text: string }>;
  assistantTexts: string[];
  explainedTemplates: string[];
  /** Oynadan tashqaridagi qismning FAKTGA TAYANGAN xulosasi. */
  summary: string | null;
}> {
  const events = await loadConversationTimeline(conversationId, {
    limit: RECENT_WINDOW,
    excludeMessageId,
  });

  /*
   * AYLANMA XULOSA (25-band).
   *
   * Oyna oxirgi 12 xabar bilan chegaralangan. Undan oldingi qism
   * MODEL BILAN emas, TUZILMALI XOTIRADAN quriladi — model
   * ishlatilsa, u "mijoz qiziqqan ko'rinadi" kabi tekshirilmagan
   * gaplarni qo'shib yuborardi va ular keyingi javoblarda FAKT
   * bo'lib ishlatilardi.
   */
  const summary = memory ? buildRollingSummary({
    memory,
    summarizedMessageCount: 0,
    totalMessages: events.length,
  }).text : null;

  return {
    turns: toModelTurns(events),
    assistantTexts: assistantTexts(events),
    explainedTemplates: listExplainedTemplateKeys(events),
    summary: summary && summary.trim() !== "" ? summary : null,
  };
}

/* ============================ TASHQI HODISALAR =========================== */

/**
 * Yangi suhbat — birinchi xabar. Salomlashish ssenariyni boshlaydi.
 */
export async function startConversationFlow(input: {
  conversationId: string;
  messageId: string | null;
  simulated?: boolean;
}): Promise<FlowRunResult | null> {
  return handleIncomingMessage({
    conversationId: input.conversationId,
    messageId: input.messageId,
    text: null,
    messageType: "text",
    simulated: input.simulated,
  });
}

/**
 * Anketa to'ldirildi — mavjud anketa tizimidan keladigan signal.
 * Tasdiq + to'lov xabarlari yuboriladi.
 */
export async function onIntakeSubmitted(intakeId: string): Promise<FlowRunResult | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_conversations")
    .select("id")
    .eq("intake_id", intakeId)
    .maybeSingle();
  if (!data) return null;

  const conversationId = data.id as string;
  const token = await claimConversation(conversationId);

  /*
   * ANKETA TOPSHIRILGANDA HAM ISH YO'QOLMAYDI (27-band).
   *
   * Bu yerda ham `return null` turardi. Xavf webhook'dagidan
   * KATTAROQ: anketa topshirish paytida mijoz ko'pincha ayni
   * vaqtda yozib ham turadi, ya'ni qulf band bo'lish ehtimoli
   * yuqori. O'shanda tasdiq va to'lov so'rovi HECH QACHON
   * ketmasdi va mijoz "yubordim, javob yo'q" holatida qolardi.
   */
  if (!token) {
    try {
      await enqueueJob({
        conversationId,
        messageId: null,
        kind: "reply",
        reason: "anketa topshirildi, suhbat qulfi band edi",
      });
    } catch (err) {
      console.error("SALES_INTAKE_ENQUEUE_FAILED", {
        conversationId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }

  try {
    const conversation = await loadConversation(conversationId);
    if (!conversation) return null;

    const settings = await getSalesSettings();
    const connection = await getConnection(conversation.businessConnectionId);

    const result: FlowRunResult = {
      conversationId,
      intent: null,
      messageIntent: null,
      gapDecision: null,
      stageBefore: conversation.stage,
      stageAfter: conversation.stage,
      sent: [],
      refusals: [],
      scheduledFollowups: [],
      cancelledFollowups: await cancelPendingFollowups(conversationId, "anketa topshirildi"),
      intakeId,
      notes: [],
    };

    if (!conversation.aiEnabled) {
      result.refusals.push("human_takeover");
      return result;
    }
    if (!isForwardTransition(conversation.stage, "waiting_payment")) {
      result.notes.push("to‘lov bosqichi allaqachon o‘tilgan");
      return result;
    }

    await moveStage(conversation, "waiting_payment", { intent: null, messageId: null }, {
      payment_status: "requested",
    });
    conversation.stage = "waiting_payment";
    result.stageAfter = "waiting_payment";

    const context: SendContext = {
      conversation,
      stage: "waiting_payment",
      autoReplyEnabled: settings.flow.autoReplyEnabled,
      connectionEnabled: connection?.isEnabled ?? false,
      connectionCanReply: connection?.canReply ?? false,
      simulated: false,
      rollout: settings.rollout,
      currentMessageId: null,
      currentMessageType: "text",
      result,
    };

    for (const key of ["intake_submitted_ack", "payment_details", "payment_note"]) {
      const template = getTemplate(key);
      if (!template) continue;
      await send(context, {
        body: template.body,
        kind: "template",
        templateKey: key,
        expectedStages: ["waiting_payment"],
      });
    }

    return result;
  } finally {
    await releaseConversation(conversationId, token);
  }
}

/**
 * Admin "Ha, to'lov qildi" tugmasini bosdi.
 *
 * AI O'ZI TASDIQLAMAYDI: skrinshotga qarab to'lovni tasdiqlash pul
 * masalasi va u odam qarorida qoladi.
 */
export async function confirmPayment(input: {
  conversationId: string;
  actorId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = createSupabaseAdminClient();
  const conversation = await loadConversation(input.conversationId);
  if (!conversation) return { ok: false, error: "Suhbat topilmadi" };

  const now = new Date().toISOString();
  await moveStage(conversation, "paid", { intent: null, messageId: null, actorId: input.actorId }, {
    payment_status: "paid",
    paid_at: now,
    payment_confirmed_by: input.actorId,
  });

  await admin
    .from("sales_payment_evidence")
    .update({ confirmed_at: now, confirmed_by: input.actorId })
    .eq("conversation_id", input.conversationId)
    .is("confirmed_at", null);

  /*
   * TASDIQ XOTIRAGA HAM YOZILADI (26 va 30-band).
   *
   * Bu yagona joy — `paymentAuthorized: true` faqat shu yerdan
   * keladi. Mijozning "to'ladim" matni ham, chek skrinshoti ham
   * bu holatni bera olmaydi.
   */
  await persistMemory(
    input.conversationId,
    applyMemoryUpdate(conversation.memory, {
      paymentStatus: "confirmed",
      paymentAuthorized: true,
    }),
  );

  await logAudit({
    actorId: input.actorId,
    action: "sales.payment.confirm",
    entityType: "sales_conversation",
    entityId: input.conversationId,
    newValue: { stage: "paid" },
    severity: "warning",
  });

  return { ok: true };
}

/** Inson qo'lga oladi yoki AI'ga qaytaradi. */
export async function setHumanTakeover(input: {
  conversationId: string;
  enabled: boolean;
  actorId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sales_conversations")
    .update({
      ai_enabled: !input.enabled,
      takeover_by: input.enabled ? input.actorId : null,
      takeover_at: input.enabled ? new Date().toISOString() : null,
    })
    .eq("id", input.conversationId);
  if (error) return { ok: false, error: error.message };

  // Inson qo'lga olganda kutilayotgan follow-up ham bekor qilinadi:
  // aks holda bot uning ustidan yozib yuborardi.
  if (input.enabled) await cancelPendingFollowups(input.conversationId, "inson qo‘lga oldi");

  await logAudit({
    actorId: input.actorId,
    action: input.enabled ? "sales.takeover.human" : "sales.takeover.ai",
    entityType: "sales_conversation",
    entityId: input.conversationId,
  });

  return { ok: true };
}
