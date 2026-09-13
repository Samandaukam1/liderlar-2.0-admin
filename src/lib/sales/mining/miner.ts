import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redactPii } from "../redact.ts";
import { detectObjections } from "../flow/objections.ts";
import { mineQuestions } from "./question-mining.ts";
import { clusterQuestions, type QuestionOccurrence, type FaqCluster } from "./faq-cluster.ts";
import { clusterObjections, kindsOf, type ObjectionOccurrence, type ObjectionCluster } from "./objection-mining.ts";
import { analyzeStyleDataset, type StyleCandidate, type StyleDatasetAnalysis } from "./style-dataset.ts";
import {
  cursorAdvanced,
  estimateEta,
  evaluateCoverage,
  EMPTY_COUNTERS,
  nextCursor,
  type CoverageCounters,
  type Cursor,
  type FailedBatch,
} from "./coverage.ts";

/**
 * SAHIFALANGAN SUHBAT QAZISH.
 *
 * ── NEGA QAYTA YOZILDI ───────────────────────────────────────────
 *
 * Mavjud `deep-learning.ts` ikki sababga ko'ra butun tarixni
 * qoplay olmaydi:
 *
 *   1. `selectLatestConversations(limit)` — BITTA `.limit()`.
 *      Oxirgi N suhbat olinadi va qolgani ko'rinmaydi, lekin
 *      hisobot buni aytmaydi.
 *   2. Har batch uchun MODEL chaqiriladi. 777 suhbat × model
 *      chaqiruvi — sekin, qimmat va nodeterministik.
 *
 * BU MODUL BOSHQACHA:
 *   · KEYSET sahifalash — chegara yo'q, butun tarix ko'riladi;
 *   · DETERMINISTIK qoidalar — model chaqirilmaydi, ya'ni
 *     sanoqlar bugun ham, ertaga ham bir xil;
 *   · har batchdan keyin CHECKPOINT — uzilgan yugurish yo'qolmaydi;
 *   · xabarlar SUHBAT-SUHBAT o'qiladi, 20 000 tasi bir vaqtda
 *     xotiraga OLINMAYDI.
 *
 * Model keyinroq, faqat NOMA'LUM klasterlarni nomlash uchun
 * ishlatilishi mumkin — sanoq esa har doim shu yerdan chiqadi.
 */

/** Bitta sahifada nechta suhbat. */
const DEFAULT_BATCH_SIZE = 50;
/** Bitta chaqiruvda qancha ishlash mumkin (serverless limitidan pastroq). */
const DEFAULT_TIME_BUDGET_MS = 45_000;
/** Bitta suhbatdan olinadigan eng ko'p xabar. */
const MAX_MESSAGES_PER_CONVERSATION = 2000;

export interface MinerOptions {
  runId: string;
  batchSize?: number;
  timeBudgetMs?: number;
  /** Inkremental yugurish: shu vaqtdan keyingi xabarlar. */
  watermarkAt?: string | null;
  now?: Date;
}

export interface MinerProgress {
  counters: CoverageCounters;
  cursor: Cursor | null;
  exhausted: boolean;
  failedBatches: FailedBatch[];
  batchesProcessed: number;
  elapsedMs: number;
}

interface ConversationRow {
  id: string;
  lastMessageAt: string | null;
  messageCount: number;
}

/**
 * Bazadagi JAMI suhbat — progressning halol maxraji.
 *
 * `head: true` bilan: qatorlar olinmaydi, faqat sanoq. Bu
 * 777 qatorni tarmoqdan tortmaslik uchun.
 */
export async function countConversations(watermarkAt?: string | null): Promise<number> {
  const admin = createSupabaseAdminClient();
  let query = admin.from("sales_conversations").select("id", { count: "exact", head: true });
  if (watermarkAt) query = query.gt("last_message_at", watermarkAt);
  const { count } = await query;
  return count ?? 0;
}

export async function countMessages(watermarkAt?: string | null): Promise<number> {
  const admin = createSupabaseAdminClient();
  let query = admin.from("sales_messages").select("id", { count: "exact", head: true });
  if (watermarkAt) query = query.gt("sent_at", watermarkAt);
  const { count } = await query;
  return count ?? 0;
}

/**
 * Kursordan keyingi bir sahifa suhbat.
 *
 * Tartib `(last_message_at asc, id asc)` — O'SISH bo'yicha,
 * chunki keyset kursori faqat monoton tartibda ishlaydi.
 * Eskidan yangiga yurish inkremental yugurish bilan ham
 * mos keladi: watermark har doim oxirgi ko'rilgan vaqt.
 */
async function fetchConversationPage(
  cursor: Cursor | null,
  limit: number,
  watermarkAt?: string | null,
): Promise<ConversationRow[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("sales_conversations")
    .select("id, last_message_at, message_count")
    .order("last_message_at", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (watermarkAt) query = query.gt("last_message_at", watermarkAt);

  if (cursor?.lastMessageAt && cursor.conversationId) {
    /*
     * KEYSET SHARTI: (last_message_at, id) > (kursor).
     *
     * PostgREST'da qo'shma taqqoslash yo'q, shuning uchun u
     * MANTIQIY ochib yoziladi:
     *   last_message_at > X  YOKI  (last_message_at = X VA id > Y)
     *
     * Ikkinchi shart SHART: bir necha suhbatning vaqti bir xil
     * bo'lsa (ommaviy import), faqat `>` bilan sahifalash
     * o'sha guruhni butunlay tashlab ketardi.
     */
    query = query.or(
      `last_message_at.gt.${cursor.lastMessageAt},` +
        `and(last_message_at.eq.${cursor.lastMessageAt},id.gt.${cursor.conversationId})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    messageCount: (row.message_count as number) ?? 0,
  }));
}

interface MessageRow {
  id: string;
  conversationId: string;
  direction: string;
  messageType: string;
  text: string | null;
  sentAt: string;
  deletedAt: string | null;
  telegramMessageId: number | null;
}

/** Bir sahifadagi suhbatlarning xabarlari — bitta so'rovda (N+1 emas). */
async function fetchMessagesFor(
  conversationIds: readonly string[],
  watermarkAt?: string | null,
): Promise<Map<string, MessageRow[]>> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("sales_messages")
    .select("id, conversation_id, direction, message_type, text, sent_at, deleted_at, telegram_message_id")
    .in("conversation_id", [...conversationIds])
    .order("sent_at", { ascending: true });

  if (watermarkAt) query = query.gt("sent_at", watermarkAt);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const map = new Map<string, MessageRow[]>();
  for (const row of data ?? []) {
    const conversationId = row.conversation_id as string;
    const list = map.get(conversationId) ?? [];
    if (list.length >= MAX_MESSAGES_PER_CONVERSATION) continue;
    list.push({
      id: row.id as string,
      conversationId,
      direction: row.direction as string,
      messageType: (row.message_type as string) ?? "text",
      text: (row.text as string | null) ?? null,
      sentAt: row.sent_at as string,
      deletedAt: (row.deleted_at as string | null) ?? null,
      telegramMessageId: (row.telegram_message_id as number | null) ?? null,
    });
    map.set(conversationId, list);
  }
  return map;
}

/** Bot yuborgan xabarlar — uslub datasetidan chiqarish uchun. */
async function fetchAiTelegramIds(
  conversationIds: readonly string[],
): Promise<Set<number>> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sales_outbound_log")
    .select("telegram_message_id")
    .in("conversation_id", [...conversationIds])
    .not("telegram_message_id", "is", null);

  const ids = new Set<number>();
  for (const row of data ?? []) {
    const id = row.telegram_message_id as number | null;
    if (id != null) ids.add(id);
  }
  return ids;
}

export interface MiningHarvest {
  questions: QuestionOccurrence[];
  objections: ObjectionOccurrence[];
  styleCandidates: StyleCandidate[];
}

/**
 * Bitta sahifani qazadi.
 *
 * SOF EMAS (bazaga boradi), lekin ichidagi HAR QAROR sof
 * modullardan keladi — shuning uchun natija testda qoplanadi.
 */
async function mineBatch(
  conversations: readonly ConversationRow[],
  counters: CoverageCounters,
  harvest: MiningHarvest,
  watermarkAt?: string | null,
): Promise<void> {
  const ids = conversations.map((conversation) => conversation.id);
  const [messagesByConversation, aiTelegramIds] = await Promise.all([
    fetchMessagesFor(ids, watermarkAt),
    fetchAiTelegramIds(ids),
  ]);

  for (const conversation of conversations) {
    const messages = messagesByConversation.get(conversation.id) ?? [];
    counters.messagesDiscovered += messages.length;

    for (const message of messages) {
      // --- vaqt oralig'i ---
      if (!counters.earliestMessageAt || message.sentAt < counters.earliestMessageAt) {
        counters.earliestMessageAt = message.sentAt;
      }
      if (!counters.latestMessageAt || message.sentAt > counters.latestMessageAt) {
        counters.latestMessageAt = message.sentAt;
      }

      // --- O'CHIRILGAN: sanaladi, LEKIN o'rganilmaydi ---
      // Mijoz uni ataylab olib tashlagan; qazish uni tiriltirmasligi kerak.
      if (message.deletedAt) {
        counters.deleted += 1;
        counters.skipped += 1;
        continue;
      }

      const text = (message.text ?? "").trim();
      if (text === "") {
        // Matnsiz media: qamrovda KO'RINADI, lekin tahlil qilinmaydi.
        // Rasm ichidagi mazmun o'qilmaydi va shunday deb aytiladi.
        counters.mediaOnly += 1;
        counters.skipped += 1;
        counters.messagesProcessed += 1;
        continue;
      }

      counters.messagesProcessed += 1;

      /*
       * KELIB CHIQISH.
       *
       * Chiquvchi xabar — sotuvchi TELEFONIDAN yozilgan (inson)
       * yoki botning Telegram orqali qaytgan echo'si. Ikkinchisi
       * `sales_outbound_log` dagi telegram identifikatori bo'yicha
       * ajratiladi. Bu farq USLUB O'RGANISH uchun hal qiluvchi:
       * bot o'z javobini namuna qilib olmasligi kerak (19-band).
       */
      const isAiEcho =
        message.telegramMessageId != null && aiTelegramIds.has(message.telegramMessageId);

      if (message.direction === "incoming") {
        counters.incoming += 1;

        // REDAKSIYA QAZISHDAN OLDIN (8-band): saqlanadigan har bir
        // variant allaqachon tozalangan bo'ladi.
        const redacted = redactPii(text).text;

        for (const mined of mineQuestions(text)) {
          harvest.questions.push({
            mined,
            conversationId: conversation.id,
            messageId: message.id,
            redactedText: redacted,
            askedAt: message.sentAt,
          });
        }

        const detected = detectObjections(text);
        if (detected.length > 0) {
          harvest.objections.push({
            kinds: kindsOf(detected),
            conversationId: conversation.id,
            messageId: message.id,
            redactedText: redacted,
            seenAt: message.sentAt,
          });
        }
        continue;
      }

      // --- chiquvchi ---
      if (isAiEcho) counters.aiOutbound += 1;
      else counters.humanOutbound += 1;

      harvest.styleCandidates.push({
        text,
        sentAt: message.sentAt,
        origin: isAiEcho ? "ai" : "human",
        conversationId: conversation.id,
        delivered: true,
        deleted: false,
        simulated: false,
      });
    }

    counters.conversationsProcessed += 1;
  }
}

export interface MiningResult {
  progress: MinerProgress;
  faqClusters: FaqCluster[];
  objectionClusters: ObjectionCluster[];
  style: StyleDatasetAnalysis;
  coverage: ReturnType<typeof evaluateCoverage>;
  eta: ReturnType<typeof estimateEta>;
}

/**
 * Qazishni bajaradi — vaqt byudjeti tugaguncha yoki tarix
 * tugaguncha.
 *
 * NATIJA HAR DOIM QAYTADI, hatto yarmida to'xtasa ham. Qamrov
 * `partial` bo'ladi va kursor saqlanadi: keyingi chaqiruv
 * o'sha yerdan davom etadi.
 */
export async function runMiningPass(options: MinerOptions): Promise<MiningResult> {
  const startedAt = Date.now();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const timeBudget = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;

  const counters: CoverageCounters = { ...EMPTY_COUNTERS };
  const harvest: MiningHarvest = { questions: [], objections: [], styleCandidates: [] };
  const failedBatches: FailedBatch[] = [];

  counters.conversationsDiscovered = await countConversations(options.watermarkAt);

  let cursor: Cursor | null = null;
  let exhausted = false;
  let batchIndex = 0;

  while (Date.now() - startedAt < timeBudget) {
    let page: ConversationRow[];
    try {
      page = await fetchConversationPage(cursor, batchSize, options.watermarkAt);
    } catch (err) {
      failedBatches.push({
        batchIndex,
        reason: `sahifa o‘qilmadi: ${err instanceof Error ? err.message : String(err)}`,
        conversationIds: [],
      });
      // Sahifani o'qib bo'lmasa davom etishning ma'nosi yo'q:
      // kursor siljimaydi va sikl cheksiz aylanardi.
      break;
    }

    if (page.length === 0) {
      exhausted = true;
      break;
    }

    try {
      await mineBatch(page, counters, harvest, options.watermarkAt);
    } catch (err) {
      /*
       * BATCH XATOSI YUGURISHNI TO'XTATMAYDI, LEKIN YASHIRILMAYDI.
       *
       * Qolgan suhbatlar ishlanadi; xato batch esa qamrovni
       * `partial` qiladi va hisobotda ro'yxatga tushadi.
       */
      failedBatches.push({
        batchIndex,
        reason: err instanceof Error ? err.message : String(err),
        conversationIds: page.map((row) => row.id),
      });
    }

    const advanced = nextCursor(page);
    if (!cursorAdvanced(cursor, advanced)) {
      // Kursor siljimadi — bu mantiqiy xato bo'lardi. To'xtaymiz,
      // aks holda bir sahifa cheksiz qayta ishlanardi.
      failedBatches.push({
        batchIndex,
        reason: "kursor siljimadi — sahifalash to‘xtatildi",
        conversationIds: [],
      });
      break;
    }
    cursor = advanced;
    batchIndex += 1;

    // To'liq bo'lmagan sahifa — oxiriga yetdik.
    if (page.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  const elapsedMs = Date.now() - startedAt;

  return {
    progress: {
      counters,
      cursor,
      exhausted,
      failedBatches,
      batchesProcessed: batchIndex,
      elapsedMs,
    },
    faqClusters: clusterQuestions(harvest.questions),
    objectionClusters: clusterObjections(harvest.objections),
    style: analyzeStyleDataset(harvest.styleCandidates),
    coverage: evaluateCoverage({ counters, failedBatches, exhausted }),
    eta: estimateEta({
      processed: counters.conversationsProcessed,
      total: counters.conversationsDiscovered,
      elapsedMs,
    }),
  };
}
