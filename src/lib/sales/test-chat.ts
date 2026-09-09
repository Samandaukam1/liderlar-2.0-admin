import "server-only";
import OpenAI from "openai";
import { logAudit } from "@/lib/audit";
import { resolveModel } from "@/lib/ai-models";
import {
  listApprovedKnowledge,
  listApprovedPatterns,
  getActiveStyleProfile,
} from "./repository.ts";
import { guessIntentFromText } from "./intents.ts";
import {
  computeConfidence,
  findUnsupportedNumbers,
  isMissingKnowledge,
  selectKnowledge,
  selectPatterns,
  type RetrievableKnowledge,
  type RetrievablePattern,
  type ScoredKnowledge,
} from "./retrieval.ts";
import {
  buildRetrievalQuery,
  buildTestChatMessages,
  buildTestChatSystemPrompt,
  type TestChatTurn,
} from "./test-chat-prompt.ts";
import type { StyleProfile } from "./style.ts";
import { addUsage, EMPTY_USAGE, estimateCostUsd, type TokenUsage } from "./cost.ts";

/**
 * AI SOTUVCHI SINOV OYNASI.
 *
 * MAQSAD: sotuvchini real mijozga ulashdan OLDIN admin panel ichida
 * sinash. Bu modul Telegram transportini import QILMAYDI va hech qanday
 * outbound chaqiruv qilmaydi — javob faqat admin brauzeriga qaytadi.
 * `telegram-sales-api.ts` dagi oq ro'yxat himoyasi joyida qoladi.
 *
 * FAQAT TASDIQLANGAN MATERIAL: qoralama bilim va tasdiqlanmagan javob
 * shabloni bu yerga kirmaydi (`repository.ts` dagi filtr).
 *
 * DIAGNOSTIKA HAQIQIY: "3 ta knowledge" — retrieval qaytargan real son,
 * "confidence" esa retrieval kuchidan hisoblangan qiymat. Modeldan
 * o'zini baholash so'ralmaydi.
 */

const MAX_HISTORY_TURNS = 20;
const MAX_MESSAGE_CHARS = 2000;

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY sozlanmagan — sinov chat ishlamaydi.");
  }
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

/* ------------------------------ natija shakli ---------------------------- */

export interface TestChatSource {
  id: string;
  kind: "knowledge" | "pattern";
  /** Bilim manbasi: MANUAL yoki AI. Diagnostikada ko'rsatiladi. */
  sourceType?: "manual" | "ai_extracted";
  title: string;
  body: string;
  /** Nega tanlangani yoki qanday natija bergani. */
  meta: string;
  sourceConversationId: string | null;
}

export interface TestChatDiagnostics {
  intentKey: string | null;
  intentLabel: string | null;
  intentKnown: boolean;
  knowledgeCount: number;
  patternCount: number;
  styleProfileActive: boolean;
  /**
   * Tanlangan bilimlarning manbasi. `manual` — kamida bittasi qo'lda
   * kiritilgan va u ustun turgan.
   */
  knowledgeSource: "manual" | "ai_extracted" | "mixed" | "none";
  manualKnowledgeCount: number;
  /** 0–1. Retrieval kuchidan, modeldan emas. */
  confidence: number;
  /** Tasdiqlangan material topilmadi — javobda fakt bo‘lmasligi kerak. */
  missingKnowledge: boolean;
  /**
   * Javobda manbada uchramaydigan son bor. Bo'sh bo'lmasa — model fakt
   * to'qigan va admin buni ko'rishi shart.
   */
  unsupportedNumbers: string[];
  sources: TestChatSource[];
}

export interface TestChatResult {
  reply: string;
  diagnostics: TestChatDiagnostics;
  usage: TokenUsage;
  estimatedCostUsd: number | null;
  latencyMs: number;
  model: string;
}

/* -------------------------------- generator ------------------------------ */

export async function generateTestReply(options: {
  message: string;
  history: readonly TestChatTurn[];
  actorId: string | null;
}): Promise<TestChatResult> {
  const startedAt = Date.now();
  const model = resolveModel("sales");

  const message = options.message.trim().slice(0, MAX_MESSAGE_CHARS);
  const history = options.history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
    role: turn.role,
    text: turn.text.slice(0, MAX_MESSAGE_CHARS),
  }));

  /* ----------------------------- 1. NIYAT ----------------------------- */
  // Kontekst bilan: "Qimmat ekan" o'zi mavzusiz, lekin oldingi savol
  // bilan birga e'tiroz sifatida tanilishi kerak.
  const query = buildRetrievalQuery(history, message);
  const intent = guessIntentFromText(message) ?? guessIntentFromText(query);

  /* --------------------------- 2. RETRIEVAL --------------------------- */
  const [knowledgeRows, patternRows, styleRow] = await Promise.all([
    listApprovedKnowledge(),
    listApprovedPatterns(),
    getActiveStyleProfile(),
  ]);

  const knowledgeItems: RetrievableKnowledge[] = knowledgeRows.map((row) => ({
    id: row.id,
    category: row.category,
    question: row.question,
    answer: row.answer,
    tags: row.tags,
    confidence: row.confidence,
    // Qo'lda kiritilgan bilim mos bilimlar ORASIDA birinchi turadi.
    sourceType: row.sourceType,
    priority: row.priority,
  }));

  const patternItems: RetrievablePattern[] = patternRows.map((row) => ({
    id: row.id,
    intentKey: row.intentKey,
    intentLabel: row.intentLabel,
    customerExample: row.customerExample,
    responseExample: row.responseExample,
    frequency: row.frequency,
    successCount: row.successCount,
    successRate: row.successRate,
  }));

  const selection = selectKnowledge(knowledgeItems, {
    query,
    intentKey: intent?.key ?? null,
  });
  const patterns = selectPatterns(patternItems, { intentKey: intent?.key ?? null });
  const missingKnowledge = isMissingKnowledge(selection.items, patterns);

  const style = (styleRow?.profile as unknown as StyleProfile | undefined) ?? null;

  /* ---------------------------- 3. JAVOB ------------------------------ */
  const systemPrompt = buildTestChatSystemPrompt({
    knowledge: selection.items,
    patterns,
    style,
    missingKnowledge,
  });

  const completion = await getOpenAI().chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...buildTestChatMessages(history, message),
    ],
  });

  const reply = completion.choices[0]?.message?.content?.trim() ?? "";
  const usage = addUsage(EMPTY_USAGE, {
    promptTokens: completion.usage?.prompt_tokens ?? 0,
    completionTokens: completion.usage?.completion_tokens ?? 0,
    totalTokens: completion.usage?.total_tokens ?? 0,
  });

  /* --------------------- 4. GALLYUTSINATSIYA TO‘SIG‘I ------------------ */
  // Promt qanchalik qattiq bo'lmasin, model ba'zan raqam to'qiydi.
  // Shuning uchun javob YARATILGANDAN KEYIN ham tekshiriladi.
  const allowedTexts = [
    ...selection.items.map((entry) => `${entry.item.question ?? ""} ${entry.item.answer}`),
    ...patterns.map((pattern) => pattern.responseExample),
  ];
  const unsupportedNumbers = findUnsupportedNumbers(reply, allowedTexts);

  const diagnostics: TestChatDiagnostics = {
    intentKey: intent?.key ?? null,
    intentLabel: intent?.label ?? null,
    intentKnown: intent?.known ?? false,
    knowledgeCount: selection.items.length,
    patternCount: patterns.length,
    styleProfileActive: style != null,
    knowledgeSource: resolveKnowledgeSource(selection.items),
    manualKnowledgeCount: selection.items.filter((e) => e.item.sourceType === "manual").length,
    confidence: computeConfidence({
      intentResolved: intent != null,
      intentKnown: intent?.known ?? false,
      knowledgeCount: selection.items.length,
      patternCount: patterns.length,
      hasStyleProfile: style != null,
    }),
    missingKnowledge,
    unsupportedNumbers,
    sources: buildSources(selection.items, patterns, knowledgeRows),
  };

  await logAudit({
    actorId: options.actorId,
    action: "sales.test_chat.reply",
    entityType: "sales_test_chat",
    entityId: null,
    newValue: {
      intent: diagnostics.intentKey,
      knowledge: diagnostics.knowledgeCount,
      patterns: diagnostics.patternCount,
      missingKnowledge,
      unsupportedNumbers: unsupportedNumbers.length,
      tokens: usage.totalTokens,
    },
    severity: unsupportedNumbers.length > 0 ? "warning" : "info",
  });

  return {
    reply,
    diagnostics,
    usage,
    estimatedCostUsd: estimateCostUsd(model, usage),
    latencyMs: Date.now() - startedAt,
    model,
  };
}

/** "Manbalarni ko'rish" oynasi uchun ro'yxat. */
/** Tanlangan bilimlar qaysi manbadan — diagnostikaning MANUAL yozuvi. */
function resolveKnowledgeSource(
  items: readonly ScoredKnowledge[],
): "manual" | "ai_extracted" | "mixed" | "none" {
  if (items.length === 0) return "none";
  const manual = items.filter((entry) => entry.item.sourceType === "manual").length;
  if (manual === 0) return "ai_extracted";
  if (manual === items.length) return "manual";
  return "mixed";
}

function buildSources(
  knowledge: readonly ScoredKnowledge[],
  patterns: readonly RetrievablePattern[],
  knowledgeRows: readonly { id: string; sourceConversationId: string | null }[],
): TestChatSource[] {
  const conversationById = new Map(
    knowledgeRows.map((row) => [row.id, row.sourceConversationId]),
  );

  return [
    ...knowledge.map<TestChatSource>((entry) => ({
      id: entry.item.id,
      kind: "knowledge",
      sourceType: entry.item.sourceType ?? "ai_extracted",
      title: entry.item.question ?? entry.item.category,
      body: entry.item.answer,
      meta: entry.reasons.join(", ") || "turkum bo‘yicha",
      sourceConversationId: conversationById.get(entry.item.id) ?? null,
    })),
    ...patterns.map<TestChatSource>((pattern) => ({
      id: pattern.id,
      kind: "pattern",
      title: pattern.customerExample || pattern.intentLabel,
      body: pattern.responseExample,
      meta:
        pattern.successRate == null
          ? `${pattern.frequency} marta · natijasi noma’lum`
          : `${pattern.frequency} marta · ${pattern.successRate}% muvaffaqiyat`,
      sourceConversationId: null,
    })),
  ];
}
