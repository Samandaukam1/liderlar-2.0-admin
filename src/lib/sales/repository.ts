import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  shouldApplyMessage,
  type ParsedBusinessMessage,
  type ParsedConnection,
  type ParsedDeletion,
} from "./update-parser.ts";
import { computeLearningProgress, type LearningProgress } from "./progress.ts";
import type { KnowledgeCategory, KnowledgeStatus, LearningStatus } from "./types.ts";

/**
 * AI Sotuv ma'lumot qatlami.
 *
 * Har bir select ustunlarini ochiq sanaydi: `sales_messages.text` — xom
 * yozishma va u faqat kerak bo'lgan joyda o'qiladi, ro'yxat sahifasiga
 * `select *` orqali sudralib kelmaydi.
 */

/* ------------------------------ ulanishlar ------------------------------ */

export async function upsertBusinessConnection(
  parsed: ParsedConnection,
): Promise<{ id: string } | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_business_connections")
    .upsert(
      {
        telegram_connection_id: parsed.telegramConnectionId,
        owner_telegram_user_id: parsed.ownerTelegramUserId,
        owner_username: parsed.ownerUsername,
        is_enabled: parsed.isEnabled,
        can_reply: parsed.canReply,
        connected_at: parsed.connectedAt,
        // Ulanish uzilganda vaqti qayd etiladi, yozuvning o'zi qolaveradi:
        // unga bog'langan suhbatlar yo'qolmasligi kerak.
        disconnected_at: parsed.isEnabled ? null : new Date().toISOString(),
      },
      { onConflict: "telegram_connection_id" },
    )
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? { id: data.id as string } : null;
}

export interface ConnectionRecord {
  id: string;
  telegramConnectionId: string;
  ownerTelegramUserId: number | null;
  ownerUsername: string | null;
  isEnabled: boolean;
  canReply: boolean;
  connectedAt: string | null;
}

export async function getConnection(
  telegramConnectionId: string,
): Promise<ConnectionRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_business_connections")
    .select(
      "id, telegram_connection_id, owner_telegram_user_id, owner_username, is_enabled, can_reply, connected_at",
    )
    .eq("telegram_connection_id", telegramConnectionId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    telegramConnectionId: data.telegram_connection_id as string,
    ownerTelegramUserId: (data.owner_telegram_user_id as number | null) ?? null,
    ownerUsername: (data.owner_username as string | null) ?? null,
    isEnabled: Boolean(data.is_enabled),
    canReply: Boolean(data.can_reply),
    connectedAt: (data.connected_at as string | null) ?? null,
  };
}

export async function listConnections(): Promise<ConnectionRecord[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_business_connections")
    .select(
      "id, telegram_connection_id, owner_telegram_user_id, owner_username, is_enabled, can_reply, connected_at",
    )
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id as string,
    telegramConnectionId: row.telegram_connection_id as string,
    ownerTelegramUserId: (row.owner_telegram_user_id as number | null) ?? null,
    ownerUsername: (row.owner_username as string | null) ?? null,
    isEnabled: Boolean(row.is_enabled),
    canReply: Boolean(row.can_reply),
    connectedAt: (row.connected_at as string | null) ?? null,
  }));
}

/* ------------------------------- ingestion ------------------------------ */

export interface IngestResult {
  /** Yangi xabar yozildimi. `false` — takror yoki eskirgan tahrir. */
  stored: boolean;
  duplicate: boolean;
  conversationId: string | null;
}

/**
 * Bitta business xabarni saqlaydi.
 *
 * TAKRORLANISHDAN HIMOYA IKKI QAVAT:
 *   1) baza darajasida — `uq_sales_messages_tg` unikal indeksi;
 *   2) kod darajasida — mavjud yozuv o'qiladi va `shouldApplyMessage`
 *      qaroriga ko'ra tahrir qayta yozilishi mumkin, oddiy takror esa yo'q.
 * Ikkinchisi tahrirni to'g'ri qo'llash uchun kerak: faqat unikal indeksga
 * tayansak, tahrirlangan matn hech qachon yangilanmasdi.
 */
export async function ingestBusinessMessage(
  message: ParsedBusinessMessage,
  options: { edited: boolean },
): Promise<IngestResult> {
  const admin = createSupabaseAdminClient();

  const connection = await getConnection(message.businessConnectionId);

  // --- mijoz ---
  let contactId: string | null = null;
  if (message.contact) {
    const nowIso = new Date().toISOString();
    const { data: contact } = await admin
      .from("sales_contacts")
      .upsert(
        {
          telegram_user_id: message.contact.telegramUserId,
          username: message.contact.username,
          first_name: message.contact.firstName,
          last_name: message.contact.lastName,
          language_code: message.contact.languageCode,
          is_bot: message.contact.isBot,
          last_seen_at: nowIso,
        },
        { onConflict: "telegram_user_id" },
      )
      .select("id")
      .maybeSingle();
    contactId = (contact?.id as string) ?? null;
  }

  // --- suhbat ---
  // MUHIM: `upsert` konfliktda FAQAT berilgan ustunlarni yangilaydi.
  // Shuning uchun null qiymatlar yuborilmaydi — aks holda ikkinchi xabar
  // mavjud `contact_id` ni null qilib qo'yardi. `source` esa umuman
  // yuborilmaydi: u ustun defaultidan (insert paytida) keladi va import
  // qilingan suhbat keyinchalik "telegram_business" ga aylanib ketmaydi.
  const conversationRow: Record<string, unknown> = {
    business_connection_id: message.businessConnectionId,
    chat_id: message.chatId,
  };
  if (connection?.id) conversationRow.connection_id = connection.id;
  if (contactId) conversationRow.contact_id = contactId;
  if (message.chatTitle) conversationRow.chat_title = message.chatTitle;

  const { data: conversation, error: conversationError } = await admin
    .from("sales_conversations")
    .upsert(conversationRow, { onConflict: "business_connection_id,chat_id" })
    .select("id, first_message_at, last_message_at, learning_status")
    .maybeSingle();

  if (conversationError) throw new Error(conversationError.message);
  if (!conversation) return { stored: false, duplicate: false, conversationId: null };
  const conversationId = conversation.id as string;

  // --- takror tekshiruvi ---
  const { data: existing } = await admin
    .from("sales_messages")
    .select("id, edited_at, deleted_at")
    .eq("business_connection_id", message.businessConnectionId)
    .eq("chat_id", message.chatId)
    .eq("telegram_message_id", message.telegramMessageId)
    .maybeSingle();

  const apply = shouldApplyMessage(
    { edited: options.edited, editedAt: message.editedAt },
    existing
      ? {
          editedAt: (existing.edited_at as string | null) ?? null,
          deletedAt: (existing.deleted_at as string | null) ?? null,
        }
      : null,
  );

  if (!apply) {
    return { stored: false, duplicate: existing != null, conversationId };
  }

  const row = {
    conversation_id: conversationId,
    telegram_message_id: message.telegramMessageId,
    business_connection_id: message.businessConnectionId,
    chat_id: message.chatId,
    telegram_user_id: message.fromTelegramUserId,
    username: message.fromUsername,
    direction: message.direction,
    message_type: message.messageType,
    text: message.text,
    sent_at: message.sentAt,
    edited_at: message.editedAt,
    metadata: message.metadata,
  };

  const { error: messageError } = await admin
    .from("sales_messages")
    .upsert(row, { onConflict: "business_connection_id,chat_id,telegram_message_id" });
  if (messageError) throw new Error(messageError.message);

  await refreshConversationCounters(conversationId, {
    sentAt: message.sentAt,
    firstMessageAt: (conversation.first_message_at as string | null) ?? null,
    lastMessageAt: (conversation.last_message_at as string | null) ?? null,
    learningStatus: (conversation.learning_status as LearningStatus) ?? "pending",
  });

  return { stored: true, duplicate: existing != null, conversationId };
}

/**
 * Suhbat hisoblagichlarini qayta hisoblaydi.
 *
 * Inkrement emas, QAYTA HISOB: webhook bir vaqtda bir nechta update bilan
 * kelishi mumkin va inkrement poyga holatida adashadi. Suhbatdagi xabarlar
 * soni kichkina, shuning uchun sanash arzon.
 */
async function refreshConversationCounters(
  conversationId: string,
  context: {
    sentAt: string;
    firstMessageAt: string | null;
    lastMessageAt: string | null;
    learningStatus: LearningStatus;
  },
): Promise<void> {
  const admin = createSupabaseAdminClient();

  const [{ count: total }, { count: incoming }] = await Promise.all([
    admin
      .from("sales_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId),
    admin
      .from("sales_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("direction", "incoming"),
  ]);

  const messageCount = total ?? 0;
  const incomingCount = incoming ?? 0;

  const earliest =
    context.firstMessageAt && context.firstMessageAt < context.sentAt
      ? context.firstMessageAt
      : context.sentAt;
  const latest =
    context.lastMessageAt && context.lastMessageAt > context.sentAt
      ? context.lastMessageAt
      : context.sentAt;

  await admin
    .from("sales_conversations")
    .update({
      message_count: messageCount,
      incoming_count: incomingCount,
      outgoing_count: Math.max(0, messageCount - incomingCount),
      first_message_at: earliest,
      last_message_at: latest,
      // Suhbat o'zgardi — o'rganilgan xulosa endi to'liq emas, u qayta
      // navbatga tushadi. `skipped` ham qayta ko'riladi: qisqa suhbat
      // davom etib, o'rganishga arziydigan bo'lib qolishi mumkin.
      ...(context.learningStatus === "learned" || context.learningStatus === "skipped"
        ? { learning_status: "pending" as LearningStatus }
        : {}),
    })
    .eq("id", conversationId);
}

/** Telegram'da o'chirilgan xabarlarni belgilaydi. Yozuv o'chirilmaydi. */
export async function markMessagesDeleted(deletion: ParsedDeletion): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("business_connection_id", deletion.businessConnectionId)
    .eq("chat_id", deletion.chatId)
    .in("telegram_message_id", deletion.telegramMessageIds)
    .is("deleted_at", null)
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/* ------------------------------- dashboard ------------------------------ */

export interface SalesDashboardStats {
  conversations: number;
  newConversations7d: number;
  messages: number;
  incomingMessages: number;
  outgoingMessages: number;
  contacts: number;
  progress: LearningProgress;
  knowledgeTotal: number;
  knowledgeDraft: number;
  knowledgeApproved: number;
  lastLearningRunAt: string | null;
  lastLearningStatus: string | null;
  activeConnections: number;
  styleComputedAt: string | null;
}

/**
 * `count: exact, head: true` bilan sanash — qatorlar tarmoqqa chiqmaydi.
 * Filtrlar ro'yxat sifatida beriladi, shunda har bir sanash uchun alohida
 * yordamchi yozish shart emas.
 */
async function countRows(
  table: string,
  filters: ReadonlyArray<readonly ["eq" | "gte", string, string | boolean]> = [],
): Promise<number> {
  const admin = createSupabaseAdminClient();
  let query = admin.from(table).select("id", { count: "exact", head: true });
  for (const [op, column, value] of filters) {
    query = op === "eq" ? query.eq(column, value) : query.gte(column, value as string);
  }
  const { count } = await query;
  return count ?? 0;
}

const CONVERSATION_STATUSES = ["learned", "pending", "learning", "failed", "skipped"] as const;

export async function getSalesDashboardStats(): Promise<SalesDashboardStats> {
  const admin = createSupabaseAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    conversations,
    newConversations7d,
    messages,
    incomingMessages,
    contacts,
    statusCounts,
    knowledgeTotal,
    knowledgeDraft,
    knowledgeApproved,
    activeConnections,
    lastJob,
    style,
  ] = await Promise.all([
    countRows("sales_conversations"),
    countRows("sales_conversations", [["gte", "created_at", sevenDaysAgo]]),
    countRows("sales_messages"),
    countRows("sales_messages", [["eq", "direction", "incoming"]]),
    countRows("sales_contacts"),
    Promise.all(
      CONVERSATION_STATUSES.map((status) =>
        countRows("sales_conversations", [["eq", "learning_status", status]]),
      ),
    ),
    countRows("sales_knowledge"),
    countRows("sales_knowledge", [["eq", "status", "draft"]]),
    countRows("sales_knowledge", [["eq", "status", "approved"]]),
    countRows("sales_business_connections", [["eq", "is_enabled", true]]),
    admin
      .from("sales_learning_jobs")
      .select("id, status, finished_at, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("sales_style_profiles")
      .select("computed_at")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const [learned, pending, learning, failed, skipped] = statusCounts;

  return {
    conversations,
    newConversations7d,
    messages,
    incomingMessages,
    outgoingMessages: Math.max(0, messages - incomingMessages),
    contacts,
    progress: computeLearningProgress({
      total: conversations,
      learned,
      pending,
      learning,
      failed,
      skipped,
    }),
    knowledgeTotal,
    knowledgeDraft,
    knowledgeApproved,
    activeConnections,
    lastLearningRunAt:
      (lastJob.data?.finished_at as string | null) ??
      (lastJob.data?.created_at as string | null) ??
      null,
    lastLearningStatus: (lastJob.data?.status as string | null) ?? null,
    styleComputedAt: (style.data?.computed_at as string | null) ?? null,
  };
}

/* ------------------------------- suhbatlar ------------------------------ */

export interface ConversationListItem {
  id: string;
  chatId: number;
  contactName: string;
  contactUsername: string | null;
  messageCount: number;
  incomingCount: number;
  outgoingCount: number;
  lastMessageAt: string | null;
  learningStatus: LearningStatus;
  learnedAt: string | null;
}

/**
 * Qidiruv MIJOZ jadvali orqali ishlaydi.
 *
 * Sahifa ichida filtrlash oson yo'l edi, lekin u ikki narsani buzadi:
 * "Jami N ta yozuv" filtrlanmagan sonni ko'rsatib qoladi va ikkinchi
 * sahifada mos yozuv umuman topilmaydi. Shuning uchun avval mos
 * kontaktlar id'si olinadi va filtr SO'ROVNING O'ZIGA qo'yiladi — count
 * va sahifalash shunda to'g'ri chiqadi.
 */
async function conversationSearchFilter(search: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const term = `%${search}%`;

  const { data } = await admin
    .from("sales_contacts")
    .select("id")
    .or(`first_name.ilike.${term},last_name.ilike.${term},username.ilike.${term}`)
    .limit(500);

  const ids = (data ?? []).map((row) => row.id as string);
  const clauses: string[] = [];
  if (ids.length > 0) clauses.push(`contact_id.in.(${ids.join(",")})`);
  // Raqam kiritilgan bo'lsa chat id bo'yicha ham qidiriladi.
  if (/^\d+$/.test(search)) clauses.push(`chat_id.eq.${search}`);

  return clauses.length > 0 ? clauses.join(",") : null;
}

export async function listConversations(options: {
  page: number;
  pageSize: number;
  learningStatus?: LearningStatus | null;
  search?: string | null;
}): Promise<{ items: ConversationListItem[]; total: number }> {
  const admin = createSupabaseAdminClient();
  const from = (options.page - 1) * options.pageSize;

  const search = options.search?.trim();
  let filter: string | null = null;
  if (search) {
    filter = await conversationSearchFilter(search);
    // Mos kontakt ham, chat id ham yo'q — bo'sh natija (aks holda filtrsiz
    // butun ro'yxat qaytib, qidiruv ishlamayotgandek ko'rinardi).
    if (!filter) return { items: [], total: 0 };
  }

  let query = admin
    .from("sales_conversations")
    .select(
      "id, chat_id, message_count, incoming_count, outgoing_count, last_message_at, learning_status, learned_at, sales_contacts(first_name, last_name, username)",
      { count: "exact" },
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .range(from, from + options.pageSize - 1);

  if (options.learningStatus) query = query.eq("learning_status", options.learningStatus);
  if (filter) query = query.or(filter);

  const { data, count } = await query;

  const items = (data ?? []).map((row) => {
    const contact = row.sales_contacts as unknown as {
      first_name: string | null;
      last_name: string | null;
      username: string | null;
    } | null;
    const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();
    return {
      id: row.id as string,
      chatId: row.chat_id as number,
      contactName: name || (contact?.username ? `@${contact.username}` : `Chat ${row.chat_id}`),
      contactUsername: contact?.username ?? null,
      messageCount: (row.message_count as number) ?? 0,
      incomingCount: (row.incoming_count as number) ?? 0,
      outgoingCount: (row.outgoing_count as number) ?? 0,
      lastMessageAt: (row.last_message_at as string | null) ?? null,
      learningStatus: (row.learning_status as LearningStatus) ?? "pending",
      learnedAt: (row.learned_at as string | null) ?? null,
    };
  });

  return { items, total: count ?? 0 };
}

export interface ConversationDetail {
  id: string;
  chatId: number;
  businessConnectionId: string;
  contactName: string;
  contactUsername: string | null;
  learningStatus: LearningStatus;
  learnedAt: string | null;
  learningError: string | null;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messages: Array<{
    id: string;
    direction: "incoming" | "outgoing";
    messageType: string;
    text: string | null;
    sentAt: string;
    editedAt: string | null;
    deletedAt: string | null;
  }>;
}

/**
 * XOM suhbat. Faqat `sales.view` ruxsatiga ega admin chaqiradi — matn
 * redaksiya qilinmaydi, chunki bu asl yozishmaning o'zi.
 */
export async function getConversationDetail(id: string): Promise<ConversationDetail | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_conversations")
    .select(
      "id, chat_id, business_connection_id, message_count, first_message_at, last_message_at, learning_status, learned_at, learning_error, sales_contacts(first_name, last_name, username)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;

  // 500 ta xabar — bir sahifada o'qiladigan chegara. Undan uzun suhbatda
  // eng eskilari ko'rsatiladi; o'rganish esa alohida, o'z chegarasi bilan
  // (learning.ts dagi MAX_TRANSCRIPT_MESSAGES) ishlaydi.
  const { data: messages } = await admin
    .from("sales_messages")
    .select("id, direction, message_type, text, sent_at, edited_at, deleted_at")
    .eq("conversation_id", id)
    .order("sent_at", { ascending: true })
    .limit(500);

  const contact = data.sales_contacts as unknown as {
    first_name: string | null;
    last_name: string | null;
    username: string | null;
  } | null;
  const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();

  return {
    id: data.id as string,
    chatId: data.chat_id as number,
    businessConnectionId: data.business_connection_id as string,
    contactName: name || (contact?.username ? `@${contact.username}` : `Chat ${data.chat_id}`),
    contactUsername: contact?.username ?? null,
    learningStatus: (data.learning_status as LearningStatus) ?? "pending",
    learnedAt: (data.learned_at as string | null) ?? null,
    learningError: (data.learning_error as string | null) ?? null,
    messageCount: (data.message_count as number) ?? 0,
    firstMessageAt: (data.first_message_at as string | null) ?? null,
    lastMessageAt: (data.last_message_at as string | null) ?? null,
    messages: (messages ?? []).map((m) => ({
      id: m.id as string,
      direction: m.direction as "incoming" | "outgoing",
      messageType: m.message_type as string,
      text: (m.text as string | null) ?? null,
      sentAt: m.sent_at as string,
      editedAt: (m.edited_at as string | null) ?? null,
      deletedAt: (m.deleted_at as string | null) ?? null,
    })),
  };
}

/* ------------------------------ bilim bazasi ---------------------------- */

export interface KnowledgeListItem {
  id: string;
  category: KnowledgeCategory;
  question: string | null;
  answer: string;
  status: KnowledgeStatus;
  confidence: number;
  tags: string[];
  sourceConversationId: string;
  sourceMessageId: string | null;
  sourceExcerpt: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export async function listKnowledge(options: {
  page: number;
  pageSize: number;
  status?: KnowledgeStatus | null;
  category?: KnowledgeCategory | null;
  search?: string | null;
}): Promise<{ items: KnowledgeListItem[]; total: number }> {
  const admin = createSupabaseAdminClient();
  const from = (options.page - 1) * options.pageSize;

  let query = admin
    .from("sales_knowledge")
    .select(
      "id, category, question, answer, status, confidence, tags, source_conversation_id, source_message_id, source_excerpt, created_at, reviewed_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + options.pageSize - 1);

  if (options.status) query = query.eq("status", options.status);
  if (options.category) query = query.eq("category", options.category);
  if (options.search?.trim()) {
    const term = `%${options.search.trim()}%`;
    query = query.or(`question.ilike.${term},answer.ilike.${term}`);
  }

  const { data, count } = await query;

  return {
    items: (data ?? []).map((row) => ({
      id: row.id as string,
      category: row.category as KnowledgeCategory,
      question: (row.question as string | null) ?? null,
      answer: row.answer as string,
      status: row.status as KnowledgeStatus,
      confidence: Number(row.confidence ?? 0),
      tags: (row.tags as string[]) ?? [],
      sourceConversationId: row.source_conversation_id as string,
      sourceMessageId: (row.source_message_id as string | null) ?? null,
      sourceExcerpt: (row.source_excerpt as string | null) ?? null,
      createdAt: row.created_at as string,
      reviewedAt: (row.reviewed_at as string | null) ?? null,
    })),
    total: count ?? 0,
  };
}

export async function countKnowledgeByStatus(): Promise<Record<KnowledgeStatus, number>> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("sales_knowledge").select("status");
  const out: Record<KnowledgeStatus, number> = { draft: 0, approved: 0, rejected: 0 };
  for (const row of data ?? []) {
    const status = row.status as KnowledgeStatus;
    if (status in out) out[status] += 1;
  }
  return out;
}

/* ----------------------------- o'rganish jobs --------------------------- */

export interface LearningJobRow {
  id: string;
  kind: string;
  status: string;
  totalConversations: number;
  selectedConversations: number;
  processedConversations: number;
  failedConversations: number;
  knowledgeCreated: number;
  messagesAnalyzed: number;
  model: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export async function listLearningJobs(limit = 20): Promise<LearningJobRow[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_learning_jobs")
    .select(
      "id, kind, status, total_conversations, selected_conversations, processed_conversations, failed_conversations, knowledge_created, messages_analyzed, model, error, started_at, finished_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    status: row.status as string,
    totalConversations: (row.total_conversations as number) ?? 0,
    selectedConversations: (row.selected_conversations as number) ?? 0,
    processedConversations: (row.processed_conversations as number) ?? 0,
    failedConversations: (row.failed_conversations as number) ?? 0,
    knowledgeCreated: (row.knowledge_created as number) ?? 0,
    messagesAnalyzed: (row.messages_analyzed as number) ?? 0,
    model: (row.model as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/* -------------------------------- uslub --------------------------------- */

export interface StyleProfileRow {
  id: string;
  name: string;
  isActive: boolean;
  sampleConversationCount: number;
  sampleMessageCount: number;
  weightedSample: number;
  profile: Record<string, unknown>;
  recencyBuckets: unknown;
  computedAt: string;
}

export async function getActiveStyleProfile(): Promise<StyleProfileRow | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_style_profiles")
    .select(
      "id, name, is_active, sample_conversation_count, sample_message_count, weighted_sample, profile, recency_buckets, computed_at",
    )
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    isActive: Boolean(data.is_active),
    sampleConversationCount: (data.sample_conversation_count as number) ?? 0,
    sampleMessageCount: (data.sample_message_count as number) ?? 0,
    weightedSample: Number(data.weighted_sample ?? 0),
    profile: (data.profile as Record<string, unknown>) ?? {},
    recencyBuckets: data.recency_buckets,
    computedAt: data.computed_at as string,
  };
}

export async function listStyleProfiles(limit = 10): Promise<StyleProfileRow[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_style_profiles")
    .select(
      "id, name, is_active, sample_conversation_count, sample_message_count, weighted_sample, profile, recency_buckets, computed_at",
    )
    .order("computed_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    isActive: Boolean(row.is_active),
    sampleConversationCount: (row.sample_conversation_count as number) ?? 0,
    sampleMessageCount: (row.sample_message_count as number) ?? 0,
    weightedSample: Number(row.weighted_sample ?? 0),
    profile: (row.profile as Record<string, unknown>) ?? {},
    recencyBuckets: row.recency_buckets,
    computedAt: row.computed_at as string,
  }));
}
