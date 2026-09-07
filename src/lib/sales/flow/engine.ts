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
}

async function loadConversation(conversationId: string): Promise<FlowConversation | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_conversations")
    .select(
      "id, business_connection_id, chat_id, sales_stage, ai_enabled, customer_full_name, intake_id, payment_status",
    )
    .eq("id", conversationId)
    .maybeSingle();

  if (!data) return null;
  const stage = data.sales_stage as string;
  return {
    id: data.id as string,
    businessConnectionId: data.business_connection_id as string,
    chatId: data.chat_id as number,
    stage: isSalesStage(stage) ? stage : "new",
    aiEnabled: data.ai_enabled !== false,
    customerFullName: (data.customer_full_name as string | null) ?? null,
    intakeId: (data.intake_id as string | null) ?? null,
    paymentStatus: (data.payment_status as string) ?? "none",
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

  const context: SendContext = {
    conversation,
    stage: conversation.stage,
    autoReplyEnabled: settings.flow.autoReplyEnabled,
    connectionEnabled: connection?.isEnabled ?? false,
    connectionCanReply: connection?.canReply ?? false,
    simulated,
    result,
  };

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
    // Ssenariyda javobi yo'q — savol bo'lsa bilim bazasidan javob beramiz.
    if (intent === "question" || intent === "need_info") {
      await answerFromKnowledge(context, input.text ?? "");
    } else if (TERMINAL_STAGES.includes(conversation.stage)) {
      result.notes.push("ssenariy tugagan bosqich — javob berilmadi");
    } else {
      result.notes.push(`${conversation.stage} bosqichida "${intent}" uchun qadam yo‘q`);
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
    return result;
  }

  /* ------------------------- maxsus qadam: anketa ------------------------ */
  let extraFields: Record<string, unknown> = {};
  let intakeLink: string | null = null;

  if (transition.action === "request_intake_link") {
    const name = validateFullName(input.text);
    if (!name.ok) {
      result.notes.push("F.I.Sh. yetarli emas — havola yaratilmadi");
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

/**
 * Ssenariydan tashqari savolga javob.
 *
 * FAQAT TASDIQLANGAN bilim ishlatiladi (`generateTestReply` shuni
 * qiladi). Ikki holatda XABAR YUBORILMAYDI:
 *   · bilim topilmadi (MISSING_KNOWLEDGE) — fakt o'ylab topilmaydi;
 *   · javobda manbada yo'q son bor — model raqam to'qigan.
 * Ikkalasi ham suhbatda ko'rinadi va admin o'zi javob beradi.
 */
async function answerFromKnowledge(context: SendContext, question: string): Promise<void> {
  if (question.trim() === "") return;

  const history = await loadRecentHistory(context.conversation.id);
  const reply = await generateTestReply({ message: question, history, actorId: null });

  if (reply.diagnostics.missingKnowledge) {
    context.result.notes.push("MISSING_KNOWLEDGE — javob yuborilmadi");
    return;
  }
  if (reply.diagnostics.unsupportedNumbers.length > 0) {
    context.result.notes.push(
      `javobda manbada yo‘q son (${reply.diagnostics.unsupportedNumbers.join(", ")}) — yuborilmadi`,
    );
    return;
  }

  await send(context, {
    body: reply.reply,
    kind: "knowledge_reply",
    templateKey: null,
    // Bilim javobi har bosqichda mumkin.
    expectedStages: [],
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
