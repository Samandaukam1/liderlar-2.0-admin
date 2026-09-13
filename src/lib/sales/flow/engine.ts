import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getSiteUrl } from "@/lib/site-url";
import { createIntakeWithLink } from "@/lib/intake/intake-link-service";
import { getSalesSettings } from "../settings.ts";
import { getConnection } from "../repository.ts";
import { generateTestReply } from "../test-chat.ts";
import { sendSalesMessage } from "../telegram-sales-api.ts";
import { classifyReply, isPaymentEvidenceType } from "./classify.ts";
import { validateFullName } from "./full-name.ts";
import { authorizeOutbound, type OutboundRefusalReason } from "./outbound-guard.ts";
import { FOLLOWUP_TEMPLATES, getTemplate } from "./templates.ts";
import {
  isForwardTransition,
  isSalesStage,
  resolveTransition,
  TERMINAL_STAGES,
  type ReplyIntent,
  type SalesStage,
} from "./stages.ts";
import { detectObjections, mergeObjections } from "./objections.ts";
import { computeLeadScore, type LeadTemperature } from "./lead-score.ts";
import { detectOptOut, OPT_OUT_REPLY } from "./optout.ts";
import { detectHandoff, buildHandoffSummary, type HandoffTrigger } from "./handoff.ts";
import { detectMinor } from "./minor.ts";
import { buildFallback, isFillerMessage, type FallbackReason } from "./fallback.ts";
import { newRolloutBucket, type RolloutSettings } from "./rollout.ts";
import { normalizeForMatch } from "../text-normalize.ts";
import { buildCorrectionInstruction, checkReplyQuality } from "./reply-quality.ts";
import { buildAlreadySaidBlock } from "./repetition.ts";
import { getCommercialFacts } from "../commercial.ts";
import { buildCommercialBlock } from "../commercial-facts.ts";
import {
  benefitsAlreadySent,
  CANONICAL_BENEFITS_TEMPLATE_KEY,
  CANONICAL_BENEFITS_TEXT,
  isGeneralBenefitsQuestion,
} from "./canonical-benefits.ts";

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
}

async function loadConversation(conversationId: string): Promise<FlowConversation | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_conversations")
    .select(
      "id, business_connection_id, chat_id, sales_stage, ai_enabled, customer_full_name, " +
        "intake_id, payment_status, objections, lead_score, lead_score_reasons, " +
        "lead_temperature, opted_out_at, is_minor, rollout_bucket",
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
  };
}

/* ------------------------------- yuborish -------------------------------- */

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
  autoReplyEnabled: boolean;
  connectionEnabled: boolean;
  connectionCanReply: boolean;
  simulated: boolean;
  rollout: RolloutSettings;
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
  },
): Promise<boolean> {
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
  });

  if (!decision.allowed) {
    if (!context.result.refusals.includes(decision.reason)) {
      context.result.refusals.push(decision.reason);
    }
    return false;
  }

  let telegramMessageId: number | null = null;
  let error: string | null = null;
  try {
    const sendResult = await sendSalesMessage(decision.authorization, input.body);
    telegramMessageId = sendResult.telegramMessageId;
    if (!sendResult.ok) error = sendResult.error;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Yuborilgan (yoki urinilgan) HAR xabar jurnalga tushadi.
  const admin = createSupabaseAdminClient();
  await admin.from("sales_outbound_log").insert({
    conversation_id: context.conversation.id,
    kind: input.kind,
    template_key: input.templateKey,
    body: input.body,
    stage_before: context.result.stageBefore,
    stage_after: context.stage,
    telegram_message_id: telegramMessageId,
    simulated: decision.authorization.simulated,
    error,
  });

  if (error) {
    context.result.notes.push(`yuborilmadi: ${error}`);
    return false;
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
  }
  return true;
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
  // Qulf olinmadi — boshqa worker shu suhbat ustida ishlayapti.
  if (!token) return null;

  try {
    return await runFlow(input);
  } finally {
    await releaseConversation(input.conversationId, token);
  }
}

async function runFlow(input: HandleMessageInput): Promise<FlowRunResult | null> {
  const conversation = await loadConversation(input.conversationId);
  if (!conversation) return null;

  const settings = await getSalesSettings();
  const connection = await getConnection(conversation.businessConnectionId);
  const simulated = input.simulated === true;

  const result: FlowRunResult = {
    conversationId: conversation.id,
    intent: null,
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
    return result;
  }

  /* -------------------------- ODAMGA O'TKAZISH -------------------------- */
  const handoff = detectHandoff(input.text);
  if (handoff) {
    await escalateToHuman(context, handoff.trigger, input.text);
    result.notes.push(`odamga o‘tkazildi: ${handoff.trigger} (${handoff.matched})`);
    return result;
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

  /* --------------------------- niyat aniqlash --------------------------- */
  let intent: ReplyIntent;
  if (isPaymentEvidenceType(input.messageType)) {
    intent = "payment_evidence";
  } else if (conversation.stage === "need_full_name") {
    // Bu bosqichda har qanday matn F.I.Sh. bo'lishga da'vogar.
    intent = validateFullName(input.text).ok ? "full_name" : "other";
  } else {
    intent = classifyReply(input.text).intent;
  }
  result.intent = intent;

  /* ---------------------------- o‘tish qidirish -------------------------- */
  const transition = resolveTransition(conversation.stage, intent);

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
      baseUrl: `${getSiteUrl().replace(/\/+$/, "")}/anketa`,
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
  if (intakeLink) {
    await send(context, {
      body: intakeLink,
      kind: "template",
      templateKey: null,
      expectedStages: [transition.to],
    });
  }

  for (const key of transition.templates) {
    const template = getTemplate(key);
    if (!template) {
      result.notes.push(`shablon topilmadi: ${key}`);
      continue;
    }
    await send(context, {
      body: template.body,
      kind: "template",
      templateKey: key,
      expectedStages: [transition.to],
    });
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
    const alreadySent = await listExplainedTopics(context.conversation.id);
    if (!benefitsAlreadySent(alreadySent)) {
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

  // Matnsiz xabar (stiker, ovozli). Bilim qidirishning ma'nosi yo'q,
  // lekin javobsiz qoldirish ham mumkin emas.
  if (trimmed === "") {
    await sendFallback(context, "unclear_message");
    return;
  }

  // "xa", "ok", "hmm" — bu javob, lekin mazmunsiz. Bilim bazasiga
  // yuborish tokenni behuda sarflaydi va baribir javob topilmaydi.
  if (isFillerMessage(trimmed)) {
    await sendFallback(context, "unclear_message");
    return;
  }

  const history = await loadRecentHistory(context.conversation.id);

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
  const commercial = buildCommercialBlock(await getCommercialFacts());
  const alreadySaid = buildAlreadySaidBlock(
    history.filter((turn) => turn.role === "assistant").map((turn) => turn.text),
  );
  const extraContext = [commercial, alreadySaid].filter((block) => block !== "").join("\n\n");

  let reply: Awaited<ReturnType<typeof generateTestReply>>;
  try {
    reply = await generateTestReply({ message: trimmed, history, actorId: null, extraContext });
  } catch (err) {
    // Model yiqildi yoki timeout. Mijoz buni bilishi shart emas.
    context.result.notes.push(
      `model xatosi: ${err instanceof Error ? err.message : String(err)}`,
    );
    await sendFallback(context, "generation_failed");
    return;
  }

  if (reply.diagnostics.missingKnowledge) {
    // Savol YOZIB QO'YILADI: har javobsiz savol keyingi bilim
    // bazasining bir qatori (25-band).
    await recordKnowledgeGap(context.conversation.id, trimmed, reply.reply);
    context.result.notes.push("MISSING_KNOWLEDGE — fallback yuborildi");
    await sendFallback(context, "missing_knowledge");
    return;
  }

  if (reply.diagnostics.unsupportedNumbers.length > 0) {
    context.result.notes.push(
      `javobda manbada yo‘q son (${reply.diagnostics.unsupportedNumbers.join(", ")})`,
    );
    await recordKnowledgeGap(context.conversation.id, trimmed, reply.reply);
    await sendFallback(context, "unsupported_numbers");
    return;
  }

  const previousReplies = history
    .filter((turn) => turn.role === "assistant")
    .map((turn) => turn.text);

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

  const sent = await send(context, {
    body: reply.reply,
    kind: "knowledge_reply",
    templateKey: null,
    // Bilim javobi har bosqichda mumkin.
    expectedStages: [],
  });

  // Yuborilmagan bo'lsa sabab `refusals` da — u yerda sozlama yoki
  // rollout turadi va fallback ham o'sha to'siqqa urilardi.
  if (!sent) context.result.notes.push(`bilim javobi yuborilmadi (${silentReason})`);
}

/**
 * Fallback yuboradi va nechta yuborilganini hisoblaydi.
 *
 * Hisob kerak: uchinchisidan keyin AI o'zi tuzata olmasligi aniq va
 * suhbat odamga o'tadi. "Tekshirib yozaman" degan va'dani cheksiz
 * takrorlash aldashdan farq qilmaydi.
 */
async function sendFallback(context: SendContext, reason: FallbackReason): Promise<void> {
  const previous = await countFallbacks(context.conversation.id);
  const fallback = buildFallback({
    reason,
    stage: context.stage,
    previousFallbackCount: previous,
    isMinor: context.conversation.isMinor,
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
): Promise<void> {
  const normalized = normalizeForMatch(question).replace(/\s+/g, " ").trim().slice(0, 500);
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
        example_contexts: [...contexts.slice(-4), { at: now, question }],
      })
      .eq("id", existing.id as string);
    return;
  }

  await admin.from("sales_knowledge_gaps").insert({
    normalized_question: normalized,
    question: question.slice(0, 1000),
    last_conversation_id: conversationId,
    ai_fallback: aiFallback?.slice(0, 1000) ?? null,
    example_contexts: [{ at: now, question }],
  });
}

async function loadRecentHistory(
  conversationId: string,
): Promise<Array<{ role: "customer" | "assistant"; text: string }>> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_messages")
    .select("direction, text, sent_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .not("text", "is", null)
    .order("sent_at", { ascending: false })
    .limit(10);

  return (data ?? [])
    .reverse()
    .map((row) => ({
      role: row.direction === "incoming" ? ("customer" as const) : ("assistant" as const),
      text: (row.text as string) ?? "",
    }))
    .filter((turn) => turn.text.trim() !== "");
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
  if (!token) return null;

  try {
    const conversation = await loadConversation(conversationId);
    if (!conversation) return null;

    const settings = await getSalesSettings();
    const connection = await getConnection(conversation.businessConnectionId);

    const result: FlowRunResult = {
      conversationId,
      intent: null,
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
